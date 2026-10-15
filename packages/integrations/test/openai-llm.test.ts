import { describe, expect, it, vi } from 'vitest';
import { LLMProviderError, OpenAILLMProvider } from '../src/openai-llm.provider.js';

describe('OpenAI Responses provider boundary', () => {
  it('disables provider storage, maps tool turns and records normalized usage', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'test-model',
          status: 'completed',
          output: [
            {
              type: 'function_call',
              call_id: 'call-a',
              name: 'qualify_lead',
              arguments: '{"service":"kitchen"}',
            },
          ],
          usage: {
            input_tokens: 20,
            output_tokens: 5,
            input_tokens_details: { cached_tokens: 4 },
          },
        }),
      ),
    );
    const provider = new OpenAILLMProvider('synthetic-key', http);
    const result = await provider.generate({
      model: 'test-model',
      messages: [
        { role: 'system', content: 'Policy' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'prior-call', name: 'lookup', input: {} }],
        },
        { role: 'tool', content: '{}', toolCallId: 'prior-call' },
      ],
      tools: [{ name: 'qualify_lead', description: 'Collect', inputSchema: { type: 'object' } }],
    });
    expect(result.toolCalls).toEqual([
      { id: 'call-a', name: 'qualify_lead', input: { service: 'kitchen' } },
    ]);
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 5, cachedInputTokens: 4 });
    const body = JSON.parse(String(http.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body.store).toBe(false);
    expect(body.parallel_tool_calls).toBe(false);
    expect(body.input).toContainEqual({
      type: 'function_call_output',
      call_id: 'prior-call',
      output: '{}',
    });
  });
  it('carries encrypted reasoning and function calls into a stateless follow-up turn', async () => {
    const reasoning = {
      type: 'reasoning',
      id: 'r-1',
      summary: [],
      encrypted_content: 'opaque-reasoning',
    };
    const call = { type: 'function_call', call_id: 'call-1', name: 'lookup', arguments: '{}' };
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ model: 'test-model', output: [reasoning, call] })),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'test-model',
            output: [
              {
                type: 'function_call',
                call_id: 'call-2',
                name: 'respond',
                arguments: '{"kind":"ask"}',
              },
            ],
          }),
        ),
      );
    const provider = new OpenAILLMProvider('synthetic-key', http);
    const first = await provider.generate({
      model: 'test-model',
      messages: [{ role: 'system', content: 'Policy' }],
    });
    await provider.generate({
      model: 'test-model',
      ...(first.continuation ? { continuation: first.continuation } : {}),
      messages: [{ role: 'tool', toolCallId: 'call-1', content: '{"found":true}' }],
    });
    const body = JSON.parse(String(http.mock.calls[1]?.[1]?.body));
    expect(body.input).toEqual([
      { role: 'system', content: 'Policy' },
      reasoning,
      call,
      { type: 'function_call_output', call_id: 'call-1', output: '{"found":true}' },
    ]);
    expect(body.store).toBe(false);
  });
  it.each([429, 503, 401])(
    'returns safe bounded failure classification for HTTP %s',
    async (status) => {
      const provider = new OpenAILLMProvider(
        'synthetic-key',
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response('provider-secret-error-body', { status })),
      );
      const error = await provider
        .generate({ model: 'test-model', messages: [] })
        .catch((value: unknown) => value);
      expect(error).toBeInstanceOf(LLMProviderError);
      expect((error as LLMProviderError).retryable).toBe(status !== 401);
      expect(String(error)).not.toContain('provider-secret-error-body');
    },
  );
  it('rejects malformed tool JSON and provider refusal before tools can execute', async () => {
    for (const output of [
      [{ type: 'function_call', call_id: 'a', name: 'tool', arguments: 'broken' }],
      [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }],
    ]) {
      const provider = new OpenAILLMProvider(
        'synthetic-key',
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(JSON.stringify({ model: 'test-model', output }))),
      );
      await expect(provider.generate({ model: 'test-model', messages: [] })).rejects.toBeInstanceOf(
        LLMProviderError,
      );
    }
  });
});
