import type {
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResponse,
  LLMStreamEvent,
} from './llm-provider.js';

export class LLMProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'LLMProviderError';
  }
}

type Fetch = typeof fetch;
type Item = Readonly<Record<string, unknown>>;

/** Responses API adapter. No SDK types, API keys or provider error bodies leave it. */
export class OpenAILLMProvider implements LLMProvider {
  constructor(
    private readonly apiKey: string,
    private readonly http: Fetch = fetch,
  ) {}

  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (!this.apiKey || !request.model || request.messages.length > 100) {
      throw new LLMProviderError('llm_invalid_configuration', false);
    }
    let input = request.messages.flatMap(toInput);
    if (request.continuation) {
      let previous: unknown;
      try {
        previous = JSON.parse(request.continuation);
      } catch {
        throw new LLMProviderError('llm_invalid_continuation', false);
      }
      if (!Array.isArray(previous) || previous.length > 300)
        throw new LLMProviderError('llm_invalid_continuation', false);
      input = [...previous, ...input];
    }
    if (JSON.stringify(input).length > 250_000)
      throw new LLMProviderError('llm_context_limit', false);
    let response: Response;
    try {
      response = await this.http('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({
          model: request.model,
          input,
          include: ['reasoning.encrypted_content'],
          store: false,
          parallel_tool_calls: false,
          max_output_tokens: request.maxOutputTokens ?? 2_000,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          tools: (request.tools ?? []).map((tool) => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
            strict: false,
          })),
        }),
      });
    } catch {
      throw new LLMProviderError('llm_network_error', true);
    }
    if (!response.ok) {
      throw new LLMProviderError(
        response.status === 429
          ? 'llm_rate_limited'
          : response.status >= 500
            ? 'llm_unavailable'
            : 'llm_request_rejected',
        response.status === 429 || response.status >= 500,
      );
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new LLMProviderError('llm_invalid_response', false);
    }
    const data = record(value);
    if (!Array.isArray(data.output) || typeof data.model !== 'string') {
      throw new LLMProviderError('llm_invalid_response', false);
    }
    const toolCalls = [];
    const text: string[] = [];
    for (const raw of data.output) {
      const item = record(raw);
      if (item.type === 'function_call') {
        if (
          typeof item.call_id !== 'string' ||
          typeof item.name !== 'string' ||
          typeof item.arguments !== 'string'
        )
          throw new LLMProviderError('llm_invalid_tool_call', false);
        let input: unknown;
        try {
          input = JSON.parse(item.arguments);
        } catch {
          throw new LLMProviderError('llm_invalid_tool_call', false);
        }
        toolCalls.push({ id: item.call_id, name: item.name, input });
      } else if (item.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) {
          const content = record(part);
          if (content.type === 'refusal') throw new LLMProviderError('llm_refused', false);
          if (content.type === 'output_text' && typeof content.text === 'string')
            text.push(content.text);
        }
      }
    }
    const usage = record(data.usage);
    const cached = record(usage.input_tokens_details).cached_tokens;
    return {
      continuation: JSON.stringify([...input, ...data.output]),
      provider: 'openai',
      model: data.model,
      content: text.length ? text.join('') : null,
      toolCalls,
      finishReason:
        data.status === 'incomplete' ? 'length' : toolCalls.length ? 'tool_calls' : 'stop',
      usage: {
        ...(token(usage.input_tokens) === undefined
          ? {}
          : { inputTokens: token(usage.input_tokens) as number }),
        ...(token(usage.output_tokens) === undefined
          ? {}
          : { outputTokens: token(usage.output_tokens) as number }),
        ...(token(cached) === undefined ? {} : { cachedInputTokens: token(cached) as number }),
      },
      ...(typeof data.id === 'string' ? { providerRequestId: data.id } : {}),
    };
  }

  /** The v0.3 agent uses complete turns; this port yields normalized completed output. */
  async *stream(request: LLMRequest): AsyncIterable<LLMStreamEvent> {
    const response = await this.generate(request);
    if (response.content) yield { type: 'text_delta', text: response.content };
    for (const call of response.toolCalls) yield { type: 'tool_call', call };
    yield { type: 'completed', response };
  }
}

function toInput(message: LLMMessage): Item[] {
  if (message.role === 'tool') {
    if (!message.toolCallId) throw new LLMProviderError('llm_tool_result_unbound', false);
    return [{ type: 'function_call_output', call_id: message.toolCallId, output: message.content }];
  }
  if (message.toolCalls?.length) {
    return message.toolCalls.map((call) => ({
      type: 'function_call',
      call_id: call.id,
      name: call.name,
      arguments: JSON.stringify(call.input),
    }));
  }
  return [{ role: message.role, content: message.content }];
}
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function token(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 2_147_483_647
    ? value
    : undefined;
}
