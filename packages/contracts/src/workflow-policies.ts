/**
 * Declarative, provider-independent workflow retry and failure policies
 * (SDD-07 §§7–8). Attempts include the first execution.
 */
export interface WorkflowRetryPolicy {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  /** Exact stable workflow error codes, or `*` for all non-terminal errors. */
  readonly retryableErrors: readonly string[];
  /** Terminal codes take precedence over matching retryable errors. */
  readonly terminalErrors: readonly string[];
}

export type WorkflowFailureAction = 'retry' | 'skip' | 'stop' | 'escalate' | 'human_handoff';

export interface WorkflowFailurePolicy {
  readonly action: WorkflowFailureAction;
}

export const DEFAULT_WORKFLOW_RETRY_POLICY: WorkflowRetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 5_000,
  maxDelayMs: 300_000,
  retryableErrors: [],
  terminalErrors: [],
};

export const DEFAULT_WORKFLOW_FAILURE_POLICY: WorkflowFailurePolicy = { action: 'stop' };

const FAILURE_ACTIONS: readonly WorkflowFailureAction[] = [
  'retry',
  'skip',
  'stop',
  'escalate',
  'human_handoff',
];
const ERROR_CODE = /^[a-z][a-z0-9_.:-]{0,127}$/;

export function parseWorkflowRetryPolicy(value: unknown): WorkflowRetryPolicy {
  if (!isRecord(value)) throw new Error('retryPolicy must be an object.');
  assertOnlyKeys(
    value,
    ['maxAttempts', 'initialDelayMs', 'maxDelayMs', 'retryableErrors', 'terminalErrors'],
    'retryPolicy',
  );

  const maxAttempts = readInteger(
    value.maxAttempts,
    DEFAULT_WORKFLOW_RETRY_POLICY.maxAttempts,
    1,
    10,
    'retryPolicy.maxAttempts',
  );
  const initialDelayMs = readInteger(
    value.initialDelayMs,
    DEFAULT_WORKFLOW_RETRY_POLICY.initialDelayMs,
    100,
    60_000,
    'retryPolicy.initialDelayMs',
  );
  const maxDelayMs = readInteger(
    value.maxDelayMs,
    DEFAULT_WORKFLOW_RETRY_POLICY.maxDelayMs,
    initialDelayMs,
    300_000,
    'retryPolicy.maxDelayMs',
  );
  const retryableErrors = readErrorCodes(
    value.retryableErrors,
    'retryPolicy.retryableErrors',
    true,
  );
  const terminalErrors = readErrorCodes(value.terminalErrors, 'retryPolicy.terminalErrors', false);

  return { maxAttempts, initialDelayMs, maxDelayMs, retryableErrors, terminalErrors };
}

export function parseWorkflowFailurePolicy(value: unknown): WorkflowFailurePolicy {
  if (!isRecord(value)) throw new Error('failurePolicy must be an object.');
  assertOnlyKeys(value, ['action'], 'failurePolicy');
  const action = value.action ?? DEFAULT_WORKFLOW_FAILURE_POLICY.action;
  if (typeof action !== 'string' || !FAILURE_ACTIONS.includes(action as WorkflowFailureAction)) {
    throw new Error('failurePolicy.action is unsupported.');
  }
  return { action: action as WorkflowFailureAction };
}

export function isWorkflowErrorRetryable(errorCode: string, policy: WorkflowRetryPolicy): boolean {
  if (matchesError(errorCode, policy.terminalErrors)) return false;
  return matchesError(errorCode, policy.retryableErrors);
}

/** Deterministic exponential delay for a one-based attempt number. */
export function workflowRetryDelayMs(attempt: number, policy: WorkflowRetryPolicy): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new Error('attempt must be a positive integer.');
  }
  return Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** (attempt - 1));
}

function matchesError(errorCode: string, configured: readonly string[]): boolean {
  return configured.includes('*') || configured.includes(errorCode);
}

function readErrorCodes(value: unknown, field: string, allowWildcard: boolean): readonly string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some(
      (item) =>
        typeof item !== 'string' || (!(allowWildcard && item === '*') && !ERROR_CODE.test(item)),
    )
  ) {
    throw new Error(`${field} must contain at most 100 valid error codes.`);
  }
  if (new Set(value).size !== value.length)
    throw new Error(`${field} must not contain duplicates.`);
  return value;
}

function readInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  const resolved = value ?? fallback;
  if (
    !Number.isSafeInteger(resolved) ||
    (resolved as number) < minimum ||
    (resolved as number) > maximum
  ) {
    throw new Error(`${field} must be an integer from ${minimum} to ${maximum}.`);
  }
  return resolved as number;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(`${field} contains an unsupported property.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
