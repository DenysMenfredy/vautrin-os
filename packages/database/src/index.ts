/**
 * @vautrin/database — the Vautrin OS data layer (VOS-011).
 *
 * Exposes the Prisma client, tenant-scoped access, and pgvector helpers.
 * Domain code depends on the types here; it must not import Prisma directly
 * (SDD-02 §5).
 */

// Enums and model types are re-exported so consumers get them without a
// direct Prisma dependency. The client is generated into ./generated/client
// (see prisma/schema.prisma) so it ships as a package file and survives
// `pnpm deploy` into a production image.
export type * from '../generated/client/index.js';
export {
  ActorType,
  AgentRunStatus,
  AgentStatus,
  AppointmentStatus,
  AuditOutcome,
  CallDirection,
  CallStatus,
  Channel,
  ConversationStatus,
  CustomFieldEntity,
  CustomFieldType,
  EstimateStatus,
  IntegrationCategory,
  IntegrationStatus,
  KnowledgeDocumentStatus,
  LeadStatus,
  MembershipStatus,
  MessageDirection,
  MessageStatus,
  StepRunStatus,
  TenantRole,
  TenantStatus,
  ToolExecutionStatus,
  ToolSideEffect,
  UserStatus,
  WorkflowRunStatus,
  WorkflowStatus,
  WorkflowStepType,
} from '../generated/client/index.js';
export {
  assertEmbeddingDimensions,
  type CreateClientOptions,
  createPlatformClient,
  createPrismaClient,
  Prisma,
  type PrismaClient,
} from './client.js';

export { DatabaseConfigError, EMBEDDING_DIMENSIONS, TENANT_SETTING } from './config.js';

export {
  InvalidTenantContextError,
  MissingTenantContextError,
  SchemaMismatchError,
} from './errors.js';
export {
  assertTenantId,
  assertTenantJobContext,
  currentTenantId,
  type TenantJobContext,
  type TenantScopedClient,
  type WithTenantOptions,
  withTenant,
} from './tenant-context.js';
export {
  type KnowledgeSearchResult,
  type SearchOptions,
  searchKnowledgeChunks,
  toVectorLiteral,
  type UpsertChunkInput,
  upsertKnowledgeChunk,
} from './vector.js';
