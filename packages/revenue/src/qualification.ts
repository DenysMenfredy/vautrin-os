import type { QualificationAnswers, QualificationRules } from '@vautrin/contracts';

export interface QualificationCatalog {
  readonly services: readonly { readonly key: string; readonly name: string }[];
  readonly serviceAreas: readonly { readonly type: string; readonly value: string }[];
}
export type QualificationDecision = {
  readonly disposition:
    | 'QUALIFIED'
    | 'NEEDS_INFORMATION'
    | 'UNSUPPORTED_SERVICE'
    | 'OUTSIDE_SERVICE_AREA'
    | 'HUMAN_REVIEW';
  readonly missingFields: readonly string[];
};

/** Business decisions are deterministic; the model can collect facts, never override policy. */
export function assessQualification(
  rules: QualificationRules,
  answers: QualificationAnswers,
  catalog: QualificationCatalog,
): QualificationDecision {
  const missingFields = rules.requiredFields.filter((field) => !answers[field]?.trim());
  if (answers.serviceKey && !catalog.services.some((service) => service.key === answers.serviceKey))
    return { disposition: 'UNSUPPORTED_SERVICE', missingFields };
  const areas = catalog.serviceAreas.filter((area) => area.type === 'POSTAL_CODE');
  if (answers.postalCode && !areas.length) return { disposition: 'HUMAN_REVIEW', missingFields };
  if (answers.postalCode && !areas.some((area) => area.value === answers.postalCode))
    return { disposition: 'OUTSIDE_SERVICE_AREA', missingFields };
  if (
    answers.propertyType &&
    rules.propertyTypes?.length &&
    !rules.propertyTypes.some((type) => type.toLowerCase() === answers.propertyType?.toLowerCase())
  )
    return { disposition: 'HUMAN_REVIEW', missingFields };
  if (answers.budgetRange && rules.minimumBudget !== undefined) {
    const budget = minimumStatedBudget(answers.budgetRange);
    if (budget === undefined)
      return {
        disposition: 'NEEDS_INFORMATION',
        missingFields: [...new Set([...missingFields, 'budgetRange'])],
      };
    if (budget < rules.minimumBudget) return { disposition: 'HUMAN_REVIEW', missingFields };
  }
  return { disposition: missingFields.length ? 'NEEDS_INFORMATION' : 'QUALIFIED', missingFields };
}

function minimumStatedBudget(value: string): number | undefined {
  const matches = [...value.replaceAll(',', '').matchAll(/\b(\d+(?:\.\d+)?)\s*(k)?\b/gi)];
  if (!matches.length) return undefined;
  const amounts = matches.map((match) => Number(match[1]) * (match[2] ? 1_000 : 1));
  return Math.min(...amounts);
}
