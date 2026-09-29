import { BadRequestException } from '@nestjs/common';
import {
  parseWorkflowDefinition,
  parseWorkflowFailurePolicy,
  parseWorkflowRetryPolicy,
  type WorkflowDefinition,
  type WorkflowFailurePolicy,
  type WorkflowRetryPolicy,
} from '@vautrin/contracts';

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

export function validateWorkflowRetryPolicy(value: unknown): WorkflowRetryPolicy {
  try {
    return parseWorkflowRetryPolicy(value);
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error ? error.message : 'retryPolicy is invalid.',
    );
  }
}

export function validateWorkflowFailurePolicy(value: unknown): WorkflowFailurePolicy {
  try {
    return parseWorkflowFailurePolicy(value);
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error ? error.message : 'failurePolicy is invalid.',
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
