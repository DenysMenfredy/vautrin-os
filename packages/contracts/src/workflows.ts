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

export const WORKFLOW_CONDITION_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
  'contains',
  'exists',
  'not_exists',
] as const;
export type WorkflowConditionOperator = (typeof WORKFLOW_CONDITION_OPERATORS)[number];
export const WORKFLOW_CONTEXT_NAMESPACES = [
  'event',
  'workflow',
  'lead',
  'contact',
  'conversation',
  'steps',
] as const;
export type WorkflowContextNamespace = (typeof WORKFLOW_CONTEXT_NAMESPACES)[number];

export type WorkflowConditionScalar = string | number | boolean | null;
export type WorkflowConditionExpression =
  | { readonly all: readonly WorkflowConditionExpression[] }
  | { readonly any: readonly WorkflowConditionExpression[] }
  | { readonly not: WorkflowConditionExpression }
  | {
      readonly field: string;
      readonly operator: WorkflowConditionOperator;
      readonly value?: WorkflowConditionScalar | readonly WorkflowConditionScalar[];
    };

export interface WorkflowConditionStepConfig {
  readonly condition: WorkflowConditionExpression;
  readonly onTrue?: string;
  readonly onFalse?: string;
}

/** Runtime values are built by the worker under a tenant-scoped transaction. */
export interface WorkflowContext {
  readonly event: Readonly<Record<string, unknown>>;
  readonly workflow: Readonly<Record<string, unknown>>;
  readonly lead?: Readonly<Record<string, unknown>>;
  readonly contact?: Readonly<Record<string, unknown>>;
  readonly conversation?: Readonly<Record<string, unknown>>;
  readonly steps: Readonly<Record<string, unknown>>;
}

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

/** Validate condition configurations and forward-only branch targets before activation. */
export function validateWorkflowDefinitionForActivation(value: unknown): WorkflowDefinition {
  const definition = parseWorkflowDefinition(value);
  definition.steps.forEach((step, index) => {
    if (step.type === 'condition')
      parseWorkflowConditionStepConfig(step.config, definition.steps, index);
  });
  return definition;
}

/** Parse the condition DSL and validate its references against ordered steps. */
export function parseWorkflowConditionStepConfig(
  value: unknown,
  steps: readonly WorkflowStepDefinition[],
  conditionIndex: number,
): WorkflowConditionStepConfig {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['condition', 'onTrue', 'onFalse']) ||
    !Object.hasOwn(value, 'condition')
  ) {
    throw new Error(
      'condition config must contain condition and optional onTrue/onFalse step IDs.',
    );
  }

  const stepIndexes = new Map(steps.map((step, index) => [step.id, index]));
  const branches: { onTrue?: string; onFalse?: string } = {};
  for (const branch of ['onTrue', 'onFalse'] as const) {
    const target = value[branch];
    if (target === undefined) continue;
    if (typeof target !== 'string' || !STEP_ID.test(target)) {
      throw new Error(`condition ${branch} must be a valid step ID when provided.`);
    }
    const targetIndex = stepIndexes.get(target);
    if (targetIndex === undefined || targetIndex <= conditionIndex) {
      throw new Error(`condition ${branch} must reference a later step in this workflow.`);
    }
    branches[branch] = target;
  }

  const state = { nodes: 0 };
  const condition = parseConditionExpression(value.condition, steps, conditionIndex, state, 0);
  return { condition, ...branches };
}

const STEP_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const MAX_CONDITION_DEPTH = 32;
const MAX_CONDITION_NODES = 256;

function parseConditionExpression(
  value: unknown,
  steps: readonly WorkflowStepDefinition[],
  conditionIndex: number,
  state: { nodes: number },
  depth: number,
): WorkflowConditionExpression {
  state.nodes++;
  if (state.nodes > MAX_CONDITION_NODES || depth > MAX_CONDITION_DEPTH) {
    throw new Error('condition exceeds the supported complexity limit.');
  }
  if (!isRecord(value)) throw new Error('condition nodes must be objects.');

  if (Object.keys(value).length === 1 && Object.hasOwn(value, 'all')) {
    if (!Array.isArray(value.all)) throw new Error('all must be an array of condition nodes.');
    return {
      all: value.all.map((child) =>
        parseConditionExpression(child, steps, conditionIndex, state, depth + 1),
      ),
    };
  }
  if (Object.keys(value).length === 1 && Object.hasOwn(value, 'any')) {
    if (!Array.isArray(value.any)) throw new Error('any must be an array of condition nodes.');
    return {
      any: value.any.map((child) =>
        parseConditionExpression(child, steps, conditionIndex, state, depth + 1),
      ),
    };
  }
  if (Object.keys(value).length === 1 && Object.hasOwn(value, 'not')) {
    return {
      not: parseConditionExpression(value.not, steps, conditionIndex, state, depth + 1),
    };
  }

  if (
    !hasOnlyKeys(value, ['field', 'operator', 'value']) ||
    typeof value.field !== 'string' ||
    typeof value.operator !== 'string' ||
    !WORKFLOW_CONDITION_OPERATORS.some((operator) => operator === value.operator)
  ) {
    throw new Error('condition comparison requires a permitted field and supported operator.');
  }
  validateConditionField(value.field, steps, conditionIndex);

  const operator = value.operator as WorkflowConditionOperator;
  const hasOperand = Object.hasOwn(value, 'value');
  if (operator === 'exists' || operator === 'not_exists') {
    if (hasOperand) throw new Error(`${operator} does not accept a value.`);
  } else if (!hasOperand) {
    throw new Error(`${operator} requires a value.`);
  } else if (operator === 'in' || operator === 'not_in') {
    if (!Array.isArray(value.value) || !value.value.every(isConditionScalar)) {
      throw new Error(`${operator} requires an array of scalar values.`);
    }
  } else if (!isConditionScalar(value.value)) {
    throw new Error(`${operator} requires a scalar value.`);
  }

  return {
    field: value.field,
    operator,
    ...(hasOperand
      ? { value: value.value as WorkflowConditionScalar | readonly WorkflowConditionScalar[] }
      : {}),
  };
}

function validateConditionField(
  path: string,
  steps: readonly WorkflowStepDefinition[],
  conditionIndex: number,
): void {
  if (path.length > 256) throw new Error('condition field path exceeds the supported length.');
  const segments = path.split('.');
  if (
    segments.length > 32 ||
    segments.some(
      (segment) =>
        !/^[a-zA-Z0-9_-]+$/.test(segment) ||
        segment === '__proto__' ||
        segment === 'prototype' ||
        segment === 'constructor',
    )
  ) {
    throw new Error('condition field path has an invalid segment.');
  }

  const namespace = segments[0] ?? '';
  if (!WORKFLOW_CONTEXT_NAMESPACES.some((allowed) => allowed === namespace)) {
    throw new Error(`condition field namespace '${namespace}' is not permitted.`);
  }
  if (namespace === 'steps') {
    if (segments.length < 3) throw new Error('step output references require a step ID and field.');
    const referencedIndex = steps.findIndex((step) => step.id === (segments[1] ?? ''));
    if (referencedIndex < 0 || referencedIndex >= conditionIndex) {
      throw new Error('condition may reference outputs only from earlier workflow steps.');
    }
    return;
  }
  if (segments.length < 2) throw new Error('condition fields must name a property.');
  const property = segments[1] ?? '';
  if (
    namespace === 'workflow' &&
    (segments.length !== 2 || !['id', 'key', 'version', 'trigger'].includes(property))
  ) {
    throw new Error('workflow condition fields are limited to id, key, version, and trigger.');
  }
  if (namespace === 'event') {
    const allowed = ['id', 'name', 'version', 'occurredAt', 'payload'];
    if (!allowed.includes(property) || (property === 'payload' && segments.length < 3)) {
      throw new Error('event fields must reference event metadata or a payload property.');
    }
    if (property !== 'payload' && segments.length !== 2) {
      throw new Error('event metadata fields do not have nested properties.');
    }
    if (
      property === 'payload' &&
      (segments.length !== 3 ||
        !['leadId', 'contactId', 'from', 'to', 'messageId', 'conversationId'].includes(
          segments[2] ?? '',
        ))
    ) {
      throw new Error('event payload fields must name a supported event property.');
    }
  }
  const projectedFields: Readonly<Record<string, readonly string[]>> = {
    lead: [
      'id',
      'status',
      'sourceId',
      'service',
      'assignedUserId',
      'title',
      'estimatedValue',
      'version',
      'createdAt',
      'updatedAt',
    ],
    contact: ['id', 'company', 'tags', 'createdAt', 'updatedAt'],
    conversation: [
      'id',
      'leadId',
      'contactId',
      'channel',
      'status',
      'assignedUserId',
      'lastMessageAt',
    ],
  };
  const allowedFields = projectedFields[namespace];
  if (allowedFields && (segments.length !== 2 || !allowedFields.includes(property))) {
    throw new Error(`${namespace} condition fields must name a permitted projected property.`);
  }
}

function isConditionScalar(value: unknown): value is WorkflowConditionScalar {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
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
