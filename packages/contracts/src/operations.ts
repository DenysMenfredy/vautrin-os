import type { PageResponse } from './business.js';
export interface OperationsSummary {
  readonly workflowRuns: number;
  readonly failedWorkflows: number;
  readonly waitingWorkflows: number;
  readonly agentRuns: number;
  readonly handoffs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly outboundMessages: number;
  readonly failedMessages: number;
  readonly bookedAppointments: number;
  readonly missedCalls: number;
  readonly pendingEvents: number;
  readonly oldestPendingEventAgeSeconds: number | null;
}
export interface WorkflowRunSummary {
  readonly id: string;
  readonly workflowKey: string;
  readonly workflowVersion: number;
  readonly triggerEvent: string;
  readonly status: string;
  readonly currentStepId: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
  readonly correlationId: string | null;
}
export type WorkflowRunPage = PageResponse<WorkflowRunSummary>;
export interface WorkflowRunDetail extends WorkflowRunSummary {
  readonly steps: readonly {
    readonly id: string;
    readonly stepId: string;
    readonly stepType: string;
    readonly status: string;
    readonly attempt: number;
    readonly error: string | null;
    readonly durationMs: number | null;
    readonly scheduledFor: string | null;
  }[];
  readonly agents: readonly {
    readonly id: string;
    readonly status: string;
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
    readonly cachedInputTokens: number | null;
    readonly toolCount: number;
    readonly latencyMs: number | null;
    readonly failureReason: string | null;
    readonly handoffReason: string | null;
  }[];
}
export interface IntegrationSummary {
  readonly id: string;
  readonly provider: string;
  readonly category: string;
  readonly status: string;
  readonly connectedAt: string | null;
  readonly configuration: Readonly<Record<string, unknown>>;
}
export type IntegrationPage = PageResponse<IntegrationSummary>;
