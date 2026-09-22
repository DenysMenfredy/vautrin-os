import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ContactPageResponse,
  ContactResponse,
  CreateContactRequest,
  ListContactsRequest,
  UpdateContactRequest,
} from '@vautrin/contracts';
import { type Contact as DbContact, Prisma } from '@vautrin/database';

import { AuditService } from '../audit/audit.service.js';
import { DatabaseService } from '../database/database.service.js';

const DEFAULT_PAGE_SIZE = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ContactsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, options: ListContactsRequest): Promise<ContactPageResponse> {
    const limit = options.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = decodeCursor(options.cursor);
    const where: Prisma.ContactWhereInput = { tenantId, deletedAt: null };
    const search = options.search?.trim();
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { company: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (cursor) where.AND = [cursorFilter(cursor)];

    const rows = await this.database.withTenant(tenantId, (tx) =>
      tx.contact.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    );
    return buildPage(rows, limit, mapContact);
  }

  async get(tenantId: string, contactId: string): Promise<ContactResponse> {
    const contact = await this.database.withTenant(tenantId, (tx) =>
      tx.contact.findFirst({ where: { id: contactId, tenantId, deletedAt: null } }),
    );
    if (!contact) throw new NotFoundException('Contact not found.');
    return mapContact(contact);
  }

  async create(
    tenantId: string,
    actorId: string,
    input: CreateContactRequest,
  ): Promise<ContactResponse> {
    const address = toAddressJson(input.address);
    const contact = await this.database.withTenant(tenantId, (tx) =>
      tx.contact.create({
        data: {
          tenantId,
          ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
          ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
          ...(input.email !== undefined ? { email: normalizeEmail(input.email) } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.company !== undefined ? { company: input.company } : {}),
          ...(address !== undefined ? { address } : {}),
          tags: [...(input.tags ?? [])],
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          createdBy: actorId,
          updatedBy: actorId,
        },
      }),
    );

    await this.audit.recordMutation({
      tenantId,
      userId: actorId,
      action: 'contact.created',
      resourceType: 'contact',
      resourceId: contact.id,
    });
    return mapContact(contact);
  }

  async update(
    tenantId: string,
    actorId: string,
    contactId: string,
    input: UpdateContactRequest,
  ): Promise<ContactResponse> {
    if (Object.keys(input).length === 0) {
      throw new BadRequestException('At least one contact field is required.');
    }
    const address = toAddressJson(input.address);
    const contact = await this.database.withTenant(tenantId, async (tx) => {
      const updated = await tx.contact.updateMany({
        where: { id: contactId, tenantId, deletedAt: null },
        data: {
          ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
          ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
          ...(input.email !== undefined ? { email: normalizeEmail(input.email) } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.company !== undefined ? { company: input.company } : {}),
          ...(address !== undefined ? { address } : {}),
          ...(input.tags !== undefined ? { tags: [...input.tags] } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          updatedBy: actorId,
          updatedAt: new Date(),
        },
      });
      if (updated.count === 0) throw new NotFoundException('Contact not found.');
      const result = await tx.contact.findFirst({
        where: { id: contactId, tenantId, deletedAt: null },
      });
      if (!result) throw new NotFoundException('Contact not found.');
      return result;
    });

    await this.audit.recordMutation({
      tenantId,
      userId: actorId,
      action: 'contact.updated',
      resourceType: 'contact',
      resourceId: contact.id,
    });
    return mapContact(contact);
  }

  async archive(tenantId: string, actorId: string, contactId: string): Promise<void> {
    const now = new Date();
    const archived = await this.database.withTenant(tenantId, (tx) =>
      tx.contact.updateMany({
        where: { id: contactId, tenantId, deletedAt: null },
        data: { deletedAt: now, updatedAt: now, updatedBy: actorId },
      }),
    );
    if (archived.count === 0) throw new NotFoundException('Contact not found.');

    await this.audit.recordMutation({
      tenantId,
      userId: actorId,
      action: 'contact.archived',
      resourceType: 'contact',
      resourceId: contactId,
    });
  }
}

function toAddressJson(
  address: CreateContactRequest['address'],
): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (address === undefined) return undefined;
  if (address === null) return Prisma.DbNull;
  return address as Prisma.InputJsonValue;
}

function normalizeEmail(email: string | null): string | null {
  return email?.trim().toLowerCase() ?? null;
}

function mapContact(contact: DbContact): ContactResponse {
  return {
    id: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,
    company: contact.company,
    address: contact.address as ContactResponse['address'],
    tags: contact.tags,
    notes: contact.notes,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}

interface PageCursor {
  readonly id: string;
  readonly createdAt: Date;
}

function decodeCursor(value: string | undefined): PageCursor | null {
  if (value === undefined) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      id?: unknown;
      createdAt?: unknown;
    };
    if (typeof decoded.id !== 'string' || !UUID_PATTERN.test(decoded.id)) throw new Error();
    if (typeof decoded.createdAt !== 'string') throw new Error();
    const createdAt = new Date(decoded.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Error();
    return { id: decoded.id, createdAt };
  } catch {
    throw new BadRequestException('cursor is invalid.');
  }
}

function cursorFilter(cursor: PageCursor) {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

function buildPage<T extends { id: string; createdAt: Date }, R extends ContactResponse>(
  rows: T[],
  limit: number,
  map: (row: T) => R,
): ContactPageResponse {
  const hasMore = rows.length > limit;
  const visible = rows.slice(0, limit);
  const last = visible.at(-1);
  return {
    items: visible.map(map),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}

function encodeCursor(row: { id: string; createdAt: Date }): string {
  return Buffer.from(
    JSON.stringify({ id: row.id, createdAt: row.createdAt.toISOString() }),
    'utf8',
  ).toString('base64url');
}
