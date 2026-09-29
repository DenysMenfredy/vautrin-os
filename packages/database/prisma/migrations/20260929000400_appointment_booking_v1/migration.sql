-- A local booking keeps its connected calendar and type identity, and a
-- tenant-scoped command key prevents replay from creating another appointment.
ALTER TABLE "appointments"
  ADD COLUMN "integration_id" UUID,
  ADD COLUMN "appointment_type_id" TEXT,
  ADD COLUMN "idempotency_key" UUID;

CREATE UNIQUE INDEX "appointments_tenant_id_idempotency_key_key"
  ON "appointments"("tenant_id", "idempotency_key");

CREATE INDEX "appointments_tenant_id_integration_id_idx"
  ON "appointments"("tenant_id", "integration_id");

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_integration_id_fkey"
  FOREIGN KEY ("integration_id") REFERENCES "integrations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
