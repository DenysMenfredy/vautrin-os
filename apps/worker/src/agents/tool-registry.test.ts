import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AgentToolDefinition, AgentToolRegistry } from './tool-registry.js';

interface LookupInput {
  readonly leadId: string;
}

interface LookupOutput {
  readonly status: string;
}

const lookupTool: AgentToolDefinition<LookupInput, LookupOutput> = {
  name: 'lead.lookup',
  description: 'Read a lead status.',
  permission: 'lead.read',
  sideEffect: 'none',
  requiresApproval: false,
  inputSchema: { type: 'object', required: ['leadId'] },
  outputSchema: { type: 'object', required: ['status'] },
  parseInput(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('leadId' in value) ||
      typeof value.leadId !== 'string'
    ) {
      throw new Error('invalid input');
    }
    return { leadId: value.leadId };
  },
  parseOutput(value) {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('status' in value) ||
      typeof value.status !== 'string'
    ) {
      throw new Error('invalid output');
    }
    return { status: value.status };
  },
  execute: vi.fn(async (_context, input) => ({ status: `lead:${input.leadId}` })),
};

const context = {
  tenantId: '0192f1a0-1b2c-7d3e-8f40-51627384950a',
  agentId: '0192f1a0-1b2c-7d3e-8f40-51627384950b',
  agentRunId: '0192f1a0-1b2c-7d3e-8f40-51627384950c',
};

function auditSink() {
  return {
    claim: vi.fn(async () => true),
    record: vi.fn(async () => undefined),
  };
}

describe('agent tool registry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes only registered tools that are in the agent allow-list', async () => {
    const registry = new AgentToolRegistry();
    registry.register(lookupTool);
    const audit = auditSink();
    expect(registry.describe(['lead.lookup', 'lead.delete'])).toEqual([
      expect.objectContaining({ name: 'lead.lookup' }),
    ]);

    const result = await registry.invoke(
      'lead.delete',
      {},
      context,
      ['lead.lookup'],
      { isAuthorized: vi.fn(), isApproved: vi.fn() },
      audit,
    );
    expect(result).toEqual({ status: 'DENIED', errorCode: 'tool_not_allowed' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ status: 'DENIED' }));
    expect(lookupTool.execute).not.toHaveBeenCalled();
  });

  it('validates and authorizes calls, then returns a typed output', async () => {
    const registry = new AgentToolRegistry();
    registry.register(lookupTool);
    const audit = auditSink();
    const result = await registry.invoke(
      'lead.lookup',
      { leadId: 'lead-123' },
      context,
      ['lead.lookup'],
      { isAuthorized: vi.fn(async () => true), isApproved: vi.fn(async () => true) },
      audit,
    );
    expect(result).toEqual({ status: 'SUCCEEDED', output: { status: 'lead:lead-123' } });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'lead.lookup',
        permission: 'lead.read',
        status: 'SUCCEEDED',
        authorized: true,
      }),
    );
  });

  it('does not execute before a permission or approval gate passes', async () => {
    const protectedTool: AgentToolDefinition<LookupInput, LookupOutput> = {
      ...lookupTool,
      name: 'lead.update',
      permission: 'lead.write',
      sideEffect: 'internal',
      requiresApproval: true,
    };
    const registry = new AgentToolRegistry();
    registry.register(protectedTool);
    const audit = auditSink();
    const authorization = {
      isAuthorized: vi.fn(async () => true),
      isApproved: vi.fn(async () => false),
    };
    const pending = await registry.invoke(
      'lead.update',
      { leadId: 'lead-123' },
      { ...context, idempotencyKey: 'agent-run/tool-call-1' },
      ['lead.update'],
      authorization,
      audit,
    );
    expect(pending).toEqual({ status: 'AWAITING_APPROVAL', errorCode: 'approval_required' });
    expect(protectedTool.execute).not.toHaveBeenCalled();

    const denied = await registry.invoke(
      'lead.update',
      { leadId: 'lead-123' },
      { ...context, idempotencyKey: 'agent-run/tool-call-2' },
      ['lead.update'],
      { isAuthorized: vi.fn(async () => false), isApproved: vi.fn(async () => true) },
      audit,
    );
    expect(denied).toEqual({ status: 'DENIED', errorCode: 'permission_denied' });
    expect(protectedTool.execute).not.toHaveBeenCalled();
  });

  it('requires an idempotency key for any side-effecting tool', async () => {
    const protectedTool: AgentToolDefinition<LookupInput, LookupOutput> = {
      ...lookupTool,
      name: 'lead.update',
      sideEffect: 'internal',
    };
    const registry = new AgentToolRegistry();
    registry.register(protectedTool);
    const result = await registry.invoke(
      'lead.update',
      { leadId: 'lead-123' },
      context,
      ['lead.update'],
      { isAuthorized: vi.fn(async () => true), isApproved: vi.fn(async () => true) },
      auditSink(),
    );
    expect(result).toEqual({ status: 'FAILED', errorCode: 'idempotency_key_required' });
    expect(protectedTool.execute).not.toHaveBeenCalled();
  });

  it('claims side-effect idempotency keys before execution and refuses duplicates', async () => {
    const protectedTool: AgentToolDefinition<LookupInput, LookupOutput> = {
      ...lookupTool,
      name: 'lead.update',
      sideEffect: 'external',
    };
    const registry = new AgentToolRegistry();
    registry.register(protectedTool);
    const audit = auditSink();
    audit.claim.mockResolvedValue(false);
    const result = await registry.invoke(
      'lead.update',
      { leadId: 'lead-123' },
      { ...context, idempotencyKey: 'stable-tool-call' },
      ['lead.update'],
      { isAuthorized: vi.fn(async () => true), isApproved: vi.fn(async () => true) },
      audit,
    );
    expect(result).toEqual({ status: 'FAILED', errorCode: 'tool_call_already_claimed' });
    expect(audit.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'stable-tool-call',
        status: 'RUNNING',
        sideEffect: 'external',
      }),
    );
    expect(audit.record).not.toHaveBeenCalled();
    expect(protectedTool.execute).not.toHaveBeenCalled();
  });
});
