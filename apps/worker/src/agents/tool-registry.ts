import type { LLMToolDefinition } from '@vautrin/integrations';

export type AgentToolSideEffect = 'none' | 'internal' | 'external';
export type AgentToolOutcomeStatus =
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'DENIED'
  | 'AWAITING_APPROVAL';

/** Intentionally contains no database handle or provider SDK object. */
export interface AgentToolContext {
  readonly tenantId: string;
  readonly agentId: string;
  readonly agentRunId: string;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
}

export interface AgentToolDefinition<Input, Output> {
  readonly name: string;
  readonly description: string;
  readonly permission: string;
  readonly sideEffect: AgentToolSideEffect;
  readonly requiresApproval: boolean;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly parseInput: (value: unknown) => Input;
  readonly parseOutput: (value: unknown) => Output;
  readonly execute: (context: AgentToolContext, input: Input) => Promise<Output>;
}

export interface AgentToolAuthorization {
  isAuthorized(context: AgentToolContext, permission: string): Promise<boolean>;
  isApproved(context: AgentToolContext, toolName: string): Promise<boolean>;
}

export interface AgentToolAuditEvent {
  readonly tenantId: string;
  readonly agentRunId: string;
  readonly idempotencyKey?: string;
  readonly toolName: string;
  readonly permission: string;
  readonly sideEffect: AgentToolSideEffect;
  readonly status: AgentToolOutcomeStatus;
  readonly authorized: boolean;
  readonly approvalRequired: boolean;
  readonly errorCode?: string;
  readonly latencyMs: number;
}

export interface AgentToolAuditSink {
  /** Atomically reserves a side-effecting call key before its handler runs. */
  claim(event: AgentToolAuditEvent): Promise<boolean>;
  record(event: AgentToolAuditEvent): Promise<void>;
}

export type AgentToolResult<Output = unknown> =
  | { readonly status: 'SUCCEEDED'; readonly output: Output }
  | { readonly status: 'FAILED'; readonly errorCode: string }
  | { readonly status: 'DENIED'; readonly errorCode: 'tool_not_allowed' | 'permission_denied' }
  | { readonly status: 'AWAITING_APPROVAL'; readonly errorCode: 'approval_required' };

/**
 * Allow-listed typed capabilities exposed to the model. The model can select
 * only descriptions; parsing, authorization, approval and execution remain in
 * trusted application code.
 */
export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentToolDefinition<unknown, unknown>>();

  register<Input, Output>(definition: AgentToolDefinition<Input, Output>): void {
    if (!/^[a-z][a-z0-9_.-]{0,79}$/.test(definition.name)) {
      throw new Error('Agent tool name is invalid.');
    }
    if (this.tools.has(definition.name))
      throw new Error(`Agent tool already registered: ${definition.name}`);
    this.tools.set(definition.name, definition as AgentToolDefinition<unknown, unknown>);
  }

  describe(allowedTools: readonly string[]): readonly LLMToolDefinition[] {
    return allowedTools.flatMap((name) => {
      const definition = this.tools.get(name);
      return definition
        ? [{ name, description: definition.description, inputSchema: definition.inputSchema }]
        : [];
    });
  }

  async invoke(
    toolName: string,
    rawInput: unknown,
    context: AgentToolContext,
    allowedTools: readonly string[],
    authorization: AgentToolAuthorization,
    audit: AgentToolAuditSink,
  ): Promise<AgentToolResult> {
    const definition = this.tools.get(toolName);
    if (!definition || !allowedTools.includes(toolName)) {
      await audit.record({
        tenantId: context.tenantId,
        agentRunId: context.agentRunId,
        ...(context.idempotencyKey ? { idempotencyKey: context.idempotencyKey } : {}),
        toolName,
        permission: definition?.permission ?? '',
        sideEffect: definition?.sideEffect ?? 'none',
        status: 'DENIED',
        authorized: false,
        approvalRequired: definition?.requiresApproval ?? false,
        errorCode: 'tool_not_allowed',
        latencyMs: 0,
      });
      return { status: 'DENIED', errorCode: 'tool_not_allowed' };
    }

    const startedAt = Date.now();
    let status: AgentToolOutcomeStatus = 'FAILED';
    let authorized = false;
    let errorCode: string | undefined;
    let result: AgentToolResult;
    let shouldRecord = true;
    try {
      const input = definition.parseInput(rawInput);
      authorized = await authorization.isAuthorized(context, definition.permission);
      if (!authorized) {
        status = 'DENIED';
        errorCode = 'permission_denied';
        result = { status: 'DENIED', errorCode: 'permission_denied' };
      } else if (definition.sideEffect !== 'none' && !context.idempotencyKey) {
        throw new ToolInputError('idempotency_key_required');
      } else if (
        definition.requiresApproval &&
        !(await authorization.isApproved(context, toolName))
      ) {
        status = 'AWAITING_APPROVAL';
        errorCode = 'approval_required';
        result = { status: 'AWAITING_APPROVAL', errorCode: 'approval_required' };
      } else {
        if (definition.sideEffect !== 'none') {
          if (!context.idempotencyKey) throw new ToolInputError('idempotency_key_required');
          const claimed = await audit.claim({
            tenantId: context.tenantId,
            agentRunId: context.agentRunId,
            idempotencyKey: context.idempotencyKey,
            toolName,
            permission: definition.permission,
            sideEffect: definition.sideEffect,
            status: 'RUNNING',
            authorized: true,
            approvalRequired: definition.requiresApproval,
            latencyMs: Math.max(0, Date.now() - startedAt),
          });
          if (!claimed) {
            status = 'FAILED';
            errorCode = 'tool_call_already_claimed';
            result = { status, errorCode };
            shouldRecord = false;
          } else {
            const rawOutput = await definition.execute(context, input);
            const output = definition.parseOutput(rawOutput);
            status = 'SUCCEEDED';
            result = { status, output };
          }
        } else {
          const rawOutput = await definition.execute(context, input);
          const output = definition.parseOutput(rawOutput);
          status = 'SUCCEEDED';
          result = { status, output };
        }
      }
    } catch (error) {
      status = 'FAILED';
      errorCode = error instanceof ToolInputError ? error.code : 'tool_execution_failed';
      result = { status, errorCode };
    }

    if (shouldRecord) {
      await audit.record({
        tenantId: context.tenantId,
        agentRunId: context.agentRunId,
        ...(context.idempotencyKey ? { idempotencyKey: context.idempotencyKey } : {}),
        toolName,
        permission: definition.permission,
        sideEffect: definition.sideEffect,
        status,
        authorized,
        approvalRequired: definition.requiresApproval,
        ...(errorCode ? { errorCode } : {}),
        latencyMs: Math.max(0, Date.now() - startedAt),
      });
    }
    return result;
  }
}

class ToolInputError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
