import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AgentLifecycleRequest,
  AgentPageResponse,
  AgentResponse,
  CreateAgentRequest,
  ListAgentsRequest,
  UpdateAgentRequest,
} from '@vautrin/contracts';
import { type Agent as AgentModel, Prisma, type TenantScopedClient } from '@vautrin/database';

import { buildPage, cursorFilter, DEFAULT_PAGE_SIZE, decodeCursor } from '../common/cursor-page.js';
import { DatabaseService } from '../database/database.service.js';
import {
  redactAgentModelConfiguration,
  validateAgentConfiguration,
  validateAgentInstructions,
  validateAgentKey,
  validateAgentName,
  validateAllowedTools,
  validatePromptVersion,
} from './agent-definition.js';

@Injectable()
export class AgentsService {
  constructor(private readonly database: DatabaseService) {}

  async list(tenantId: string, options: ListAgentsRequest): Promise<AgentPageResponse> {
    const limit = options.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = decodeCursor(options.cursor);
    const where: Prisma.AgentWhereInput = { tenantId };
    if (options.status) where.status = options.status;
    if (cursor) where.AND = [cursorFilter(cursor)];
    const rows = await this.database.withTenant(tenantId, (tx) =>
      tx.agent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    );
    return buildPage(rows, limit, mapAgent);
  }

  async get(tenantId: string, agentId: string): Promise<AgentResponse> {
    return mapAgent(await this.findAgent(tenantId, agentId));
  }

  async create(
    tenantId: string,
    actorId: string,
    input: CreateAgentRequest,
  ): Promise<AgentResponse> {
    validateAgentKey(input.key);
    validateAgentName(input.name);
    validatePromptVersion(input.promptVersion);
    const instructions = validateAgentInstructions(input.instructions);
    const allowedTools = validateAllowedTools(input.allowedTools ?? []);
    const modelConfiguration = validateAgentConfiguration(
      input.modelConfiguration ?? {},
      'modelConfiguration',
    );
    const knowledgeStrategy = validateAgentConfiguration(
      input.knowledgeStrategy ?? {},
      'knowledgeStrategy',
    );
    const guardrails = validateAgentConfiguration(input.guardrails ?? {}, 'guardrails');
    const handoffPolicy = validateAgentConfiguration(input.handoffPolicy ?? {}, 'handoffPolicy');

    try {
      return await this.database.withTenant(tenantId, async (tx) => {
        const agent = await tx.agent.create({
          data: {
            tenantId,
            key: input.key,
            version: 1,
            name: input.name.trim(),
            instructions,
            promptVersion: input.promptVersion,
            modelConfiguration: asJson(modelConfiguration),
            allowedTools: [...allowedTools],
            knowledgeStrategy: asJson(knowledgeStrategy),
            guardrails: asJson(guardrails),
            handoffPolicy: asJson(handoffPolicy),
          },
        });
        await writeAgentAudit(tx, tenantId, actorId, 'agent.created', agent.id);
        return mapAgent(agent);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Agent key already exists.');
      throw error;
    }
  }

  update(
    tenantId: string,
    actorId: string,
    agentId: string,
    input: UpdateAgentRequest,
  ): Promise<AgentResponse> {
    if (Object.keys(input).length === 0) {
      throw new BadRequestException('At least one draft agent field is required.');
    }
    if (input.name !== undefined) validateAgentName(input.name);
    if (input.instructions !== undefined) validateAgentInstructions(input.instructions);
    if (input.promptVersion !== undefined) validatePromptVersion(input.promptVersion);
    if (input.allowedTools !== undefined) validateAllowedTools(input.allowedTools);
    if (input.modelConfiguration !== undefined) {
      validateAgentConfiguration(input.modelConfiguration, 'modelConfiguration');
    }
    if (input.knowledgeStrategy !== undefined) {
      validateAgentConfiguration(input.knowledgeStrategy, 'knowledgeStrategy');
    }
    if (input.guardrails !== undefined) validateAgentConfiguration(input.guardrails, 'guardrails');
    if (input.handoffPolicy !== undefined) {
      validateAgentConfiguration(input.handoffPolicy, 'handoffPolicy');
    }

    return this.database.withTenant(tenantId, async (tx) => {
      const changed = await tx.agent.updateMany({
        where: { id: agentId, tenantId, status: 'DRAFT' },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.instructions !== undefined
            ? { instructions: validateAgentInstructions(input.instructions) }
            : {}),
          ...(input.promptVersion !== undefined ? { promptVersion: input.promptVersion } : {}),
          ...(input.modelConfiguration !== undefined
            ? { modelConfiguration: asJson(input.modelConfiguration) }
            : {}),
          ...(input.allowedTools !== undefined ? { allowedTools: [...input.allowedTools] } : {}),
          ...(input.knowledgeStrategy !== undefined
            ? { knowledgeStrategy: asJson(input.knowledgeStrategy) }
            : {}),
          ...(input.guardrails !== undefined ? { guardrails: asJson(input.guardrails) } : {}),
          ...(input.handoffPolicy !== undefined
            ? { handoffPolicy: asJson(input.handoffPolicy) }
            : {}),
          updatedAt: new Date(),
        },
      });
      if (changed.count === 0) await this.assertEditableDraft(tx, tenantId, agentId);
      const agent = await findAgentInTransaction(tx, tenantId, agentId);
      await writeAgentAudit(tx, tenantId, actorId, 'agent.updated', agentId);
      return mapAgent(agent);
    });
  }

  async createVersion(
    tenantId: string,
    actorId: string,
    sourceAgentId: string,
  ): Promise<AgentResponse> {
    try {
      return await this.database.withTenant(tenantId, async (tx) => {
        const source = await findAgentInTransaction(tx, tenantId, sourceAgentId);
        if (source.status === 'DRAFT') {
          throw new ConflictException('Only an activated or archived agent version can be copied.');
        }
        const latest = await tx.agent.findFirst({
          where: { tenantId, key: source.key },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        if (!latest) throw new NotFoundException('Agent not found.');
        const agent = await tx.agent.create({
          data: {
            tenantId,
            key: source.key,
            version: latest.version + 1,
            name: source.name,
            instructions: source.instructions,
            promptVersion: source.promptVersion,
            modelConfiguration: source.modelConfiguration as Prisma.InputJsonValue,
            allowedTools: source.allowedTools,
            knowledgeStrategy: source.knowledgeStrategy as Prisma.InputJsonValue,
            guardrails: source.guardrails as Prisma.InputJsonValue,
            handoffPolicy: source.handoffPolicy as Prisma.InputJsonValue,
          },
        });
        await writeAgentAudit(tx, tenantId, actorId, 'agent.version.created', agent.id);
        return mapAgent(agent);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A newer agent version was created concurrently; retry.');
      }
      throw error;
    }
  }

  setStatus(
    tenantId: string,
    actorId: string,
    agentId: string,
    status: AgentLifecycleRequest,
  ): Promise<AgentResponse> {
    return this.database.withTenant(tenantId, async (tx) => {
      const current = await findAgentInTransaction(tx, tenantId, agentId);
      const allowedFrom: Readonly<Record<AgentLifecycleRequest, readonly string[]>> = {
        ACTIVE: ['DRAFT'],
        ARCHIVED: ['ACTIVE'],
      };
      if (!allowedFrom[status].includes(current.status)) {
        throw new ConflictException(`Agent cannot transition from ${current.status} to ${status}.`);
      }
      validateAgentInstructions(current.instructions);
      validatePromptVersion(current.promptVersion);
      const changed = await tx.agent.updateMany({
        where: { id: agentId, tenantId, status: current.status },
        data: { status, updatedAt: new Date() },
      });
      if (changed.count !== 1) throw new ConflictException('Agent status changed; retry.');
      const agent = await findAgentInTransaction(tx, tenantId, agentId);
      await writeAgentAudit(
        tx,
        tenantId,
        actorId,
        status === 'ACTIVE' ? 'agent.activated' : 'agent.archived',
        agentId,
      );
      return mapAgent(agent);
    });
  }

  private findAgent(tenantId: string, agentId: string): Promise<AgentModel> {
    return this.database.withTenant(tenantId, (tx) =>
      findAgentInTransaction(tx, tenantId, agentId),
    );
  }

  private async assertEditableDraft(
    tx: TenantScopedClient,
    tenantId: string,
    agentId: string,
  ): Promise<void> {
    const agent = await tx.agent.findFirst({
      where: { id: agentId, tenantId },
      select: { status: true },
    });
    if (!agent) throw new NotFoundException('Agent not found.');
    throw new ConflictException('Published agent versions are immutable; create a new version.');
  }
}

async function findAgentInTransaction(
  tx: TenantScopedClient,
  tenantId: string,
  agentId: string,
): Promise<AgentModel> {
  const agent = await tx.agent.findFirst({ where: { id: agentId, tenantId } });
  if (!agent) throw new NotFoundException('Agent not found.');
  return agent;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function writeAgentAudit(
  tx: TenantScopedClient,
  tenantId: string,
  actorId: string,
  action: string,
  resourceId: string,
): Promise<unknown> {
  return tx.auditLog.create({
    data: {
      tenantId,
      actorType: 'USER',
      actorId,
      action,
      outcome: 'SUCCESS',
      resourceType: 'agent',
      resourceId,
    },
  });
}

function mapAgent(agent: AgentModel): AgentResponse {
  return {
    id: agent.id,
    key: agent.key,
    version: agent.version,
    name: agent.name,
    status: agent.status,
    instructions: agent.instructions,
    promptVersion: agent.promptVersion,
    modelConfiguration: redactAgentModelConfiguration(agent.modelConfiguration),
    allowedTools: agent.allowedTools,
    knowledgeStrategy: agent.knowledgeStrategy as AgentResponse['knowledgeStrategy'],
    guardrails: agent.guardrails as AgentResponse['guardrails'],
    handoffPolicy: agent.handoffPolicy as AgentResponse['handoffPolicy'],
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}
