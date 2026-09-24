-- v0.3 workflow definitions include an explicit human-handoff step.
ALTER TYPE "workflow_step_type" ADD VALUE IF NOT EXISTS 'HUMAN_HANDOFF';
