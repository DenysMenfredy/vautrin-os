/**
 * Logical queues (ADR-009 §Queue categories).
 *
 * Separate queues rather than one, because these workloads have genuinely
 * different characteristics: webhook ingestion must drain fast to keep
 * providers from retrying, AI calls are slow and expensive, and workflow
 * steps carry delays measured in hours. One shared queue would let any of
 * them starve the others.
 */
export const QUEUE = {
  /** Workflow step execution, including delayed steps (SDD-07 §9). */
  WORKFLOW: 'workflow',
  /** Agent runs and embedding work (SDD-06). */
  AI: 'ai',
  /** Outbound messages through provider adapters (SDD-08). */
  NOTIFICATIONS: 'notifications',
  /** Inbound provider callbacks (SDD-08 §5). */
  WEBHOOKS: 'webhooks',
} as const;

export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export const ALL_QUEUES: readonly QueueName[] = Object.values(QUEUE);
