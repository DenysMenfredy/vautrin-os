/** Business configuration API contracts (SDD-01 FR-003, ADR-014). */

export interface BusinessProfileResponse {
  readonly id: string;
  readonly displayName: string;
  readonly legalName: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly website: string | null;
  readonly description: string | null;
  readonly timezone: string;
  readonly locale: string;
  readonly currency: string;
  readonly businessHours: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpdateBusinessProfileRequest {
  readonly displayName?: string;
  readonly legalName?: string | null;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly website?: string | null;
  readonly description?: string | null;
  readonly timezone?: string;
  readonly locale?: string;
  readonly currency?: string;
  readonly businessHours?: Readonly<Record<string, unknown>>;
}

/** The V0.2 custom-field scope (backlog VOS-045/VOS-046). */
export const CUSTOM_FIELD_ENTITY_TYPES = ['CONTACT', 'LEAD', 'ESTIMATE'] as const;
export type CustomFieldEntityType = (typeof CUSTOM_FIELD_ENTITY_TYPES)[number];

export const CUSTOM_FIELD_TYPES = [
  'TEXT',
  'NUMBER',
  'BOOLEAN',
  'DATE',
  'SELECT',
  'MULTI_SELECT',
  'CURRENCY',
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export type CustomFieldValue = string | number | boolean | readonly string[];

export interface CustomFieldDefinitionResponse {
  readonly id: string;
  readonly entityType: CustomFieldEntityType;
  readonly key: string;
  readonly label: string;
  readonly fieldType: CustomFieldType;
  readonly options: readonly string[];
  readonly isRequired: boolean;
  readonly isActive: boolean;
  readonly displayOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateCustomFieldDefinitionRequest {
  readonly entityType: CustomFieldEntityType;
  readonly key: string;
  readonly label: string;
  readonly fieldType: CustomFieldType;
  readonly options?: readonly string[];
  readonly isRequired?: boolean;
  readonly isActive?: boolean;
  readonly displayOrder?: number;
}

export type UpdateCustomFieldDefinitionRequest = Partial<
  Omit<CreateCustomFieldDefinitionRequest, 'entityType'>
>;

export interface ListCustomFieldDefinitionsRequest extends PageRequest {
  readonly entityType?: CustomFieldEntityType;
  readonly active?: boolean;
  readonly search?: string;
}

export interface CustomFieldValueResponse {
  readonly id: string;
  readonly definitionId: string;
  readonly entityType: CustomFieldEntityType;
  readonly entityId: string;
  readonly value: CustomFieldValue | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SetCustomFieldValueRequest {
  readonly value: CustomFieldValue;
}

export interface LocationResponse {
  readonly id: string;
  readonly name: string;
  readonly addressLine1: string | null;
  readonly addressLine2: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postalCode: string | null;
  readonly country: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly timezone: string | null;
  readonly isPrimary: boolean;
  readonly serviceRadiusMiles: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateLocationRequest {
  readonly name: string;
  readonly addressLine1?: string | null;
  readonly addressLine2?: string | null;
  readonly city?: string | null;
  readonly region?: string | null;
  readonly postalCode?: string | null;
  readonly country?: string;
  readonly latitude?: number | null;
  readonly longitude?: number | null;
  readonly timezone?: string | null;
  readonly isPrimary?: boolean;
  readonly serviceRadiusMiles?: number | null;
}

export type UpdateLocationRequest = Partial<CreateLocationRequest>;

export interface ServiceResponse {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateServiceRequest {
  readonly key: string;
  readonly name: string;
  readonly description?: string | null;
  readonly active?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type UpdateServiceRequest = Partial<CreateServiceRequest>;

export type ServiceAreaType = 'CITY' | 'POSTAL_CODE' | 'RADIUS' | 'REGION';

export interface ServiceAreaResponse {
  readonly id: string;
  readonly type: ServiceAreaType;
  readonly value: string;
  readonly configuration: Readonly<Record<string, unknown>>;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateServiceAreaRequest {
  readonly type: ServiceAreaType;
  readonly value: string;
  readonly configuration?: Readonly<Record<string, unknown>>;
  readonly active?: boolean;
}

export type UpdateServiceAreaRequest = Partial<CreateServiceAreaRequest>;

export interface PageRequest {
  readonly limit?: number;
  /** Opaque keyset cursor returned by the previous page. */
  readonly cursor?: string;
}

export interface BusinessListRequest extends PageRequest {
  readonly search?: string;
  readonly active?: boolean;
}

export interface PageResponse<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}
