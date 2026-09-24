import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type AssignLeadRequest,
  type CreateLeadRequest,
  LEAD_STATUSES,
  type LeadDashboardResponse,
  type LeadPageResponse,
  type LeadResponse,
  type ListLeadsRequest,
  leadCreatedEvent,
  leadStatusChangedEvent,
  type TransitionLeadRequest,
  type UpdateLeadRequest,
} from '@vautrin/contracts';
import { type Lead, Prisma, type TenantScopedClient } from '@vautrin/database';

import { buildPage, cursorFilter, DEFAULT_PAGE_SIZE, decodeCursor } from '../common/cursor-page.js';
import { DatabaseService } from '../database/database.service.js';
import { assertLeadTransition } from './lead-lifecycle.js';

const MONEY_PATTERN = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;

@Injectable()
export class LeadsService {
  constructor(private readonly database: DatabaseService) {}

  async list(tenantId: string, options: ListLeadsRequest): Promise<LeadPageResponse> {
    const limit = options.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = decodeCursor(options.cursor);
    const where: Prisma.LeadWhereInput = { tenantId, deletedAt: null };
    if (options.status) where.status = options.status;
    if (options.sourceId) where.sourceId = options.sourceId;
    if (options.assignedUserId) where.assignedUserId = options.assignedUserId;
    const search = options.search?.trim();
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { service: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (cursor) where.AND = [cursorFilter(cursor)];
    const rows = await this.database.withTenant(tenantId, (tx) =>
      tx.lead.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    );
    return buildPage(rows, limit, mapLead);
  }

  async get(tenantId: string, leadId: string): Promise<LeadResponse> {
    const lead = await this.database.withTenant(tenantId, (tx) =>
      tx.lead.findFirst({ where: { id: leadId, tenantId, deletedAt: null } }),
    );
    if (!lead) throw new NotFoundException('Lead not found.');
    return mapLead(lead);
  }

  async create(tenantId: string, actorId: string, input: CreateLeadRequest): Promise<LeadResponse> {
    const lead = await this.database.withTenant(tenantId, async (tx) => {
      const contact = await tx.contact.findFirst({
        where: { id: input.contactId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!contact) throw new NotFoundException('Contact not found.');
      await validateCatalogReferences(tx, tenantId, input);

      const created = await tx.lead.create({
        data: {
          tenantId,
          contactId: contact.id,
          sourceId: input.sourceId ?? null,
          service: input.service ?? null,
          title: input.title ?? null,
          description: input.description ?? null,
          estimatedValue: money(input.estimatedValue),
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      const event = leadCreatedEvent(created.id, created.contactId);
      await tx.event.create({
        data: {
          tenantId,
          name: event.name,
          version: event.version,
          aggregateType: 'lead',
          aggregateId: created.id,
          payload: event.payload,
          idempotencyKey: `lead.created:${created.id}`,
        },
      });
      await writeLeadAudit(tx, tenantId, actorId, 'lead.created', created.id);
      return created;
    });
    return mapLead(lead);
  }

  async update(
    tenantId: string,
    actorId: string,
    leadId: string,
    input: UpdateLeadRequest,
  ): Promise<LeadResponse> {
    if (Object.keys(input).length <= 1) {
      throw new BadRequestException('At least one lead field is required.');
    }
    const lead = await this.database.withTenant(tenantId, async (tx) => {
      await validateCatalogReferences(tx, tenantId, input);
      const updated = await tx.lead.updateMany({
        where: { id: leadId, tenantId, deletedAt: null, version: input.version },
        data: {
          ...(input.sourceId !== undefined ? { sourceId: input.sourceId } : {}),
          ...(input.service !== undefined ? { service: input.service } : {}),
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.estimatedValue !== undefined
            ? { estimatedValue: money(input.estimatedValue) }
            : {}),
          version: { increment: 1 },
          updatedBy: actorId,
          updatedAt: new Date(),
        },
      });
      if (updated.count === 0) await throwMissingOrVersionConflict(tx, tenantId, leadId);
      const result = await findLead(tx, tenantId, leadId);
      await writeLeadAudit(tx, tenantId, actorId, 'lead.updated', leadId);
      return result;
    });
    return mapLead(lead);
  }

  async transition(
    tenantId: string,
    actorId: string,
    leadId: string,
    input: TransitionLeadRequest,
  ): Promise<LeadResponse> {
    const lead = await this.database.withTenant(tenantId, async (tx) => {
      const current = await findLead(tx, tenantId, leadId);
      if (current.version !== input.version)
        throw new ConflictException('Lead version has changed.');
      assertLeadTransition(current.status, input.status);
      const updated = await tx.lead.updateMany({
        where: { id: leadId, tenantId, deletedAt: null, version: input.version },
        data: {
          status: input.status,
          version: { increment: 1 },
          updatedBy: actorId,
          updatedAt: new Date(),
          ...(input.status === 'CONTACTED' ? { lastContactedAt: new Date() } : {}),
        },
      });
      if (updated.count === 0) await throwMissingOrVersionConflict(tx, tenantId, leadId);
      const event = leadStatusChangedEvent(leadId, current.status, input.status);
      await tx.event.create({
        data: {
          tenantId,
          name: event.name,
          version: event.version,
          aggregateType: 'lead',
          aggregateId: leadId,
          payload: event.payload,
          idempotencyKey: `lead.status_changed:${leadId}:${input.version + 1}`,
        },
      });
      await writeLeadAudit(tx, tenantId, actorId, 'lead.status_changed', leadId);
      return findLead(tx, tenantId, leadId);
    });
    return mapLead(lead);
  }

  async assign(
    tenantId: string,
    actorId: string,
    leadId: string,
    input: AssignLeadRequest,
  ): Promise<LeadResponse> {
    const lead = await this.database.withTenant(tenantId, async (tx) => {
      if (input.assignedUserId !== null) {
        const membership = await tx.tenantUser.findFirst({
          where: {
            tenantId,
            userId: input.assignedUserId,
            status: 'ACTIVE',
            role: { in: ['OWNER', 'ADMIN', 'MANAGER', 'STAFF'] },
          },
          select: { id: true },
        });
        if (!membership) throw new NotFoundException('Assignable tenant member not found.');
      }
      const updated = await tx.lead.updateMany({
        where: { id: leadId, tenantId, deletedAt: null, version: input.version },
        data: {
          assignedUserId: input.assignedUserId,
          version: { increment: 1 },
          updatedBy: actorId,
          updatedAt: new Date(),
        },
      });
      if (updated.count === 0) await throwMissingOrVersionConflict(tx, tenantId, leadId);
      await writeLeadAudit(tx, tenantId, actorId, 'lead.assigned', leadId);
      return findLead(tx, tenantId, leadId);
    });
    return mapLead(lead);
  }

  async archive(tenantId: string, actorId: string, leadId: string): Promise<void> {
    await this.database.withTenant(tenantId, async (tx) => {
      const now = new Date();
      const updated = await tx.lead.updateMany({
        where: { id: leadId, tenantId, deletedAt: null },
        data: {
          deletedAt: now,
          updatedAt: now,
          updatedBy: actorId,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) throw new NotFoundException('Lead not found.');
      await writeLeadAudit(tx, tenantId, actorId, 'lead.archived', leadId);
    });
  }

  async dashboard(tenantId: string): Promise<LeadDashboardResponse> {
    const counts = await this.database.withTenant(tenantId, (tx) =>
      tx.lead.groupBy({
        by: ['status'],
        where: { tenantId, deletedAt: null },
        _count: { _all: true },
      }),
    );
    const byStatus = Object.fromEntries(LEAD_STATUSES.map((status) => [status, 0])) as Record<
      (typeof LEAD_STATUSES)[number],
      number
    >;
    for (const item of counts) byStatus[item.status] = item._count._all;
    return { total: counts.reduce((sum, item) => sum + item._count._all, 0), byStatus };
  }
}

async function validateCatalogReferences(
  tx: TenantScopedClient,
  tenantId: string,
  input: {
    readonly sourceId?: string | null;
    readonly service?: string | null;
  },
): Promise<void> {
  if (input.sourceId) {
    const source = await tx.leadSource.findFirst({
      where: { id: input.sourceId, tenantId, isActive: true },
      select: { id: true },
    });
    if (!source) throw new NotFoundException('Active lead source not found.');
  }
  if (input.service !== undefined && input.service !== null) {
    const service = await tx.service.findFirst({
      where: { tenantId, key: input.service, active: true },
      select: { id: true },
    });
    if (!service) throw new NotFoundException('Active tenant service not found.');
  }
}

function money(value: string | null | undefined): Prisma.Decimal | null {
  if (value === undefined || value === null) return null;
  if (!MONEY_PATTERN.test(value)) {
    throw new BadRequestException('estimatedValue must be a non-negative decimal with two places.');
  }
  return new Prisma.Decimal(value);
}

async function findLead(tx: TenantScopedClient, tenantId: string, leadId: string): Promise<Lead> {
  const lead = await tx.lead.findFirst({ where: { id: leadId, tenantId, deletedAt: null } });
  if (!lead) throw new NotFoundException('Lead not found.');
  return lead;
}

async function throwMissingOrVersionConflict(
  tx: TenantScopedClient,
  tenantId: string,
  leadId: string,
): Promise<never> {
  await findLead(tx, tenantId, leadId);
  throw new ConflictException('Lead version has changed.');
}

function writeLeadAudit(
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
      resourceType: 'lead',
      resourceId,
    },
  });
}

function mapLead(lead: Lead): LeadResponse {
  return {
    id: lead.id,
    contactId: lead.contactId,
    status: lead.status,
    sourceId: lead.sourceId,
    service: lead.service,
    assignedUserId: lead.assignedUserId,
    title: lead.title,
    description: lead.description,
    estimatedValue: lead.estimatedValue?.toFixed(2) ?? null,
    lastContactedAt: lead.lastContactedAt?.toISOString() ?? null,
    version: lead.version,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}
