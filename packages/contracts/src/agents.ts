export const AGENT_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];
export type AgentLifecycleRequest = 'ACTIVE' | 'ARCHIVED';

export interface AgentResponse {
  readonly id: string;
  readonly key: string;
  readonly version: number;
  readonly name: string;
  readonly status: AgentStatus;
  readonly instructions: string;
  readonly promptVersion: string;
  readonly modelConfiguration: Readonly<Record<string, unknown>>;
  readonly allowedTools: readonly string[];
  readonly knowledgeStrategy: Readonly<Record<string, unknown>>;
  readonly guardrails: Readonly<Record<string, unknown>>;
  readonly handoffPolicy: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentPageResponse {
  readonly items: readonly AgentResponse[];
  readonly nextCursor: string | null;
}

export interface CreateAgentRequest {
  readonly key: string;
  readonly name: string;
  readonly instructions: string;
  readonly promptVersion: string;
  readonly modelConfiguration?: Readonly<Record<string, unknown>>;
  readonly allowedTools?: readonly string[];
  readonly knowledgeStrategy?: Readonly<Record<string, unknown>>;
  readonly guardrails?: Readonly<Record<string, unknown>>;
  readonly handoffPolicy?: Readonly<Record<string, unknown>>;
}

export type UpdateAgentRequest = Partial<Omit<CreateAgentRequest, 'key'>>;

export interface ListAgentsRequest {
  readonly limit?: number;
  readonly cursor?: string;
  readonly status?: AgentStatus;
}
