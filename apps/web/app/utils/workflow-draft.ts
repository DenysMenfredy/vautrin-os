import {
  validateWorkflowDefinitionForActivation,
  type WorkflowDefinition,
  type WorkflowStepDefinition,
} from '@vautrin/contracts';

export type EditableStepType = 'wait' | 'condition' | 'send_message' | 'end';

export interface DraftWorkflowStep {
  id: string;
  type: EditableStepType;
  duration: string;
  body: string;
  field: string;
  operator: 'eq' | 'neq' | 'contains' | 'exists' | 'not_exists';
  value: string;
  onTrue: string;
  onFalse: string;
}

export function emptyStep(index: number): DraftWorkflowStep {
  return {
    id: `step_${index}`,
    type: 'end',
    duration: '30s',
    body: '',
    field: 'lead.status',
    operator: 'eq',
    value: '',
    onTrue: '',
    onFalse: '',
  };
}

/** Existing advanced definitions stay readable but are never silently simplified in the editor. */
export function toDraftSteps(definition: WorkflowDefinition): DraftWorkflowStep[] | null {
  const result: DraftWorkflowStep[] = [];
  for (const step of definition.steps) {
    if (!['wait', 'condition', 'send_message', 'end'].includes(step.type)) return null;
    const draft = emptyStep(result.length + 1);
    draft.id = step.id;
    draft.type = step.type as EditableStepType;
    if (step.type === 'wait') {
      if (!hasOnlyKeys(step.config, ['duration']) || typeof step.config.duration !== 'string')
        return null;
      draft.duration = step.config.duration;
    }
    if (step.type === 'send_message') {
      if (!hasOnlyKeys(step.config, ['body']) || typeof step.config.body !== 'string') return null;
      draft.body = step.config.body;
    }
    if (step.type === 'condition') {
      const expression = step.config.condition;
      if (
        !hasOnlyKeys(step.config, ['condition', 'onTrue', 'onFalse']) ||
        !isRecord(expression) ||
        !hasOnlyKeys(expression, ['field', 'operator', 'value']) ||
        typeof expression.field !== 'string' ||
        !['eq', 'neq', 'contains', 'exists', 'not_exists'].includes(String(expression.operator)) ||
        (expression.value !== undefined && typeof expression.value !== 'string') ||
        (['exists', 'not_exists'].includes(String(expression.operator)) &&
          expression.value !== undefined) ||
        (!['exists', 'not_exists'].includes(String(expression.operator)) &&
          typeof expression.value !== 'string') ||
        (step.config.onTrue !== undefined && typeof step.config.onTrue !== 'string') ||
        (step.config.onFalse !== undefined && typeof step.config.onFalse !== 'string')
      )
        return null;
      draft.field = expression.field;
      draft.operator = expression.operator as DraftWorkflowStep['operator'];
      draft.value = typeof expression.value === 'string' ? expression.value : '';
      draft.onTrue = typeof step.config.onTrue === 'string' ? step.config.onTrue : '';
      draft.onFalse = typeof step.config.onFalse === 'string' ? step.config.onFalse : '';
    }
    if (step.type === 'end' && Object.keys(step.config).length > 0) return null;
    result.push(draft);
  }
  return result;
}

export function toWorkflowDefinition(drafts: readonly DraftWorkflowStep[]): WorkflowDefinition {
  if (drafts.length === 0) throw new Error('Add at least one step.');
  if (drafts.length > 100) throw new Error('A workflow can contain at most 100 steps.');
  const steps: WorkflowStepDefinition[] = drafts.map((draft, index) => {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(draft.id))
      throw new Error(`Step ${index + 1} needs a valid ID.`);
    if (draft.type === 'wait') {
      const duration = /^([1-9][0-9]*)(s|h)$/.exec(draft.duration);
      if (!duration) throw new Error(`Step ${index + 1} needs a duration such as 30s or 1h.`);
      const milliseconds = Number(duration[1]) * (duration[2] === 's' ? 1_000 : 3_600_000);
      if (!Number.isSafeInteger(milliseconds))
        throw new Error(`Step ${index + 1} wait duration is too large.`);
      return { id: draft.id, type: draft.type, config: { duration: draft.duration } };
    }
    if (draft.type === 'send_message') {
      const body = draft.body.trim();
      if (!body || body.length > 1600)
        throw new Error(`Step ${index + 1} needs an SMS message of 1–1600 characters.`);
      return { id: draft.id, type: draft.type, config: { body } };
    }
    if (draft.type === 'condition') {
      const hasValue = draft.operator !== 'exists' && draft.operator !== 'not_exists';
      if (hasValue && !draft.value.trim())
        throw new Error(`Step ${index + 1} needs a comparison value.`);
      return {
        id: draft.id,
        type: draft.type,
        config: {
          condition: {
            field: draft.field.trim(),
            operator: draft.operator,
            ...(hasValue ? { value: draft.value.trim() } : {}),
          },
          ...(draft.onTrue ? { onTrue: draft.onTrue } : {}),
          ...(draft.onFalse ? { onFalse: draft.onFalse } : {}),
        },
      };
    }
    return { id: draft.id, type: 'end', config: {} };
  });
  return validateWorkflowDefinitionForActivation({ steps });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
