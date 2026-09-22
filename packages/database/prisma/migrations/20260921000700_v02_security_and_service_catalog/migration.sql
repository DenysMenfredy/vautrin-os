-- ---------------------------------------------------------------------------
-- V0.2 security/session and service catalog reconciliation
--
-- Sources: SDD-03, SDD-04, SDD-09, ADR-013, ADR-014.
--
-- Refresh sessions are global identity records. Services and service areas are
-- tenant-scoped and therefore receive explicit ENABLE + FORCE RLS policies.
-- ---------------------------------------------------------------------------

ALTER TABLE "refresh_tokens"
  ADD COLUMN "active_tenant_id" UUID;

ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_active_tenant_id_fkey"
  FOREIGN KEY ("active_tenant_id") REFERENCES "tenants"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "refresh_tokens_active_tenant_id_revoked_at_idx"
  ON "refresh_tokens"("active_tenant_id", "revoked_at");

CREATE TYPE "service_area_type" AS ENUM ('CITY', 'POSTAL_CODE', 'RADIUS', 'REGION');

CREATE TABLE "services" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "services_tenant_id_key_key"
  ON "services"("tenant_id", "key");
CREATE INDEX "services_tenant_id_active_idx"
  ON "services"("tenant_id", "active");

ALTER TABLE "services"
  ADD CONSTRAINT "services_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "service_areas" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "type" "service_area_type" NOT NULL,
    "value" TEXT NOT NULL,
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_areas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_areas_tenant_id_type_active_idx"
  ON "service_areas"("tenant_id", "type", "active");
CREATE INDEX "service_areas_tenant_id_value_idx"
  ON "service_areas"("tenant_id", "value");

ALTER TABLE "service_areas"
  ADD CONSTRAINT "service_areas_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "services" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "services" FORCE ROW LEVEL SECURITY;
CREATE POLICY "services_tenant_isolation" ON "services"
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());

ALTER TABLE "service_areas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_areas" FORCE ROW LEVEL SECURITY;
CREATE POLICY "service_areas_tenant_isolation" ON "service_areas"
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
