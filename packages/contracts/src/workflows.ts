import type { PageRequest, PageResponse } from './business.js';

/** The step vocabulary admitted by the v0.3 workflow definition contract. */
export const WORKFLOW_STEP_TYPES = [
  'wait',
  'condition',
  'send_message',
  'create_lead',
  'update_lead',
  'create_appointment',
  'call_agent',
  'human_handoff',
  'end',
] as const;
export type WorkflowStepType = (typeof WORKFLOW_STEP_TYPES)[number];

export const WORKFLOW_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export interface WorkflowStepDefinition {
  readonly id: string;
  readonly type: WorkflowStepType;
  readonly config: Readonly<Record<string, unknown>>;
}

/**
 * The versioned envelope is stable; step-specific config is validated by its
 * executor as each v0.3 step type is implemented.
 */
export interface WorkflowDefinition {
  readonly steps: readonly WorkflowStepDefinition[];
}

/** Runtime parser used by both the API boundary and asynchronous workers. */
export function parseWorkflowDefinition(value: unknown): WorkflowDefinition {
  if (!isRecord(value) || !hasOnlyKeys(value, ['steps']) || !Array.isArray(value.steps)) {
    throw new Error('definition must contain only a steps array.');
  }
  if (value.steps.length === 0 || value.steps.length > 100) {
    throw new Error('definition.steps must contain 1-100 steps.');
  }
  const ids = new Set<string>();
  const steps: WorkflowStepDefinition[] = value.steps.map((candidate, index) => {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, ['id', 'type', 'config']) ||
      typeof candidate.id !== 'string' ||
      !/^[a-z][a-z0-9_-]{0,63}$/.test(candidate.id) ||
      typeof candidate.type !== 'string' ||
      !WORKFLOW_STEP_TYPES.some((type) => type === candidate.type) ||
      !isRecord(candidate.config)
    ) {
      throw new Error(
        `definition.steps[${index}] requires a valid id, supported type, and config object.`,
      );
    }
    if (ids.has(candidate.id)) throw new Error(`Workflow step id '${candidate.id}' is duplicated.`);
    ids.add(candidate.id);
    return {
      id: candidate.id,
      type: candidate.type as WorkflowStepType,
      config: candidate.config,
    };
  });
  return { steps };
}

export interface WorkflowResponse {
  readonly id: string;
  readonly key: string;
  readonly version: number;
  readonly name: string;
  readonly description: string | null;
  readonly trigger: string;
  readonly status: WorkflowStatus;
  readonly definition: WorkflowDefinition;
  readonly conditions: readonly Readonly<Record<string, unknown>>[];
  readonly retryPolicy: Readonly<Record<string, unknown>>;
  readonly failurePolicy: Readonly<Record<string, unknown>>;
  readonly publishedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateWorkflowRequest {
  readonly key: string;
  readonly name: string;
  readonly description?: string | null;
  readonly trigger: string;
  readonly definition: WorkflowDefinition;
  readonly conditions?: readonly Readonly<Record<string, unknown>>[];
  readonly retryPolicy?: Readonly<Record<string, unknown>>;
  readonly failurePolicy?: Readonly<Record<string, unknown>>;
}

export interface UpdateWorkflowRequest {
  readonly name?: string;
  readonly description?: string | null;
  readonly trigger?: string;
  readonly definition?: WorkflowDefinition;
  readonly conditions?: readonly Readonly<Record<string, unknown>>[];
  readonly retryPolicy?: Readonly<Record<string, unknown>>;
  readonly failurePolicy?: Readonly<Record<string, unknown>>;
}

export type WorkflowLifecycleRequest = Extract<WorkflowStatus, 'ACTIVE' | 'PAUSED' | 'ARCHIVED'>;

export interface ListWorkflowsRequest extends PageRequest {
  readonly status?: WorkflowStatus;
  readonly trigger?: string;
}

export type WorkflowPageResponse = PageResponse<WorkflowResponse>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
