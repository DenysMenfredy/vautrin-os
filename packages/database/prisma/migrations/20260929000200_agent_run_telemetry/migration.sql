-- VOS-078 / SDD-06 §9: usage telemetry is stored without provider SDK types.
ALTER TABLE public.agent_runs
  ADD COLUMN cached_input_tokens integer,
  ADD COLUMN result jsonb,
  ADD CONSTRAINT agent_runs_token_usage_nonnegative
    CHECK (
      (input_tokens IS NULL OR input_tokens >= 0)
      AND (output_tokens IS NULL OR output_tokens >= 0)
      AND (cached_input_tokens IS NULL OR cached_input_tokens >= 0)
    );

-- Rollback: ALTER TABLE public.agent_runs DROP CONSTRAINT agent_runs_token_usage_nonnegative;
--           ALTER TABLE public.agent_runs DROP COLUMN cached_input_tokens, DROP COLUMN result;
