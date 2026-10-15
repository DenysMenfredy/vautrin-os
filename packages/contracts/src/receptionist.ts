import { z } from 'zod';

export const QUALIFICATION_FIELDS = [
  'serviceKey',
  'propertyType',
  'postalCode',
  'budgetRange',
  'timeline',
  'description',
] as const;
export const qualificationRulesSchema = z.strictObject({
  requiredFields: z.array(z.enum(QUALIFICATION_FIELDS)).min(1).max(6),
  minimumBudget: z.number().nonnegative().optional(),
  propertyTypes: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
});
const answer = z.string().trim().min(1).max(2_000);
export const qualificationAnswersSchema = z.strictObject({
  serviceKey: answer.optional(),
  propertyType: answer.optional(),
  postalCode: answer.optional(),
  budgetRange: answer.optional(),
  timeline: answer.optional(),
  description: answer.optional(),
});
export const evidenceSchema = z.strictObject({
  messageId: z.uuid(),
  quote: z.string().min(1).max(2_000),
});
export const qualifyLeadToolSchema = z.strictObject({
  answers: qualificationAnswersSchema,
  evidence: z.partialRecord(z.enum(QUALIFICATION_FIELDS), evidenceSchema),
});
export const captureContactToolSchema = z
  .strictObject({
    firstName: answer.optional(),
    lastName: answer.optional(),
    postalCode: answer.optional(),
    evidence: evidenceSchema,
  })
  .refine(
    (value) => value.firstName || value.lastName || value.postalCode,
    'At least one field is required.',
  );
export const availabilityToolSchema = z.strictObject({
  appointmentTypeId: z.string().min(1).max(80),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
});
export const bookAppointmentToolSchema = z.strictObject({
  appointmentTypeId: z.string().min(1).max(80),
  startsAt: z.iso.datetime(),
  proofId: z.string().min(1).max(300),
  confirmation: evidenceSchema,
});
export const handoffToolSchema = z.strictObject({
  reason: z.enum([
    'customer_requested',
    'unsupported_service',
    'outside_service_area',
    'budget_review',
    'uncertain_information',
    'unsafe_request',
    'provider_failure',
    'configuration_missing',
  ]),
});
export const agentStepSchema = z.strictObject({
  agentKey: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
  purpose: z.enum(['recovery', 'qualification']).default('qualification'),
});
export type QualificationRules = z.infer<typeof qualificationRulesSchema>;
export type QualificationAnswers = z.infer<typeof qualificationAnswersSchema>;
export const RECEPTIONIST_TOOL_SCHEMAS = {
  qualify_lead: z.toJSONSchema(qualifyLeadToolSchema),
  capture_contact: z.toJSONSchema(captureContactToolSchema),
  check_availability: z.toJSONSchema(availabilityToolSchema),
  create_appointment: z.toJSONSchema(bookAppointmentToolSchema),
  human_handoff: z.toJSONSchema(handoffToolSchema),
};
export interface MissedCallRequest {
  readonly fromNumber: string;
  readonly idempotencyKey: string;
}
export interface MissedCallResponse {
  readonly callId: string;
  readonly leadId: string;
  readonly contactId: string;
  readonly conversationId: string;
}
export interface RemodelingTemplateRequest {
  readonly postalCodes: readonly string[];
  readonly timezone: string;
  readonly model: string;
  readonly recoveryDelayMs?: number;
  readonly followUpDelaysMs?: readonly number[];
}
export interface RemodelingTemplateResponse {
  readonly templateVersion: string;
  readonly agentId: string;
  readonly workflowIds: readonly string[];
}
