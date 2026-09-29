import type { WorkflowConditionExpression, WorkflowContext } from '@vautrin/contracts';
import { describe, expect, it } from 'vitest';

import { evaluateWorkflowCondition, WorkflowConditionError } from './condition-evaluator.js';

const context: WorkflowContext = {
  event: { name: 'lead.status_changed', payload: { from: 'NEW', to: 'QUALIFIED' } },
  workflow: { id: 'workflow-1', key: 'lead-follow-up', version: 2, trigger: 'lead.status_changed' },
  lead: { id: 'lead-1', status: 'QUALIFIED', estimatedValue: 2500 },
  contact: { tags: ['remodeling', 'repeat-customer'] },
  steps: { previous: { delivered: true, attempt: 2 } },
};

function evaluate(condition: WorkflowConditionExpression, value = context): boolean {
  return evaluateWorkflowCondition(condition, value);
}

describe('evaluateWorkflowCondition', () => {
  it.each([
    [{ field: 'lead.status', operator: 'eq', value: 'QUALIFIED' }, true],
    [{ field: 'lead.status', operator: 'neq', value: 'NEW' }, true],
    [{ field: 'lead.estimatedValue', operator: 'gt', value: 2000 }, true],
    [{ field: 'lead.estimatedValue', operator: 'gte', value: 2500 }, true],
    [{ field: 'lead.estimatedValue', operator: 'lt', value: 3000 }, true],
    [{ field: 'lead.estimatedValue', operator: 'lte', value: 2500 }, true],
    [{ field: 'event.payload.to', operator: 'in', value: ['NEW', 'QUALIFIED'] }, true],
    [{ field: 'event.payload.to', operator: 'not_in', value: ['NEW', 'LOST'] }, true],
    [{ field: 'event.name', operator: 'contains', value: 'status' }, true],
    [{ field: 'contact.tags', operator: 'contains', value: 'remodeling' }, true],
    [{ field: 'steps.previous.delivered', operator: 'eq', value: true }, true],
  ] as const)('evaluates %j to %s', (condition, expected) => {
    expect(evaluate(condition as WorkflowConditionExpression)).toBe(expected);
  });

  it('evaluates all, any, and not with deterministic boolean semantics', () => {
    expect(
      evaluate({
        all: [
          { field: 'lead.status', operator: 'eq', value: 'QUALIFIED' },
          {
            any: [
              { field: 'lead.estimatedValue', operator: 'gte', value: 2500 },
              { field: 'lead.status', operator: 'eq', value: 'NEW' },
            ],
          },
          { not: { field: 'lead.status', operator: 'eq', value: 'LOST' } },
        ],
      }),
    ).toBe(true);
    expect(evaluate({ all: [] })).toBe(true);
    expect(evaluate({ any: [] })).toBe(false);
  });

  it('fails on incompatible values in every branch, independent of logical short-circuit results', () => {
    expect(() =>
      evaluate({
        all: [
          { field: 'lead.status', operator: 'eq', value: 'NEW' },
          { field: 'lead.estimatedValue', operator: 'gt', value: 'not-a-number' },
        ],
      }),
    ).toThrow(new WorkflowConditionError('incompatible_operand_types'));
    expect(() =>
      evaluate({
        any: [
          { field: 'lead.status', operator: 'eq', value: 'QUALIFIED' },
          { field: 'lead.estimatedValue', operator: 'gt', value: 'not-a-number' },
        ],
      }),
    ).toThrow(new WorkflowConditionError('incompatible_operand_types'));
  });

  it('treats missing values as false except for not_exists', () => {
    expect(evaluate({ field: 'lead.deletedAt', operator: 'exists' })).toBe(false);
    expect(evaluate({ field: 'lead.deletedAt', operator: 'not_exists' })).toBe(true);
    expect(evaluate({ field: 'lead.deletedAt', operator: 'neq', value: null })).toBe(false);
    expect(evaluate({ field: 'event.payload.constructor.prototype', operator: 'exists' })).toBe(
      false,
    );
    expect(
      evaluate(
        { field: 'lead.deletedAt', operator: 'exists' },
        { ...context, lead: Object.create({ deletedAt: 'inherited' }) as Record<string, unknown> },
      ),
    ).toBe(false);
  });

  it.each([
    { field: 'lead.status', operator: 'eq', value: 1 },
    { field: 'lead.estimatedValue', operator: 'gt', value: '2000' },
    { field: 'lead.status', operator: 'in', value: ['NEW', 1] },
    { field: 'event.name', operator: 'contains', value: 1 },
    { field: 'lead.status', operator: 'contains', value: 1 },
  ] as const)('fails incompatible operands explicitly: %j', (condition) => {
    expect(() => evaluate(condition as WorkflowConditionExpression)).toThrow(
      new WorkflowConditionError('incompatible_operand_types'),
    );
  });
});
