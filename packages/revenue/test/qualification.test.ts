import { validateWorkflowDefinitionForActivation } from '@vautrin/contracts';
import { describe, expect, it } from 'vitest';
import { assessQualification } from '../src/qualification.js';
import {
  missedCallWorkflow,
  REMODELING_QUALIFICATION_RULES,
  REMODELING_SERVICES,
} from '../src/remodeling-template.js';

const answers = {
  serviceKey: 'kitchen-remodeling',
  propertyType: 'single-family',
  postalCode: '78701',
  budgetRange: '$40k',
  timeline: 'next month',
  description: 'new cabinets',
};
const catalog = {
  services: REMODELING_SERVICES,
  serviceAreas: [{ type: 'POSTAL_CODE', value: '78701' }],
};
describe('remodeling qualification policy', () => {
  it('qualifies only complete, supported, covered projects', () => {
    expect(assessQualification(REMODELING_QUALIFICATION_RULES, answers, catalog).disposition).toBe(
      'QUALIFIED',
    );
    expect(
      assessQualification(
        REMODELING_QUALIFICATION_RULES,
        { ...answers, serviceKey: 'roofing' },
        catalog,
      ).disposition,
    ).toBe('UNSUPPORTED_SERVICE');
    expect(
      assessQualification(
        REMODELING_QUALIFICATION_RULES,
        { ...answers, postalCode: '99999' },
        catalog,
      ).disposition,
    ).toBe('OUTSIDE_SERVICE_AREA');
    expect(
      assessQualification(REMODELING_QUALIFICATION_RULES, { ...answers, timeline: '' }, catalog),
    ).toEqual({ disposition: 'NEEDS_INFORMATION', missingFields: ['timeline'] });
    expect(
      assessQualification(
        { ...REMODELING_QUALIFICATION_RULES, minimumBudget: 50_000 },
        answers,
        catalog,
      ).disposition,
    ).toBe('HUMAN_REVIEW');
    expect(
      assessQualification(
        { ...REMODELING_QUALIFICATION_RULES, minimumBudget: 1_000 },
        { ...answers, budgetRange: 'not sure' },
        catalog,
      ).disposition,
    ).toBe('NEEDS_INFORMATION');
  });
  it('uses forward-only branches and a bounded configured follow-up sequence', () => {
    const workflow = missedCallWorkflow(30_000, [7_200_000, 86_400_000]);
    expect(validateWorkflowDefinitionForActivation(workflow)).toEqual(workflow);
    expect(workflow.steps.filter((step) => step.type === 'send_message')).toHaveLength(2);
  });
});
