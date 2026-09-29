import type {
  WorkflowConditionExpression,
  WorkflowConditionScalar,
  WorkflowContext,
} from '@vautrin/contracts';

export class WorkflowConditionError extends Error {
  constructor(readonly code: 'incompatible_operand_types') {
    super(code);
    this.name = 'WorkflowConditionError';
  }
}

type ResolvedValue = { readonly found: true; readonly value: unknown } | { readonly found: false };

/** Pure, deterministic evaluator for the workflow condition DSL. */
export function evaluateWorkflowCondition(
  condition: WorkflowConditionExpression,
  context: WorkflowContext,
): boolean {
  if ('all' in condition) {
    return condition.all.map((child) => evaluateWorkflowCondition(child, context)).every(Boolean);
  }
  if ('any' in condition) {
    return condition.any.map((child) => evaluateWorkflowCondition(child, context)).some(Boolean);
  }
  if ('not' in condition) return !evaluateWorkflowCondition(condition.not, context);

  const resolved = resolvePath(context, condition.field);
  if (condition.operator === 'exists') return resolved.found;
  if (condition.operator === 'not_exists') return !resolved.found;
  if (!resolved.found) return false;

  const actual = resolved.value;
  const expected = condition.value;
  switch (condition.operator) {
    case 'eq':
    case 'neq': {
      if (!sameScalar(actual, expected)) {
        throw new WorkflowConditionError('incompatible_operand_types');
      }
      return condition.operator === 'eq' ? actual === expected : actual !== expected;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (typeof actual !== 'number' || typeof expected !== 'number') {
        throw new WorkflowConditionError('incompatible_operand_types');
      }
      if (condition.operator === 'gt') return actual > expected;
      if (condition.operator === 'gte') return actual >= expected;
      if (condition.operator === 'lt') return actual < expected;
      return actual <= expected;
    }
    case 'in':
    case 'not_in': {
      if (!Array.isArray(expected) || !isScalar(actual)) {
        throw new WorkflowConditionError('incompatible_operand_types');
      }
      if (
        !expected.every((candidate) => isScalar(candidate) && typeof candidate === typeof actual)
      ) {
        throw new WorkflowConditionError('incompatible_operand_types');
      }
      const included = expected.some((candidate) => candidate === actual);
      return condition.operator === 'in' ? included : !included;
    }
    case 'contains': {
      if (typeof actual === 'string' && typeof expected === 'string') {
        return actual.includes(expected);
      }
      if (
        Array.isArray(actual) &&
        isScalar(expected) &&
        actual.every(isScalar) &&
        actual.every((candidate) => typeof candidate === typeof expected)
      ) {
        return actual.includes(expected);
      }
      throw new WorkflowConditionError('incompatible_operand_types');
    }
  }
}

function resolvePath(context: WorkflowContext, path: string): ResolvedValue {
  let current: unknown = context;
  for (const segment of path.split('.')) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(segment)) return { found: false };
      const index = Number(segment);
      if (!Object.hasOwn(current, index)) return { found: false };
      current = current[index];
      continue;
    }
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, segment)) {
      return { found: false };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}

function sameScalar(actual: unknown, expected: unknown): boolean {
  return isScalar(actual) && isScalar(expected) && typeof actual === typeof expected;
}

function isScalar(value: unknown): value is WorkflowConditionScalar {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}
