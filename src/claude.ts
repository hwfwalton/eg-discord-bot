// The Claude API client (Anthropic's official SDK), shared by the features that read text with
// Claude: game night's announcement reader and the game suggestion research. Each request asks
// for JSON matching a schema (structured outputs). The answer is still untrusted: callers check
// every fact against the text Claude read.
import Anthropic from '@anthropic-ai/sdk';

/** Thinking plus a short JSON answer fit easily; a cut-off answer is an error, not a partial one. */
const MAX_TOKENS = 16_000;
/** Claude Opus 5.5's default, set explicitly: these are short reading tasks, not hard problems. */
const EFFORT = 'medium';
/**
 * Per attempt, and the SDK retries timeouts, so a call that keeps hanging takes about 3x this.
 * Real calls take 2-8s; a short limit keeps a game-time retry loop from delaying the start post long.
 */
const TIMEOUT_MS = 30_000;

export interface ClaudeClientOptions {
  /** Replaced in tests. */
  fetch?: typeof fetch;
  /** Per attempt. */
  timeoutMs?: number;
  /** Retries after rate limits, overload, server and network errors; the SDK backs off between them. */
  maxRetries?: number;
}

export function createClaudeClient(apiKey: string, { fetch, timeoutMs = TIMEOUT_MS, maxRetries = 2 }: ClaudeClientOptions = {}): Anthropic {
  return new Anthropic({
    apiKey,
    // Explicit, so ANTHROPIC_BASE_URL (which tools like Claude Code set for themselves) can't send
    // the bot's key and requests elsewhere. Passing the key also stops the SDK reading other credentials.
    baseURL: 'https://api.anthropic.com',
    timeout: timeoutMs,
    maxRetries,
    // Also explicit, so ANTHROPIC_LOG=debug can't log requests.
    logLevel: 'warn',
    ...(fetch && { fetch }),
  });
}

export interface JsonRequest {
  model: string;
  system: string;
  prompt: string;
  /** JSON schema for the answer. Structured outputs need additionalProperties: false on every object. */
  schema: Record<string, unknown>;
}

export class ClaudeError extends Error {}

/** One Messages API request for a JSON answer. Throws on API errors, refusals and cut-off answers. */
export async function askForJson(client: Anthropic, request: JsonRequest): Promise<unknown> {
  const response = await client.beta.messages.create({
    model: request.model,
    max_tokens: MAX_TOKENS,
    system: request.system,
    messages: [{ role: 'user', content: request.prompt }],
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: request.schema } },
    // If a safety classifier declines (unlikely for this text), the API retries on Anthropic's
    // recommended fallback model. On models without fallbacks, the request just runs as is.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
  });
  // A refused or cut-off answer may not match the schema.
  if (response.stop_reason === 'refusal') {
    throw new ClaudeError(`Claude declined to answer (${response.stop_details?.category ?? 'no category'})`);
  }
  if (response.stop_reason === 'max_tokens') throw new ClaudeError("Claude's answer was cut off");
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new ClaudeError(text.trim() ? 'Claude returned invalid JSON' : 'Claude gave no answer');
  }
}
