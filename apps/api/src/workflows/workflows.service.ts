import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateWorkflowRequest,
  ListWorkflowsRequest,
  UpdateWorkflowRequest,
  WorkflowLifecycleRequest,
  WorkflowPageResponse,
  WorkflowResponse,
} from '@vautrin/contracts';
import {
  Prisma,
  type TenantScopedClient,
  type Workflow,
  type WorkflowStatus,
} from '@vautrin/database';

import { buildPage, cursorFilter, DEFAULT_PAGE_SIZE, decodeCursor } from '../common/cursor-page.js';
import { DatabaseService } from '../database/database.service.js';
import {
  validateConditionList,
  validateJsonObject,
  validateWorkflowDefinition,
} from './workflow-definition.js';

const WORKFLOW_KEY = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const TRIGGER_NAME = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

@Injectable()
export class WorkflowsService {
  constructor(private readonly database: DatabaseService) {}

  async list(tenantId: string, options: ListWorkflowsRequest): Promise<WorkflowPageResponse> {
    const limit = options.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = decodeCursor(options.cursor);
    const where: Prisma.WorkflowWhereInput = { tenantId };
    if (options.status) where.status = options.status;
    if (options.trigger) where.trigger = options.trigger;
    if (cursor) where.AND = [cursorFilter(cursor)];
    const rows = await this.database.withTenant(tenantId, (tx) =>
      tx.workflow.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    );
    return buildPage(rows, limit, mapWorkflow);
  }

  async get(tenantId: string, workflowId: string): Promise<WorkflowResponse> {
    const workflow = await this.findWorkflow(tenantId, workflowId);
    return mapWorkflow(workflow);
  }

  async create(
    tenantId: string,
    actorId: string,
    input: CreateWorkflowRequest,
  ): Promise<WorkflowResponse> {
    assertKey(input.key);
    assertName(input.name);
    assertTrigger(input.trigger);
    const definition = validateWorkflowDefinition(input.definition);
    const conditions = validateConditionList(input.conditions ?? []);
    const retryPolicy = validateJsonObject(input.retryPolicy ?? {}, 'retryPolicy');
    const failurePolicy = validateJsonObject(input.failurePolicy ?? {}, 'failurePolicy');

    try {
      return await this.database.withTenant(tenantId, async (tx) => {
        const workflow = await tx.workflow.create({
          data: {
            tenantId,
            key: input.key,
            version: 1,
            name: input.name.trim(),
            description: normalizeDescription(input.description),
            trigger: input.trigger,
            definition: asJson(definition),
            conditions: asJson(conditions),
            retryPolicy: asJson(retryPolicy),
            failurePolicy: asJson(failurePolicy),
          },
        });
        await writeWorkflowAudit(tx, tenantId, actorId, 'workflow.created', workflow.id);
        return mapWorkflow(workflow);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Workflow key already exists.');
      throw error;
    }
  }

  update(
    tenantId: string,
    actorId: string,
    workflowId: string,
    input: UpdateWorkflowRequest,
  ): Promise<WorkflowResponse> {
    if (Object.keys(input).length === 0) {
      throw new BadRequestException('At least one draft workflow field is required.');
    }
    if (input.name !== undefined) assertName(input.name);
    if (input.trigger !== undefined) assertTrigger(input.trigger);
    const definition =
      input.definition === undefined ? undefined : validateWorkflowDefinition(input.definition);
    const conditions =
      input.conditions === undefined ? undefined : validateConditionList(input.conditions);
    const retryPolicy =
      input.retryPolicy === undefined
        ? undefined
        : validateJsonObject(input.retryPolicy, 'retryPolicy');
    const failurePolicy =
      input.failurePolicy === undefined
        ? undefined
        : validateJsonObject(input.failurePolicy, 'failurePolicy');

    return this.database.withTenant(tenantId, async (tx) => {
      const changed = await tx.workflow.updateMany({
        where: { id: workflowId, tenantId, status: 'DRAFT' },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined
            ? { description: normalizeDescription(input.description) }
            : {}),
          ...(input.trigger !== undefined ? { trigger: input.trigger } : {}),
          ...(definition !== undefined ? { definition: asJson(definition) } : {}),
          ...(conditions !== undefined ? { conditions: asJson(conditions) } : {}),
          ...(retryPolicy !== undefined ? { retryPolicy: asJson(retryPolicy) } : {}),
          ...(failurePolicy !== undefined ? { failurePolicy: asJson(failurePolicy) } : {}),
          updatedAt: new Date(),
        },
      });
      if (changed.count === 0) await this.assertEditableDraft(tx, tenantId, workflowId);
      const workflow = await findWorkflowInTransaction(tx, tenantId, workflowId);
      await writeWorkflowAudit(tx, tenantId, actorId, 'workflow.updated', workflowId);
      return mapWorkflow(workflow);
    });
  }

  async createVersion(
    tenantId: string,
    actorId: string,
    sourceWorkflowId: string,
  ): Promise<WorkflowResponse> {
    try {
      return await this.database.withTenant(tenantId, async (tx) => {
        const source = await findWorkflowInTransaction(tx, tenantId, sourceWorkflowId);
        if (source.status === 'DRAFT' || source.publishedAt === null) {
          throw new ConflictException('Only a published workflow version can be copied.');
        }
        const latest = await tx.workflow.findFirst({
          where: { tenantId, key: source.key },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        if (!latest) throw new NotFoundException('Workflow not found.');
        const workflow = await tx.workflow.create({
          data: {
            tenantId,
            key: source.key,
            version: latest.version + 1,
            name: source.name,
            description: source.description,
            trigger: source.trigger,
            definition: source.definition as Prisma.InputJsonValue,
            conditions: source.conditions as Prisma.InputJsonValue,
            retryPolicy: source.retryPolicy as Prisma.InputJsonValue,
            failurePolicy: source.failurePolicy as Prisma.InputJsonValue,
          },
        });
        await writeWorkflowAudit(tx, tenantId, actorId, 'workflow.version.created', workflow.id);
        return mapWorkflow(workflow);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A newer workflow version was created concurrently; retry.');
      }
      throw error;
    }
  }

  setStatus(
    tenantId: string,
    actorId: string,
    workflowId: string,
    status: WorkflowLifecycleRequest,
  ): Promise<WorkflowResponse> {
    return this.database.withTenant(tenantId, async (tx) => {
      const current = await findWorkflowInTransaction(tx, tenantId, workflowId);
      const allowedFrom: Readonly<Record<WorkflowLifecycleRequest, readonly WorkflowStatus[]>> = {
        ACTIVE: ['DRAFT', 'PAUSED'],
        PAUSED: ['ACTIVE'],
        ARCHIVED: ['ACTIVE', 'PAUSED'],
      };
      if (!allowedFrom[status].includes(current.status)) {
        throw new ConflictException(
          `Workflow cannot transition from ${current.status} to ${status}.`,
        );
      }
      const changed = await tx.workflow.updateMany({
        where: { id: workflowId, tenantId, status: current.status },
        data: { status, updatedAt: new Date() },
      });
      if (changed.count !== 1) throw new ConflictException('Workflow status changed; retry.');
      const workflow = await findWorkflowInTransaction(tx, tenantId, workflowId);
      await writeWorkflowAudit(tx, tenantId, actorId, lifecycleAuditAction(status), workflowId);
      return mapWorkflow(workflow);
    });
  }

  private async findWorkflow(tenantId: string, workflowId: string): Promise<Workflow> {
    const workflow = await this.database.withTenant(tenantId, (tx) =>
      tx.workflow.findFirst({ where: { id: workflowId, tenantId } }),
    );
    if (!workflow) throw new NotFoundException('Workflow not found.');
    return workflow;
  }

  private async assertEditableDraft(
    tx: TenantScopedClient,
    tenantId: string,
    workflowId: string,
  ): Promise<never> {
    const current = await tx.workflow.findFirst({ where: { id: workflowId, tenantId } });
    if (!current) throw new NotFoundException('Workflow not found.');
    throw new ConflictException('Only draft workflows can be edited; create a new version.');
  }
}

async function findWorkflowInTransaction(
  tx: TenantScopedClient,
  tenantId: string,
  workflowId: string,
): Promise<Workflow> {
  const workflow = await tx.workflow.findFirst({ where: { id: workflowId, tenantId } });
  if (!workflow) throw new NotFoundException('Workflow not found.');
  return workflow;
}

function assertKey(key: string): void {
  if (!WORKFLOW_KEY.test(key)) throw new BadRequestException('key has an invalid format.');
}

function assertName(name: string): void {
  if (!name.trim()) throw new BadRequestException('name must not be blank.');
}

function assertTrigger(trigger: string): void {
  if (!TRIGGER_NAME.test(trigger)) throw new BadRequestException('trigger has an invalid format.');
}

function normalizeDescription(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function lifecycleAuditAction(status: WorkflowLifecycleRequest): string {
  return {
    ACTIVE: 'workflow.activated',
    PAUSED: 'workflow.paused',
    ARCHIVED: 'workflow.archived',
  }[status];
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function writeWorkflowAudit(
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
      resourceType: 'workflow',
      resourceId,
    },
  });
}

function mapWorkflow(workflow: Workflow): WorkflowResponse {
  return {
    id: workflow.id,
    key: workflow.key,
    version: workflow.version,
    name: workflow.name,
    description: workflow.description,
    trigger: workflow.trigger,
    status: workflow.status,
    definition: workflow.definition as unknown as WorkflowResponse['definition'],
    conditions: workflow.conditions as WorkflowResponse['conditions'],
    retryPolicy: workflow.retryPolicy as WorkflowResponse['retryPolicy'],
    failurePolicy: workflow.failurePolicy as WorkflowResponse['failurePolicy'],
    publishedAt: workflow.publishedAt?.toISOString() ?? null,
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString(),
  };
}
