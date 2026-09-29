-- VOS-073: claim side-effecting tool invocations before executing them so a
-- worker retry cannot repeat an external action with the same idempotency key.
ALTER TYPE public.tool_execution_status ADD VALUE IF NOT EXISTS 'RUNNING';

-- PostgreSQL enum values are intentionally retained on rollback; the new
-- state is harmless to older application versions that never write it.
