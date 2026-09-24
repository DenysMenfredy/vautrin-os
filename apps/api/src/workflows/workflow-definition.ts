import { BadRequestException } from '@nestjs/common';
import {
  WORKFLOW_STEP_TYPES,
  type WorkflowDefinition,
  type WorkflowStepDefinition,
  type WorkflowStepType,
} from '@vautrin/contracts';

const STEP_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const MAX_WORKFLOW_STEPS = 100;

/** Validate and normalize the documented workflow definition envelope. */
export function validateWorkflowDefinition(value: unknown): WorkflowDefinition {
  if (!isRecord(value) || !hasOnlyKeys(value, ['steps']) || !Array.isArray(value.steps)) {
    throw new BadRequestException('definition must contain only a steps array.');
  }
  if (value.steps.length === 0 || value.steps.length > MAX_WORKFLOW_STEPS) {
    throw new BadRequestException(`definition.steps must contain 1-${MAX_WORKFLOW_STEPS} steps.`);
  }

  const ids = new Set<string>();
  const steps: WorkflowStepDefinition[] = value.steps.map((candidate, index) => {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, ['id', 'type', 'config']) ||
      typeof candidate.id !== 'string' ||
      !STEP_ID.test(candidate.id) ||
      typeof candidate.type !== 'string' ||
      !WORKFLOW_STEP_TYPES.some((type) => type === candidate.type) ||
      !isRecord(candidate.config)
    ) {
      throw new BadRequestException(
        `definition.steps[${index}] requires a valid id, supported type, and config object.`,
      );
    }
    if (ids.has(candidate.id)) {
      throw new BadRequestException(`Workflow step id '${candidate.id}' is duplicated.`);
    }
    ids.add(candidate.id);
    return {
      id: candidate.id,
      type: candidate.type as WorkflowStepType,
      config: candidate.config,
    };
  });
  return { steps };
}

export function validateConditionList(
  value: unknown,
): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(value) || value.some((condition) => !isRecord(condition))) {
    throw new BadRequestException('conditions must be an array of objects.');
  }
  return value;
}

export function validateJsonObject(
  value: unknown,
  field: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new BadRequestException(`${field} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
