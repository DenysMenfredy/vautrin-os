import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateCustomFieldDefinitionRequest,
  CustomFieldDefinitionResponse,
  CustomFieldEntityType,
  CustomFieldValue as CustomFieldJsonValue,
  CustomFieldType,
  CustomFieldValueResponse,
  ListCustomFieldDefinitionsRequest,
  PageResponse,
  SetCustomFieldValueRequest,
  UpdateCustomFieldDefinitionRequest,
} from '@vautrin/contracts';
import {
  type CustomFieldDefinition as DbCustomFieldDefinition,
  type CustomFieldValue as DbCustomFieldValue,
  Prisma,
  type TenantScopedClient,
} from '@vautrin/database';

import { AuditService } from '../audit/audit.service.js';
import { DatabaseService } from '../database/database.service.js';

const DEFAULT_PAGE_SIZE = 50;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPPORTED_ENTITY_TYPES = ['CONTACT', 'LEAD', 'ESTIMATE'] as const;
const SUPPORTED_ENTITIES = new Set<string>(SUPPORTED_ENTITY_TYPES);

@Injectable()
export class CustomFieldsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async listDefinitions(
    tenantId: string,
    options: ListCustomFieldDefinitionsRequest,
  ): Promise<PageResponse<CustomFieldDefinitionResponse>> {
    const limit = options.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = decodeCursor(options.cursor);
    const where: Prisma.CustomFieldDefinitionWhereInput = {
      tenantId,
      entityType: options.entityType ?? { in: [...SUPPORTED_ENTITY_TYPES] },
    };
    if (options.active !== undefined) where.isActive = options.active;
    if (options.search) {
      where.OR = [
        { key: { contains: options.search, mode: 'insensitive' } },
        { label: { contains: options.search, mode: 'insensitive' } },
      ];
    }
    if (cursor) where.AND = [cursorFilter(cursor)];

    const rows = await this.database.withTenant(tenantId, (tx) =>
      tx.customFieldDefinition.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    );
    return buildPage(rows, limit, mapDefinition);
  }

  async getDefinition(
    tenantId: string,
    definitionId: string,
  ): Promise<CustomFieldDefinitionResponse> {
    const definition = await this.database.withTenant(tenantId, (tx) =>
      tx.customFieldDefinition.findFirst({
        where: { id: definitionId, tenantId, entityType: { in: [...SUPPORTED_ENTITY_TYPES] } },
      }),
    );
    if (!definition) throw new NotFoundException('Custom field definition not found.');
    return mapDefinition(definition);
  }

  async createDefinition(
    tenantId: string,
    actorId: string,
    input: CreateCustomFieldDefinitionRequest,
  ): Promise<CustomFieldDefinitionResponse> {
    assertSupportedEntity(input.entityType);
    assertNonBlank(input.label, 'label');
    const options = assertDefinitionOptions(input.fieldType, input.options ?? []);

    let definition: DbCustomFieldDefinition;
    try {
      definition = await this.database.withTenant(tenantId, (tx) =>
        tx.customFieldDefinition.create({
          data: {
            tenantId,
            entityType: input.entityType,
            key: input.key,
            label: input.label.trim(),
            fieldType: input.fieldType,
            options: options as Prisma.InputJsonValue,
            isRequired: input.isRequired ?? false,
            isActive: input.isActive ?? true,
            displayOrder: input.displayOrder ?? 0,
          },
        }),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A custom field with this key already exists for the entity.');
      }
      throw error;
    }

    await this.audit.recordMutation({
      tenantId,
      userId: actorId,
      action: 'business.custom_field_definition.created',
      resourceType: 'custom_field_definition',
      resourceId: definition.id,
    });
    return mapDefinition(definition);
  }

  async updateDefinition(
    tenantId: string,
    actorId: string,
    definitionId: string,
    input: UpdateCustomFieldDefinitionRequest,
  ): Promise<CustomFieldDefinitionResponse> {
    if (Object.keys(input).length === 0) {
      throw new BadRequestException('At least one custom field definition field is required.');
    }
    if (input.label !== undefined) assertNonBlank(input.label, 'label');

    let definition: CustomFieldDefinitionRecord;
    try {
      definition = await this.database.withTenant(tenantId, async (tx) => {
        await lockCustomFieldDefinition(tx, definitionId);
        const existing = await tx.customFieldDefinition.findFirst({
          where: {
            id: definitionId,
            tenantId,
            entityType: { in: [...SUPPORTED_ENTITY_TYPES] },
          },
        });
        if (!existing) throw new NotFoundException('Custom field definition not found.');

        const fieldType = input.fieldType ?? existing.fieldType;
        const currentOptions = asStringOptions(existing.options);
        const inheritedOptions =
          input.fieldType !== undefined && !isChoiceField(fieldType) ? [] : currentOptions;
        const options = assertDefinitionOptions(fieldType, input.options ?? inheritedOptions);

        if (input.fieldType !== undefined || input.options !== undefined) {
          const currentValues = await tx.customFieldValue.findMany({
            where: { tenantId, definitionId },
            select: { value: true },
          });
          if (
            currentValues.some(
              ({ value }) => value === null || !isValidFieldValue(fieldType, value, options),
            )
          ) {
            throw new ConflictException(
              'The field type or options cannot be changed while existing values would become invalid.',
            );
          }
        }

        return tx.customFieldDefinition.update({
          where: { id: existing.id },
          data: {
            ...(input.key !== undefined ? { key: input.key } : {}),
            ...(input.label !== undefined ? { label: input.label.trim() } : {}),
            ...(input.fieldType !== undefined ? { fieldType } : {}),
            ...(input.options !== undefined || input.fieldType !== undefined
              ? { options: options as Prisma.InputJsonValue }
              : {}),
            ...(input.isRequired !== undefined ? { isRequired: input.isRequired } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
            ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A custom field with this key already exists for the entity.');
      }
      throw error;
    }

    await this.audit.recordMutation({
      tenantId,
      userId: actorId,
      action: 'business.custom_field_definition.updated',
      resourceType: 'custom_field_definition',
      resourceId: definition.id,
    });
    return mapDefinition(definition);
  }

  async deactivateDefinition(
    tenantId: string,
    actorId: string,
    definitionId: string,
  ): Promise<void> {
    const result = await this.database.withTenant(tenantId, async (tx) => {
      await lockCustomFieldDefinition(tx, definitionId);
      const existing = await tx.customFieldDefinition.findFirst({
        where: {
          id: definitionId,
          tenantId,
          entityType: { in: [...SUPPORTED_ENTITY_TYPES] },
        },
        select: { id: true, isActive: true },
      });
      if (!existing) throw new NotFoundException('Custom field definition not found.');
      if (!existing.isActive) return { id: existing.id, changed: false };
      const updated = await tx.customFieldDefinition.update({
        where: { id: existing.id },
        data: { isActive: false },
        select: { id: true },
      });
      return { id: updated.id, changed: true };
    });

    if (result.changed) {
      await this.audit.recordMutation({
        tenantId,
        userId: actorId,
        action: 'business.custom_field_definition.deactivated',
        resourceType: 'custom_field_definition',
        resourceId: result.id,
      });
    }
  }

  async listValues(
    tenantId: string,
    entityType: CustomFieldEntityType,
    entityId: string,
  ): Promise<readonly CustomFieldValueResponse[]> {
    assertSupportedEntity(entityType);
    const values = await this.database.withTenant(tenantId, async (tx) => {
      await assertEntityExists(tx, tenantId, entityType, entityId);
      return tx.customFieldValue.findMany({
        where: { tenantId, entityType, entityId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    });
    return values.map(mapValue);
  }

  async setValue(
    tenantId: string,
    actorId: string,
    entityType: CustomFieldEntityType,
    entityId: string,
    definitionId: string,
    input: SetCustomFieldValueRequest,
  ): Promise<CustomFieldValueResponse> {
    assertSupportedEntity(entityType);
    let value: CustomFieldValueRecord;
    try {
      value = await this.database.withTenant(tenantId, async (tx) => {
        await assertEntityExists(tx, tenantId, entityType, entityId);
        // Serialize assignment with definition edits so validation cannot use
        // stale type or option metadata.
        await lockCustomFieldDefinition(tx, definitionId);
        const definition = await tx.customFieldDefinition.findFirst({
          where: { id: definitionId, tenantId, entityType, isActive: true },
        });
        if (!definition) {
          throw new NotFoundException('Active custom field definition not found for this entity.');
        }
        if (
          !isValidFieldValue(definition.fieldType, input.value, asStringOptions(definition.options))
        ) {
          throw new BadRequestException(
            `value does not match the ${definition.fieldType} custom field definition.`,
          );
        }
        if (definition.isRequired && isEmptyRequiredValue(input.value)) {
          throw new BadRequestException('A required custom field value cannot be empty.');
        }

        return tx.customFieldValue.upsert({
          where: {
            tenantId_definitionId_entityId: { tenantId, definitionId, entityId },
          },
          create: {
            tenantId,
            definitionId,
            entityType,
            entityId,
            value: input.value as Prisma.InputJsonValue,
          },
          update: {
            entityType,
            value: input.value as Prisma.InputJsonValue,
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Custom field value could not be stored due to a conflict.');
      }
      throw error;
    }

    await this.audit.recordMutation({
      tenantId,
      userId: actorId,
      action: 'business.custom_field_value.set',
      resourceType: 'custom_field_value',
      resourceId: value.id,
    });
    return mapValue(value);
  }

  async deleteValue(
    tenantId: string,
    actorId: string,
    entityType: CustomFieldEntityType,
    entityId: string,
    definitionId: string,
  ): Promise<void> {
    assertSupportedEntity(entityType);
    const value = await this.database.withTenant(tenantId, async (tx) => {
      await assertEntityExists(tx, tenantId, entityType, entityId);
      await lockCustomFieldDefinition(tx, definitionId);
      const existing = await tx.customFieldValue.findFirst({
        where: { tenantId, entityType, entityId, definitionId },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Custom field value not found.');
      const definition = await tx.customFieldDefinition.findFirst({
        where: { id: definitionId, tenantId, entityType },
        select: { isRequired: true },
      });
      if (!definition) throw new NotFoundException('Custom field definition not found.');
      if (definition.isRequired) {
        throw new BadRequestException('A required custom field value cannot be removed.');
      }
      await tx.customFieldValue.delete({ where: { id: existing.id } });
      return existing;
    });

    await this.audit.recordMutation({
      tenantId,
      userId: actorId,
      action: 'business.custom_field_value.deleted',
      resourceType: 'custom_field_value',
      resourceId: value.id,
    });
  }
}

type CustomFieldDefinitionRecord = DbCustomFieldDefinition;
type CustomFieldValueRecord = DbCustomFieldValue;

async function assertEntityExists(
  tx: TenantScopedClient,
  tenantId: string,
  entityType: CustomFieldEntityType,
  entityId: string,
): Promise<void> {
  const entity = await (() => {
    switch (entityType) {
      case 'CONTACT':
        return tx.contact.findFirst({
          where: { id: entityId, tenantId, deletedAt: null },
          select: { id: true },
        });
      case 'LEAD':
        return tx.lead.findFirst({
          where: { id: entityId, tenantId, deletedAt: null },
          select: { id: true },
        });
      case 'ESTIMATE':
        return tx.estimate.findFirst({
          where: { id: entityId, tenantId, deletedAt: null },
          select: { id: true },
        });
    }
  })();
  if (!entity) throw new NotFoundException(`${entityType.toLowerCase()} not found.`);
}

async function lockCustomFieldDefinition(
  tx: TenantScopedClient,
  definitionId: string,
): Promise<void> {
  await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_advisory_xact_lock(hashtextextended(${definitionId}, 0)) IS NULL AS locked
  `;
}

function assertSupportedEntity(value: string): asserts value is CustomFieldEntityType {
  if (!SUPPORTED_ENTITIES.has(value)) {
    throw new BadRequestException('entityType must be CONTACT, LEAD, or ESTIMATE.');
  }
}

function assertDefinitionOptions(
  fieldType: CustomFieldType,
  options: readonly string[],
): readonly string[] {
  if (!isChoiceField(fieldType) && options.length > 0) {
    throw new BadRequestException('options are only supported for SELECT and MULTI_SELECT fields.');
  }
  return options;
}

function isChoiceField(fieldType: CustomFieldType): boolean {
  return fieldType === 'SELECT' || fieldType === 'MULTI_SELECT';
}

function isEmptyRequiredValue(value: CustomFieldJsonValue): boolean {
  if (typeof value === 'string') return value.trim().length === 0;
  return Array.isArray(value) && value.length === 0;
}

function isValidFieldValue(
  fieldType: CustomFieldType,
  value: unknown,
  options: readonly string[],
): value is CustomFieldJsonValue {
  switch (fieldType) {
    case 'TEXT':
    case 'DATE':
    case 'SELECT':
      return (
        typeof value === 'string' &&
        (fieldType !== 'SELECT' || options.includes(value)) &&
        (fieldType !== 'DATE' || isIsoDate(value))
      );
    case 'NUMBER':
    case 'CURRENCY':
      return typeof value === 'number' && Number.isFinite(value);
    case 'BOOLEAN':
      return typeof value === 'boolean';
    case 'MULTI_SELECT':
      return (
        Array.isArray(value) &&
        value.every((item) => typeof item === 'string' && options.includes(item)) &&
        new Set(value).size === value.length
      );
    default:
      return false;
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function assertNonBlank(value: string, field: string): void {
  if (!value.trim()) throw new BadRequestException(`${field} must not be blank.`);
}

function asStringOptions(value: Prisma.JsonValue): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ConflictException('Custom field definition options are invalid.');
  }
  return value as readonly string[];
}

function mapDefinition(definition: DbCustomFieldDefinition): CustomFieldDefinitionResponse {
  assertSupportedEntity(definition.entityType);
  return {
    id: definition.id,
    entityType: definition.entityType,
    key: definition.key,
    label: definition.label,
    fieldType: definition.fieldType,
    options: asStringOptions(definition.options),
    isRequired: definition.isRequired,
    isActive: definition.isActive,
    displayOrder: definition.displayOrder,
    createdAt: definition.createdAt.toISOString(),
    updatedAt: definition.updatedAt.toISOString(),
  };
}

function mapValue(value: DbCustomFieldValue): CustomFieldValueResponse {
  assertSupportedEntity(value.entityType);
  return {
    id: value.id,
    definitionId: value.definitionId,
    entityType: value.entityType,
    entityId: value.entityId,
    value: value.value as CustomFieldJsonValue | null,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
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

function buildPage<T extends { id: string; createdAt: Date }, R>(
  rows: T[],
  limit: number,
  map: (row: T) => R,
): PageResponse<R> {
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

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
