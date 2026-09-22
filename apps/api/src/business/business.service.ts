import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  BusinessListRequest,
  BusinessProfileResponse,
  CreateLocationRequest,
  CreateServiceAreaRequest,
  CreateServiceRequest,
  LocationResponse,
  PageResponse,
  ServiceAreaResponse,
  ServiceResponse,
  UpdateBusinessProfileRequest,
  UpdateLocationRequest,
  UpdateServiceAreaRequest,
  UpdateServiceRequest,
} from '@vautrin/contracts';
import { Prisma } from '@vautrin/database';

import { AuditService } from '../audit/audit.service.js';
import { DatabaseService } from '../database/database.service.js';

const DEFAULT_PAGE_SIZE = 50;

@Injectable()
export class BusinessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async getProfile(tenantId: string): Promise<BusinessProfileResponse> {
    const profile = await this.database.withTenant(tenantId, (tx) =>
      tx.businessProfile.findUnique({ where: { tenantId } }),
    );
    if (!profile) throw new NotFoundException('Business profile not found.');
    return mapProfile(profile);
  }

  async updateProfile(
    tenantId: string,
    actorId: string,
    input: UpdateBusinessProfileRequest,
  ): Promise<BusinessProfileResponse> {
    if (Object.keys(input).length === 0) {
      throw new BadRequestException('At least one business profile field is required.');
    }
    if (input.displayName !== undefined) assertNonBlank(input.displayName, 'displayName');
    assertProfileSettings(input);
    const profile = await this.database.withTenant(tenantId, async (tx) => {
      const existing = await tx.businessProfile.findUnique({ where: { tenantId } });
      if (!existing && !input.displayName?.trim()) {
        throw new BadRequestException('displayName is required to create the business profile.');
      }

      const patch = profilePatch(input);
      return tx.businessProfile.upsert({
        where: { tenantId },
        create: {
          tenantId,
          displayName: input.displayName?.trim() ?? '',
          legalName: input.legalName ?? null,
          phone: input.phone ?? null,
          email: input.email?.trim().toLowerCase() ?? null,
          website: input.website ?? null,
          description: input.description ?? null,
          timezone: input.timezone ?? 'America/New_York',
          locale: input.locale ?? 'en-US',
          currency: input.currency?.toUpperCase() ?? 'USD',
        },
        update: patch,
      });
    });

    await this.audit.recordMutation({
      tenantId,
      userId: actorId,
      action: 'business.profile.updated',
      resourceType: 'business_profile',
      resourceId: profile.id,
    });
    return mapProfile(profile);
  }

  async createLocation(
    tenantId: string,
    actorId: string,
    input: CreateLocationRequest,
  ): Promise<LocationResponse> {
    assertNonBlank(input.name, 'name');
    assertCoordinatePair(input.latitude ?? null, input.longitude ?? null);
    assertTimezone(input.timezone);

    const location = await this.database.withTenant(tenantId, async (tx) => {
      if (input.isPrimary) {
        await lockPrimaryLocationChanges(tx, tenantId);
        await tx.location.updateMany({
          where: { deletedAt: null, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      return tx.location.create({
        data: {
          tenantId,
          name: input.name.trim(),
          addressLine1: input.addressLine1 ?? null,
          addressLine2: input.addressLine2 ?? null,
          city: input.city ?? null,
          region: input.region ?? null,
          postalCode: input.postalCode ?? null,
          country: (input.country ?? 'US').toUpperCase(),
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          timezone: input.timezone ?? null,
          isPrimary: input.isPrimary ?? false,
          serviceRadiusMiles: input.serviceRadiusMiles ?? null,
        },
      });
    });

    await this.audit.recordMutation({
      tenantId,
      userId: actorId,
      action: 'business.location.created',
      resourceType: 'location',
      resourceId: location.id,
    });
    return mapLocation(location);
  }

  async listLocations(
    tenantId: string,
    options: BusinessListRequest,
  ): Promise<PageResponse<LocationResponse>> {
    const limit = pageSize(options.limit);
    const cursor = decodeCursor(options.cursor);
    const where: Prisma.LocationWhereInput = { deletedAt: null };
    if (options.search) {
      where.OR = [
        { name: { contains: options.search, mode: 'insensitive' } },
        { city: { contains: options.search, mode: 'insensitive' } },
        { region: { contains: options.search, mode: 'insensitive' } },
        { postalCode: { contains: options.search, mode: 'insensitive' } },
      ];
    }
    if (cursor) where.AND = [cursorFilter(cursor)];
    const rows = await this.database.withTenant(tenantId, (tx) =>
      tx.location.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    );

    return buildPage(rows, limit, mapLocation);
  }

  async getLocation(tenantId: string, locationId: string): Promise<LocationResponse> {
    const location = await this.database.withTenant(tenantId, (tx) =>
      tx.location.findFirst({ where: { id: locationId, deletedAt: null } }),
    );
    if (!location) throw new NotFoundException('Location not found.');
    return mapLocation(location);
  }

  async updateLocation(
    tenantId: string,
    actorId: string,
    locationId: string,
    input: UpdateLocationRequest,
  ): Promise<LocationResponse> {
    if (input.name !== undefined) assertNonBlank(input.name, 'name');
    assertTimezone(input.timezone);
    const location = await this.database.withTenant(tenantId, async (tx) => {
      const existing = await tx.location.findFirst({
        where: { id: locationId, deletedAt: null },
      });
      if (!existing) throw new NotFoundException('Location not found.');

      assertCoordinatePair(
        input.latitude === undefined ? (existing.latitude?.toNumber() ?? null) : input.latitude,
        input.longitude === undefined ? (existing.longitude?.toNumber() ?? null) : input.longitude,
      );

      if (input.isPrimary) {
        await lockPrimaryLocationChanges(tx, tenantId);
        await tx.location.updateMany({
          where: { id: { not: locationId }, deletedAt: null, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      return tx.location.update({
        where: { id: locationId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.addressLine1 !== undefined ? { addressLine1: input.addressLine1 } : {}),
          ...(input.addressLine2 !== undefined ? { addressLine2: input.addressLine2 } : {}),
          ...(input.city !== undefined ? { city: input.city } : {}),
          ...(input.region !== undefined ? { region: input.region } : {}),
          ...(input.postalCode !== undefined ? { postalCode: input.postalCode } : {}),
          ...(input.country !== undefined ? { country: input.country.toUpperCase() } : {}),
          ...(input.latitude !== undefined ? { latitude: input.latitude } : {}),
          ...(input.longitude !== undefined ? { longitude: input.longitude } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
          ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
          ...(input.serviceRadiusMiles !== undefined
            ? { serviceRadiusMiles: input.serviceRadiusMiles }
            : {}),
        },
      });
    });

    await this.audit.recordMutation({
      tenantId,
      userId: actorId,
      action: 'business.location.updated',
      resourceType: 'location',
      resourceId: location.id,
    });
    return mapLocation(location);
  }

  async deleteLocation(tenantId: string, actorId: string, locationId: string): Promise<void> {
    const location = await this.database.withTenant(tenantId, async (tx) => {
      const existing = await tx.location.findFirst({
        where: { id: locationId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Location not found.');
      return tx.location.update({
        where: { id: existing.id },
        data: { deletedAt: new Date(), isPrimary: false },
        select: { id: true },
      });
    });

    await this.audit.recordMutation({
      tenantId,
      userId: actorId,
      action: 'business.location.deleted',
      resourceType: 'location',
      resourceId: location.id,
    });
  }

  async createService(
    tenantId: string,
    actorId: string,
    input: CreateServiceRequest,
  ): Promise<ServiceResponse> {
    assertNonBlank(input.name, 'name');
    try {
      const service = await this.database.withTenant(tenantId, (tx) =>
        tx.service.create({
          data: {
            tenantId,
            key: input.key,
            name: input.name.trim(),
            description: input.description ?? null,
            active: input.active ?? true,
            metadata: jsonObject(input.metadata),
          },
        }),
      );
      await this.audit.recordMutation({
        tenantId,
        userId: actorId,
        action: 'business.service.created',
        resourceType: 'service',
        resourceId: service.id,
      });
      return mapService(service);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A service with this key exists.');
      throw error;
    }
  }

  async listServices(
    tenantId: string,
    options: BusinessListRequest,
  ): Promise<PageResponse<ServiceResponse>> {
    const limit = pageSize(options.limit);
    const cursor = decodeCursor(options.cursor);
    const where: Prisma.ServiceWhereInput = {};
    if (options.active !== undefined) where.active = options.active;
    if (options.search) {
      where.OR = [
        { key: { contains: options.search, mode: 'insensitive' } },
        { name: { contains: options.search, mode: 'insensitive' } },
        { description: { contains: options.search, mode: 'insensitive' } },
      ];
    }
    if (cursor) where.AND = [cursorFilter(cursor)];
    const rows = await this.database.withTenant(tenantId, (tx) =>
      tx.service.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    );
    return buildPage(rows, limit, mapService);
  }

  async getService(tenantId: string, serviceId: string): Promise<ServiceResponse> {
    const service = await this.database.withTenant(tenantId, (tx) =>
      tx.service.findUnique({ where: { id: serviceId } }),
    );
    if (!service) throw new NotFoundException('Service not found.');
    return mapService(service);
  }

  async updateService(
    tenantId: string,
    actorId: string,
    serviceId: string,
    input: UpdateServiceRequest,
  ): Promise<ServiceResponse> {
    if (input.name !== undefined) assertNonBlank(input.name, 'name');
    try {
      const service = await this.database.withTenant(tenantId, (tx) =>
        tx.service.update({
          where: { id: serviceId },
          data: {
            ...(input.key !== undefined ? { key: input.key } : {}),
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
            ...(input.metadata !== undefined ? { metadata: jsonObject(input.metadata) } : {}),
          },
        }),
      );
      await this.audit.recordMutation({
        tenantId,
        userId: actorId,
        action: 'business.service.updated',
        resourceType: 'service',
        resourceId: service.id,
      });
      return mapService(service);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('A service with this key exists.');
      if (isRecordNotFound(error)) throw new NotFoundException('Service not found.');
      throw error;
    }
  }

  async deleteService(tenantId: string, actorId: string, serviceId: string): Promise<void> {
    const result = await this.database.withTenant(tenantId, (tx) =>
      tx.service.updateMany({
        where: { id: serviceId, active: true },
        data: { active: false },
      }),
    );
    if (result.count === 0) {
      const exists = await this.database.withTenant(tenantId, (tx) =>
        tx.service.findUnique({ where: { id: serviceId }, select: { id: true, active: true } }),
      );
      if (!exists) throw new NotFoundException('Service not found.');
      if (!exists.active) return;
    }
    await this.audit.recordMutation({
      tenantId,
      userId: actorId,
      action: 'business.service.deactivated',
      resourceType: 'service',
      resourceId: serviceId,
    });
  }

  async createServiceArea(
    tenantId: string,
    actorId: string,
    input: CreateServiceAreaRequest,
  ): Promise<ServiceAreaResponse> {
    assertNonBlank(input.value, 'value');
    const serviceArea = await this.database.withTenant(tenantId, (tx) =>
      tx.serviceArea.create({
        data: {
          tenantId,
          type: input.type,
          value: input.value.trim(),
          configuration: jsonObject(input.configuration),
          active: input.active ?? true,
        },
      }),
    );
    await this.audit.recordMutation({
      tenantId,
      userId: actorId,
      action: 'business.service_area.created',
      resourceType: 'service_area',
      resourceId: serviceArea.id,
    });
    return mapServiceArea(serviceArea);
  }

  async listServiceAreas(
    tenantId: string,
    options: BusinessListRequest,
  ): Promise<PageResponse<ServiceAreaResponse>> {
    const limit = pageSize(options.limit);
    const cursor = decodeCursor(options.cursor);
    const where: Prisma.ServiceAreaWhereInput = {};
    if (options.active !== undefined) where.active = options.active;
    if (options.search) {
      where.value = { contains: options.search, mode: 'insensitive' };
    }
    if (cursor) where.AND = [cursorFilter(cursor)];
    const rows = await this.database.withTenant(tenantId, (tx) =>
      tx.serviceArea.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      }),
    );
    return buildPage(rows, limit, mapServiceArea);
  }

  async getServiceArea(tenantId: string, serviceAreaId: string): Promise<ServiceAreaResponse> {
    const serviceArea = await this.database.withTenant(tenantId, (tx) =>
      tx.serviceArea.findUnique({ where: { id: serviceAreaId } }),
    );
    if (!serviceArea) throw new NotFoundException('Service area not found.');
    return mapServiceArea(serviceArea);
  }

  async updateServiceArea(
    tenantId: string,
    actorId: string,
    serviceAreaId: string,
    input: UpdateServiceAreaRequest,
  ): Promise<ServiceAreaResponse> {
    if (input.value !== undefined) assertNonBlank(input.value, 'value');
    try {
      const serviceArea = await this.database.withTenant(tenantId, (tx) =>
        tx.serviceArea.update({
          where: { id: serviceAreaId },
          data: {
            ...(input.type !== undefined ? { type: input.type } : {}),
            ...(input.value !== undefined ? { value: input.value.trim() } : {}),
            ...(input.configuration !== undefined
              ? { configuration: jsonObject(input.configuration) }
              : {}),
            ...(input.active !== undefined ? { active: input.active } : {}),
          },
        }),
      );
      await this.audit.recordMutation({
        tenantId,
        userId: actorId,
        action: 'business.service_area.updated',
        resourceType: 'service_area',
        resourceId: serviceArea.id,
      });
      return mapServiceArea(serviceArea);
    } catch (error) {
      if (isRecordNotFound(error)) throw new NotFoundException('Service area not found.');
      throw error;
    }
  }

  async deleteServiceArea(tenantId: string, actorId: string, serviceAreaId: string): Promise<void> {
    const result = await this.database.withTenant(tenantId, (tx) =>
      tx.serviceArea.updateMany({
        where: { id: serviceAreaId, active: true },
        data: { active: false },
      }),
    );
    if (result.count === 0) {
      const exists = await this.database.withTenant(tenantId, (tx) =>
        tx.serviceArea.findUnique({
          where: { id: serviceAreaId },
          select: { id: true, active: true },
        }),
      );
      if (!exists) throw new NotFoundException('Service area not found.');
      if (!exists.active) return;
    }
    await this.audit.recordMutation({
      tenantId,
      userId: actorId,
      action: 'business.service_area.deactivated',
      resourceType: 'service_area',
      resourceId: serviceAreaId,
    });
  }
}

function profilePatch(input: UpdateBusinessProfileRequest): Prisma.BusinessProfileUpdateInput {
  return {
    ...(input.displayName !== undefined ? { displayName: input.displayName.trim() } : {}),
    ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.email !== undefined ? { email: input.email?.trim().toLowerCase() ?? null } : {}),
    ...(input.website !== undefined ? { website: input.website } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    ...(input.locale !== undefined ? { locale: input.locale } : {}),
    ...(input.currency !== undefined ? { currency: input.currency.toUpperCase() } : {}),
  };
}

function assertProfileSettings(input: UpdateBusinessProfileRequest): void {
  if (input.timezone !== undefined) assertTimezone(input.timezone);
  if (input.locale !== undefined) {
    try {
      if (!Intl.getCanonicalLocales(input.locale).at(0)) throw new Error('invalid locale');
    } catch {
      throw new BadRequestException('locale must be a valid BCP 47 language tag.');
    }
  }
}

function assertTimezone(timezone: string | null | undefined): void {
  if (timezone === undefined || timezone === null) return;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new BadRequestException('timezone must be a valid IANA time zone.');
  }
}

function assertNonBlank(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new BadRequestException(`${field} must not be blank.`);
  }
}

async function lockPrimaryLocationChanges(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  // Advisory locks serialize primary-location promotion for one tenant. The
  // lock is transaction-scoped and only causes harmless extra serialization
  // in the extremely unlikely event of a 64-bit hash collision.
  await tx.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 0)) IS NULL AS locked
  `;
}

function assertCoordinatePair(latitude: number | null, longitude: number | null): void {
  if ((latitude === null) !== (longitude === null)) {
    throw new BadRequestException('latitude and longitude must be provided or cleared together.');
  }
}

function jsonObject(value: Readonly<Record<string, unknown>> | undefined): Prisma.InputJsonObject {
  return (value ?? {}) as Prisma.InputJsonObject;
}

function mapProfile(profile: {
  id: string;
  displayName: string;
  legalName: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  description: string | null;
  timezone: string;
  locale: string;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}): BusinessProfileResponse {
  return {
    id: profile.id,
    displayName: profile.displayName,
    legalName: profile.legalName,
    phone: profile.phone,
    email: profile.email,
    website: profile.website,
    description: profile.description,
    timezone: profile.timezone,
    locale: profile.locale,
    currency: profile.currency,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

function mapLocation(location: {
  id: string;
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string;
  latitude: { toNumber(): number } | null;
  longitude: { toNumber(): number } | null;
  timezone: string | null;
  isPrimary: boolean;
  serviceRadiusMiles: number | null;
  createdAt: Date;
  updatedAt: Date;
}): LocationResponse {
  return {
    id: location.id,
    name: location.name,
    addressLine1: location.addressLine1,
    addressLine2: location.addressLine2,
    city: location.city,
    region: location.region,
    postalCode: location.postalCode,
    country: location.country,
    latitude: location.latitude?.toNumber() ?? null,
    longitude: location.longitude?.toNumber() ?? null,
    timezone: location.timezone,
    isPrimary: location.isPrimary,
    serviceRadiusMiles: location.serviceRadiusMiles,
    createdAt: location.createdAt.toISOString(),
    updatedAt: location.updatedAt.toISOString(),
  };
}

function mapService(service: {
  id: string;
  key: string;
  name: string;
  description: string | null;
  active: boolean;
  metadata: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}): ServiceResponse {
  return {
    id: service.id,
    key: service.key,
    name: service.name,
    description: service.description,
    active: service.active,
    metadata: mapJsonObject(service.metadata),
    createdAt: service.createdAt.toISOString(),
    updatedAt: service.updatedAt.toISOString(),
  };
}

function mapServiceArea(serviceArea: {
  id: string;
  type: ServiceAreaResponse['type'];
  value: string;
  configuration: Prisma.JsonValue;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): ServiceAreaResponse {
  return {
    id: serviceArea.id,
    type: serviceArea.type,
    value: serviceArea.value,
    configuration: mapJsonObject(serviceArea.configuration),
    active: serviceArea.active,
    createdAt: serviceArea.createdAt.toISOString(),
    updatedAt: serviceArea.updatedAt.toISOString(),
  };
}

function mapJsonObject(value: Prisma.JsonValue): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function pageSize(value: number | undefined): number {
  return value ?? DEFAULT_PAGE_SIZE;
}

interface PageCursor {
  readonly id: string;
  readonly createdAt: Date;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  return isPrismaError(error, 'P2002');
}

function isRecordNotFound(error: unknown): boolean {
  return isPrismaError(error, 'P2025');
}

function isPrismaError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}
