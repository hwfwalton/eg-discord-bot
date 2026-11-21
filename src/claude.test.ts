import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeError, askForJson, createClaudeClient } from './claude.ts';
import { fakeClaude, fakeMessagesApi, rawMessage } from './claudeTesting.ts';

const SCHEMA = { type: 'object', properties: { a: { type: 'integer' } }, required: ['a'], additionalProperties: false };
const REQUEST = { model: 'claude-opus-5-5', system: 'be brief', prompt: 'q', schema: SCHEMA };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('askForJson', () => {
  it('sends a structured-output request with the key in a header and refusal fallbacks on', async () => {
    const { client, calls } = fakeClaude({ a: 1 });
    expect(await askForJson(client, REQUEST)).toEqual({ a: 1 });

    expect(calls).toHaveLength(1);
    const { url, headers, body } = calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(headers.get('authorization')).toBe('Bearer SECRET');
    expect(headers.get('anthropic-beta')).toBe('server-side-fallback-2026-07-01');
    expect(body).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 16_000,
      system: 'be brief',
      messages: [{ role: 'user', content: 'q' }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      fallbacks: 'default',
    });
  });

  it("ignores ANTHROPIC_BASE_URL and the environment's credentials", async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'http://localhost:9999');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'OTHER-TOKEN');
    const { client, calls } = fakeClaude({ a: 1 });
    await askForJson(client, REQUEST);
    expect(calls[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer SECRET');
  });

  it('joins the text blocks, skipping thinking and fallback blocks', async () => {
    const { client } = fakeClaude(
      rawMessage({
        content: [
          { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } },
          { type: 'text', text: '{"a":' },
          { type: 'text', text: '2}' },
        ],
      }),
    );
    expect(await askForJson(client, REQUEST)).toEqual({ a: 2 });
  });

  it('throws on refusals, cut-off answers, and empty or invalid JSON', async () => {
    const refused = fakeClaude(rawMessage({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } }));
    await expect(askForJson(refused.client, REQUEST)).rejects.toThrow(new ClaudeError('Claude declined to answer (cyber)'));
    const cut = fakeClaude(rawMessage({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"a":' }] }));
    await expect(askForJson(cut.client, REQUEST)).rejects.toThrow("Claude's answer was cut off");
    await expect(askForJson(fakeClaude(rawMessage({ content: [] })).client, REQUEST)).rejects.toThrow('Claude gave no answer');
    const prose = fakeClaude(rawMessage({ content: [{ type: 'text', text: 'The answer is 4.' }] }));
    await expect(askForJson(prose.client, REQUEST)).rejects.toThrow('Claude returned invalid JSON');
  });

  it('throws API errors without the key', async () => {
    const error = await askForJson(fakeClaude(401).client, REQUEST).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 401 });
    expect(String(error)).not.toContain('SECRET');
  });

  it('retries overload errors, but not bad requests', async () => {
    const overloaded = fakeMessagesApi(529, { a: 3 });
    expect(await askForJson(createClaudeClient('K', { fetch: overloaded.fetch, maxRetries: 2 }), REQUEST)).toEqual({ a: 3 });
    expect(overloaded.calls).toHaveLength(2);

    const bad = fakeMessagesApi(400);
    await expect(askForJson(createClaudeClient('K', { fetch: bad.fetch, maxRetries: 2 }), REQUEST)).rejects.toMatchObject({ status: 400 });
    expect(bad.calls).toHaveLength(1);
  });
});
