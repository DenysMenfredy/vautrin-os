-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING_DELETION');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'INVITED', 'DISABLED');

-- CreateEnum
CREATE TYPE "tenant_role" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('ACTIVE', 'INVITED', 'REVOKED');

-- CreateEnum
CREATE TYPE "lead_status" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'APPOINTMENT_BOOKED', 'ESTIMATE_PENDING', 'ESTIMATE_SENT', 'FOLLOW_UP', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "channel" AS ENUM ('SMS', 'EMAIL', 'VOICE', 'WHATSAPP', 'WEB');

-- CreateEnum
CREATE TYPE "conversation_status" AS ENUM ('OPEN', 'PENDING', 'SNOOZED', 'CLOSED');

-- CreateEnum
CREATE TYPE "message_direction" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "message_status" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "call_direction" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "call_status" AS ENUM ('INITIATED', 'RINGING', 'IN_PROGRESS', 'ANSWERED', 'MISSED', 'VOICEMAIL', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "appointment_status" AS ENUM ('SCHEDULED', 'CONFIRMED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "estimate_status" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "workflow_status" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "workflow_run_status" AS ENUM ('PENDING', 'RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "step_run_status" AS ENUM ('PENDING', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'SKIPPED', 'FAILED', 'AWAITING_APPROVAL');

-- CreateEnum
CREATE TYPE "workflow_step_type" AS ENUM ('WAIT', 'CONDITION', 'SEND_MESSAGE', 'CREATE_LEAD', 'UPDATE_LEAD', 'CREATE_APPOINTMENT', 'CALL_AGENT', 'CREATE_TASK', 'HUMAN_APPROVAL', 'END');

-- CreateEnum
CREATE TYPE "agent_status" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "agent_run_status" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'HANDED_OFF');

-- CreateEnum
CREATE TYPE "tool_side_effect" AS ENUM ('NONE', 'INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "tool_execution_status" AS ENUM ('SUCCEEDED', 'FAILED', 'DENIED', 'AWAITING_APPROVAL');

-- CreateEnum
CREATE TYPE "knowledge_document_status" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "integration_category" AS ENUM ('MESSAGING', 'VOICE', 'CALENDAR', 'EMAIL', 'CRM');

-- CreateEnum
CREATE TYPE "integration_status" AS ENUM ('DISCONNECTED', 'CONNECTED', 'HEALTHY', 'DEGRADED');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('USER', 'AGENT', 'SYSTEM', 'INTEGRATION');

-- CreateEnum
CREATE TYPE "audit_outcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateEnum
CREATE TYPE "custom_field_entity" AS ENUM ('CONTACT', 'LEAD', 'ESTIMATE', 'APPOINTMENT');

-- CreateEnum
CREATE TYPE "custom_field_type" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SELECT', 'MULTI_SELECT', 'CURRENCY');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "tenant_status" NOT NULL DEFAULT 'ACTIVE',
    "vertical" TEXT NOT NULL DEFAULT 'generic-local-business',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password_hash" TEXT,
    "status" "user_status" NOT NULL DEFAULT 'INVITED',
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "tenant_role" NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_profiles" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "legal_name" TEXT,
    "display_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "description" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "business_hours" JSONB NOT NULL DEFAULT '{}',
    "communication_preferences" JSONB NOT NULL DEFAULT '{}',
    "qualification_rules" JSONB NOT NULL DEFAULT '{}',
    "booking_rules" JSONB NOT NULL DEFAULT '{}',
    "ai_configuration" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "business_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postal_code" TEXT,
    "country" TEXT NOT NULL DEFAULT 'US',
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "timezone" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "service_radius_miles" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "address" JSONB,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sources" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "status" "lead_status" NOT NULL DEFAULT 'NEW',
    "source_id" UUID,
    "service" TEXT,
    "assigned_user_id" UUID,
    "title" TEXT,
    "description" TEXT,
    "estimated_value" DECIMAL(12,2),
    "qualification" JSONB NOT NULL DEFAULT '{}',
    "last_contacted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "lead_id" UUID,
    "channel" "channel" NOT NULL,
    "status" "conversation_status" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT,
    "assigned_user_id" UUID,
    "external_id" TEXT,
    "last_message_at" TIMESTAMPTZ(6),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "direction" "message_direction" NOT NULL,
    "channel" "channel" NOT NULL,
    "status" "message_status" NOT NULL DEFAULT 'QUEUED',
    "body" TEXT NOT NULL,
    "from_address" TEXT,
    "to_address" TEXT,
    "provider" TEXT,
    "provider_message_id" TEXT,
    "agent_run_id" UUID,
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "failure_reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID,
    "lead_id" UUID,
    "conversation_id" UUID,
    "direction" "call_direction" NOT NULL,
    "status" "call_status" NOT NULL,
    "provider" TEXT,
    "provider_call_id" TEXT,
    "from_number" TEXT,
    "to_number" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "answered_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "duration_seconds" INTEGER,
    "recording_ref" TEXT,
    "transcript_ref" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "lead_id" UUID,
    "location_id" UUID,
    "assigned_user_id" UUID,
    "status" "appointment_status" NOT NULL DEFAULT 'SCHEDULED',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "timezone" TEXT NOT NULL,
    "provider" TEXT,
    "provider_event_id" TEXT,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancellation_reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimates" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "estimate_status" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "line_items" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "valid_until" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "viewed_at" TIMESTAMPTZ(6),
    "responded_at" TIMESTAMPTZ(6),
    "follow_up_count" INTEGER NOT NULL DEFAULT 0,
    "last_follow_up_at" TIMESTAMPTZ(6),
    "next_follow_up_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" TEXT NOT NULL,
    "status" "workflow_status" NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL DEFAULT '{}',
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "retry_policy" JSONB NOT NULL DEFAULT '{}',
    "failure_policy" JSONB NOT NULL DEFAULT '{}',
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "workflow_version" INTEGER NOT NULL,
    "trigger_event" TEXT NOT NULL,
    "trigger_event_id" UUID,
    "status" "workflow_run_status" NOT NULL DEFAULT 'PENDING',
    "context" JSONB NOT NULL DEFAULT '{}',
    "correlation_id" UUID,
    "idempotency_key" TEXT,
    "current_step_id" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "scheduled_for" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_step_runs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "workflow_run_id" UUID NOT NULL,
    "step_id" TEXT NOT NULL,
    "step_index" INTEGER NOT NULL,
    "step_type" "workflow_step_type" NOT NULL,
    "status" "step_run_status" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "error" TEXT,
    "idempotency_key" TEXT,
    "scheduled_for" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workflow_step_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "status" "agent_status" NOT NULL DEFAULT 'DRAFT',
    "instructions" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "model_configuration" JSONB NOT NULL DEFAULT '{}',
    "allowed_tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "knowledge_strategy" JSONB NOT NULL DEFAULT '{}',
    "guardrails" JSONB NOT NULL DEFAULT '{}',
    "handoff_policy" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "agent_version" INTEGER NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "conversation_id" UUID,
    "lead_id" UUID,
    "workflow_run_id" UUID,
    "status" "agent_run_status" NOT NULL DEFAULT 'RUNNING',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_amount" DECIMAL(12,6),
    "cost_currency" TEXT,
    "latency_ms" INTEGER,
    "tool_count" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" TEXT,
    "handoff" BOOLEAN NOT NULL DEFAULT false,
    "handoff_reason" TEXT,
    "correlation_id" UUID,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_executions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "agent_run_id" UUID NOT NULL,
    "tool_name" TEXT NOT NULL,
    "permission" TEXT,
    "side_effect" "tool_side_effect" NOT NULL DEFAULT 'NONE',
    "status" "tool_execution_status" NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "error" TEXT,
    "authorized" BOOLEAN NOT NULL DEFAULT false,
    "approval_required" BOOLEAN NOT NULL DEFAULT false,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "idempotency_key" TEXT,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_uri" TEXT,
    "content_hash" TEXT,
    "status" "knowledge_document_status" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "processed_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "chunk_index" INTEGER NOT NULL,
    "token_count" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "category" "integration_category" NOT NULL,
    "status" "integration_status" NOT NULL DEFAULT 'DISCONNECTED',
    "credentials_ref" TEXT,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "external_account_id" TEXT,
    "health_checked_at" TIMESTAMPTZ(6),
    "health_error" TEXT,
    "connected_at" TIMESTAMPTZ(6),
    "disconnected_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "aggregate_type" TEXT,
    "aggregate_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "correlation_id" UUID,
    "causation_id" UUID,
    "idempotency_key" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID,
    "actor_label" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" UUID,
    "outcome" "audit_outcome" NOT NULL DEFAULT 'SUCCESS',
    "changes" JSONB,
    "ip_address" INET,
    "user_agent" TEXT,
    "correlation_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "entity_type" "custom_field_entity" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field_type" "custom_field_type" NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_values" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "entity_type" "custom_field_entity" NOT NULL,
    "entity_id" UUID NOT NULL,
    "value" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "custom_field_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "tenant_users_tenant_id_role_idx" ON "tenant_users"("tenant_id", "role");

-- CreateIndex
CREATE INDEX "tenant_users_user_id_idx" ON "tenant_users"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_users_tenant_id_user_id_key" ON "tenant_users"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_profiles_tenant_id_key" ON "business_profiles"("tenant_id");

-- CreateIndex
CREATE INDEX "locations_tenant_id_is_primary_idx" ON "locations"("tenant_id", "is_primary");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_phone_idx" ON "contacts"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_email_idx" ON "contacts"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_created_at_idx" ON "contacts"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sources_tenant_id_key_key" ON "lead_sources"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "leads_tenant_id_status_idx" ON "leads"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "leads_tenant_id_created_at_idx" ON "leads"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "leads_tenant_id_assigned_user_id_idx" ON "leads"("tenant_id", "assigned_user_id");

-- CreateIndex
CREATE INDEX "leads_tenant_id_contact_id_idx" ON "leads"("tenant_id", "contact_id");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_updated_at_idx" ON "conversations"("tenant_id", "updated_at");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_status_idx" ON "conversations"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_contact_id_idx" ON "conversations"("tenant_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_tenant_id_channel_external_id_key" ON "conversations"("tenant_id", "channel", "external_id");

-- CreateIndex
CREATE INDEX "messages_tenant_id_conversation_id_created_at_idx" ON "messages"("tenant_id", "conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_tenant_id_status_idx" ON "messages"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "messages_tenant_id_provider_provider_message_id_key" ON "messages"("tenant_id", "provider", "provider_message_id");

-- CreateIndex
CREATE INDEX "calls_tenant_id_status_started_at_idx" ON "calls"("tenant_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "calls_tenant_id_contact_id_idx" ON "calls"("tenant_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "calls_tenant_id_provider_provider_call_id_key" ON "calls"("tenant_id", "provider", "provider_call_id");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_starts_at_idx" ON "appointments"("tenant_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_tenant_id_status_starts_at_idx" ON "appointments"("tenant_id", "status", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_tenant_id_provider_provider_event_id_key" ON "appointments"("tenant_id", "provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "estimates_tenant_id_status_idx" ON "estimates"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "estimates_tenant_id_next_follow_up_at_idx" ON "estimates"("tenant_id", "next_follow_up_at");

-- CreateIndex
CREATE UNIQUE INDEX "estimates_tenant_id_number_key" ON "estimates"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "workflows_tenant_id_trigger_status_idx" ON "workflows"("tenant_id", "trigger", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workflows_tenant_id_key_version_key" ON "workflows"("tenant_id", "key", "version");

-- CreateIndex
CREATE INDEX "workflow_runs_tenant_id_status_idx" ON "workflow_runs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "workflow_runs_tenant_id_scheduled_for_idx" ON "workflow_runs"("tenant_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "workflow_runs_tenant_id_workflow_id_created_at_idx" ON "workflow_runs"("tenant_id", "workflow_id", "created_at");

-- CreateIndex
CREATE INDEX "workflow_runs_correlation_id_idx" ON "workflow_runs"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_runs_tenant_id_idempotency_key_key" ON "workflow_runs"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "workflow_step_runs_tenant_id_workflow_run_id_step_index_idx" ON "workflow_step_runs"("tenant_id", "workflow_run_id", "step_index");

-- CreateIndex
CREATE INDEX "workflow_step_runs_tenant_id_status_scheduled_for_idx" ON "workflow_step_runs"("tenant_id", "status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_step_runs_tenant_id_idempotency_key_key" ON "workflow_step_runs"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "agents_tenant_id_status_idx" ON "agents"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agents_tenant_id_key_version_key" ON "agents"("tenant_id", "key", "version");

-- CreateIndex
CREATE INDEX "agent_runs_tenant_id_status_started_at_idx" ON "agent_runs"("tenant_id", "status", "started_at");

-- CreateIndex
CREATE INDEX "agent_runs_tenant_id_agent_id_started_at_idx" ON "agent_runs"("tenant_id", "agent_id", "started_at");

-- CreateIndex
CREATE INDEX "agent_runs_correlation_id_idx" ON "agent_runs"("correlation_id");

-- CreateIndex
CREATE INDEX "tool_executions_tenant_id_agent_run_id_idx" ON "tool_executions"("tenant_id", "agent_run_id");

-- CreateIndex
CREATE INDEX "tool_executions_tenant_id_tool_name_created_at_idx" ON "tool_executions"("tenant_id", "tool_name", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tool_executions_tenant_id_idempotency_key_key" ON "tool_executions"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "knowledge_documents_tenant_id_status_idx" ON "knowledge_documents"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "knowledge_documents_tenant_id_content_hash_idx" ON "knowledge_documents"("tenant_id", "content_hash");

-- CreateIndex
CREATE INDEX "knowledge_chunks_tenant_id_document_id_idx" ON "knowledge_chunks"("tenant_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_tenant_id_document_id_chunk_index_key" ON "knowledge_chunks"("tenant_id", "document_id", "chunk_index");

-- CreateIndex
CREATE INDEX "integrations_tenant_id_category_status_idx" ON "integrations"("tenant_id", "category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_tenant_id_provider_external_account_id_key" ON "integrations"("tenant_id", "provider", "external_account_id");

-- CreateIndex
CREATE INDEX "events_tenant_id_name_occurred_at_idx" ON "events"("tenant_id", "name", "occurred_at");

-- CreateIndex
CREATE INDEX "events_tenant_id_aggregate_type_aggregate_id_idx" ON "events"("tenant_id", "aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "events_published_at_occurred_at_idx" ON "events"("published_at", "occurred_at");

-- CreateIndex
CREATE INDEX "events_correlation_id_idx" ON "events"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "events_tenant_id_idempotency_key_key" ON "events"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_resource_type_resource_id_idx" ON "audit_logs"("tenant_id", "resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_actor_type_actor_id_idx" ON "audit_logs"("tenant_id", "actor_type", "actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_correlation_id_idx" ON "audit_logs"("correlation_id");

-- CreateIndex
CREATE INDEX "custom_field_definitions_tenant_id_entity_type_is_active_idx" ON "custom_field_definitions"("tenant_id", "entity_type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_tenant_id_entity_type_key_key" ON "custom_field_definitions"("tenant_id", "entity_type", "key");

-- CreateIndex
CREATE INDEX "custom_field_values_tenant_id_entity_type_entity_id_idx" ON "custom_field_values"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_values_tenant_id_definition_id_entity_id_key" ON "custom_field_values"("tenant_id", "definition_id", "entity_id");

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_trigger_event_id_fkey" FOREIGN KEY ("trigger_event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_step_runs" ADD CONSTRAINT "workflow_step_runs_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "custom_field_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
