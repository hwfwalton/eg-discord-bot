// Test helper: a fake Claude Messages API behind the real SDK client, so tests exercise the SDK's
// own request building, response parsing and retries.
import type Anthropic from '@anthropic-ai/sdk';
import { createClaudeClient } from './claude.ts';

const RAW = Symbol('raw message');

/** A reply that's sent as these Message fields instead of a JSON answer (e.g. a refusal). */
export function rawMessage(fields: Record<string, unknown>): object {
  return { [RAW]: fields };
}

export interface FakeCall {
  url: string;
  headers: Headers;
  body: Record<string, any>;
}

/**
 * A client whose requests get these replies in turn (the last one repeats): an object is the JSON
 * answer, a number is an HTTP error status, rawMessage(...) overrides the message itself. It
 * doesn't retry; see fakeMessagesApi for one that does.
 */
export function fakeClaude(...replies: (object | number)[]): { client: Anthropic; calls: FakeCall[] } {
  const { fetch, calls } = fakeMessagesApi(...replies);
  return { client: createClaudeClient('SECRET', { fetch, maxRetries: 0 }), calls };
}

/** The fetch behind fakeClaude, for building a client with other options. */
export function fakeMessagesApi(...replies: (object | number)[]): { fetch: typeof globalThis.fetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    const headers = { 'content-type': 'application/json', 'retry-after-ms': '1' };
    if (typeof reply === 'number') {
      return new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Fake error' } }), { status: reply, headers });
    }
    const raw = (reply as Record<symbol, Record<string, unknown>>)[RAW];
    return new Response(JSON.stringify(message(raw ?? { content: [{ type: 'text', text: JSON.stringify(reply) }] })), { headers });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

function message(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 100, output_tokens: 20 },
    ...fields,
    // Opus 5.5 always thinks; its thinking blocks come back empty by default.
    content: [{ type: 'thinking', thinking: '', signature: 'sig' }, ...((fields.content as unknown[]) ?? [])],
  };
}
