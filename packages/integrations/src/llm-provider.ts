/** Provider-neutral model input; no vendor SDK types cross this boundary. */
export interface LLMRequest {
  readonly model: string;
  readonly messages: readonly LLMMessage[];
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly tools?: readonly LLMToolDefinition[];
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface LLMMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  readonly toolCallId?: string;
}

/** JSON Schema is data only. It is never evaluated or compiled as code. */
export interface LLMToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface LLMToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface LLMUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly estimatedCost?: { readonly amount: string; readonly currency: string };
}

export interface LLMResponse {
  readonly provider: string;
  readonly model: string;
  readonly content: string | null;
  readonly toolCalls: readonly LLMToolCall[];
  readonly finishReason: 'stop' | 'tool_calls' | 'length' | 'other';
  readonly usage?: LLMUsage;
  readonly providerRequestId?: string;
}

export type LLMStreamEvent =
  | { readonly type: 'text_delta'; readonly text: string }
  | { readonly type: 'tool_call'; readonly call: LLMToolCall }
  | { readonly type: 'completed'; readonly response: LLMResponse };

/**
 * VOS-070/ADR-006. Implementations belong in provider adapters; the first
 * adapter is intentionally pending provider selection.
 */
export interface LLMProvider {
  generate(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncIterable<LLMStreamEvent>;
}

/** Optional capability, kept separate so generation-only providers are valid. */
export interface EmbeddingProvider {
  embed(input: readonly string[]): Promise<readonly (readonly number[])[]>;
}
