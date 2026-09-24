import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateLeadSourceRequest,
  LeadSourcePageResponse,
  LeadSourceResponse,
  ListLeadSourcesRequest,
  UpdateLeadSourceRequest,
} from '@vautrin/contracts';
import { type LeadSource, Prisma } from '@vautrin/database';

import { AuditService } from '../audit/audit.service.js';
import { buildPage, cursorFilter, DEFAULT_PAGE_SIZE, decodeCursor } from '../common/cursor-page.js';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class LeadSourcesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, options: ListLeadSourcesRequest): Promise<LeadSourcePageResponse> {
    const limit = options.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = decodeCursor(options.cursor);
    const where: Prisma.LeadSourceWhereInput = { tenantId };
    if (options.active !== undefined) where.isActive = options.active;
    const search = options.search?.trim();
    if (search) {
      where.OR = [
        { key: { contains: search, mode: 'insensitive' } },
        { label: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (cursor) where.AND = [cursorFilter(cursor)];
    const rows = await this.database.withTenant(tenantId, (tx) =>
      tx.leadSource.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    );
    return buildPage(rows, limit, mapLeadSource);
  }

  async get(tenantId: string, sourceId: string): Promise<LeadSourceResponse> {
    const source = await this.database.withTenant(tenantId, (tx) =>
      tx.leadSource.findFirst({ where: { id: sourceId, tenantId } }),
    );
    if (!source) throw new NotFoundException('Lead source not found.');
    return mapLeadSource(source);
  }

  async create(
    tenantId: string,
    actorId: string,
    input: CreateLeadSourceRequest,
  ): Promise<LeadSourceResponse> {
    const label = nonBlank(input.label, 'label');
    let source: LeadSource;
    try {
      source = await this.database.withTenant(tenantId, (tx) =>
        tx.leadSource.create({
          data: { tenantId, key: input.key, label, category: input.category ?? null },
        }),
      );
    } catch (error) {
      translateSourceConflict(error);
      throw error;
    }
    await this.audit.recordMutation({
      tenantId,
      userId: actorId,
      action: 'lead_source.created',
      resourceType: 'lead_source',
      resourceId: source.id,
    });
    return mapLeadSource(source);
  }

  async update(
    tenantId: string,
    actorId: string,
    sourceId: string,
    input: UpdateLeadSourceRequest,
  ): Promise<LeadSourceResponse> {
    if (Object.keys(input).length === 0) {
      throw new BadRequestException('At least one lead source field is required.');
    }
    const label = input.label === undefined ? undefined : nonBlank(input.label, 'label');
    let source: LeadSource;
    try {
      source = await this.database.withTenant(tenantId, async (tx) => {
        const updated = await tx.leadSource.updateMany({
          where: { id: sourceId, tenantId },
          data: {
            ...(input.key !== undefined ? { key: input.key } : {}),
            ...(label !== undefined ? { label } : {}),
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
        });
        if (updated.count === 0) throw new NotFoundException('Lead source not found.');
        const result = await tx.leadSource.findFirst({ where: { id: sourceId, tenantId } });
        if (!result) throw new NotFoundException('Lead source not found.');
        return result;
      });
    } catch (error) {
      translateSourceConflict(error);
      throw error;
    }
    await this.audit.recordMutation({
      tenantId,
      userId: actorId,
      action: 'lead_source.updated',
      resourceType: 'lead_source',
      resourceId: source.id,
    });
    return mapLeadSource(source);
  }

  async deactivate(tenantId: string, actorId: string, sourceId: string): Promise<void> {
    const updated = await this.database.withTenant(tenantId, (tx) =>
      tx.leadSource.updateMany({
        where: { id: sourceId, tenantId, isActive: true },
        data: { isActive: false },
      }),
    );
    if (updated.count === 0) throw new NotFoundException('Active lead source not found.');
    await this.audit.recordMutation({
      tenantId,
      userId: actorId,
      action: 'lead_source.deactivated',
      resourceType: 'lead_source',
      resourceId: sourceId,
    });
  }
}

function nonBlank(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new BadRequestException(`${field} cannot be blank.`);
  return trimmed;
}

function translateSourceConflict(error: unknown): void {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new ConflictException('Lead source key already exists in this tenant.');
  }
}

function mapLeadSource(source: LeadSource): LeadSourceResponse {
  return {
    id: source.id,
    key: source.key,
    label: source.label,
    category: source.category,
    isActive: source.isActive,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  };
}
