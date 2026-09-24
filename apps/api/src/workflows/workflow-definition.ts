import { BadRequestException } from '@nestjs/common';
import { parseWorkflowDefinition, type WorkflowDefinition } from '@vautrin/contracts';

/** Validate and normalize the documented workflow definition envelope. */
export function validateWorkflowDefinition(value: unknown): WorkflowDefinition {
  try {
    return parseWorkflowDefinition(value);
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error ? error.message : 'definition is invalid.',
    );
  }
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
