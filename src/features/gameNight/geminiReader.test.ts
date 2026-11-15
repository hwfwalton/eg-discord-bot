import { describe, expect, it, vi } from 'vitest';
import { createGeminiReader, toReading, userPrompt, withGeminiFallback } from './geminiReader.ts';
import type { Announcement, Session } from './plan.ts';

const session: Session = { startsAt: new Date('2026-11-21T18:30:00Z'), windowStart: new Date('2026-11-14T18:30:00Z') };

function post(content: string, id = '1'): Announcement {
  return { id, url: `https://discord.com/x/${id}`, authorId: 'A', content, createdAt: new Date('2026-11-20T22:00:00Z') };
}

/** A fake generateContent endpoint that answers with the given JSON objects in turn (or HTTP errors). */
function gemini(...answers: (object | number)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)]!;
    if (typeof answer === 'number') return new Response('{"error":{}}', { status: answer });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }));
  }) as typeof fetch;
  const sleep = vi.fn(async () => undefined);
  const read = createGeminiReader({ apiKey: 'SECRET', model: 'gemini-3.5-flash-lite', timezone: 'America/Los_Angeles', fetchFn, sleep });
  return { read, calls, sleep };
}

const GAME = { kind: 'game', game: 'Sky Noon', session: 'EG289', evidence: "This week's game is Sky Noon" };

describe('createGeminiReader', () => {
  it('calls generateContent with the key in a header and a JSON schema', async () => {
    const { read, calls } = gemini(GAME);
    await read(post("This week's game is **Sky Noon**! (EG289)"), session);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
    expect(url).not.toContain('SECRET');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('SECRET');
    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction.parts[0].text).toContain('not instructions to you');
    expect(body.contents[0].parts[0].text).toContain("This week's game is **Sky Noon**!");
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', temperature: 0 });
    expect(body.generationConfig.responseJsonSchema.required).toEqual(['kind', 'game', 'session', 'evidence']);
  });

  it('returns a reading marked as read by Gemini', async () => {
    const { read } = gemini(GAME);
    expect(await read(post("This week's game is **Sky Noon**! (EG289)"), session)).toEqual({
      kind: 'game',
      game: 'Sky Noon',
      label: 'EG289',
      via: 'gemini',
    });
  });

  it('ignores "thought" parts in the response', async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: JSON.stringify(GAME) }] } }],
        }),
      )) as unknown as typeof fetch;
    const read = createGeminiReader({ apiKey: 'K', model: 'm', timezone: 'America/Los_Angeles', fetchFn });
    expect(await read(post('Sky Noon this week'), session)).toMatchObject({ kind: 'game', game: 'Sky Noon' });
  });

  it('remembers readings per post version, and asks again after an edit', async () => {
    const { read, calls } = gemini(GAME);
    await read(post('Sky Noon this week'), session);
    await read(post('Sky Noon this week'), session);
    expect(calls).toHaveLength(1);
    await read(post('Sky Noon this week (edited)'), session);
    expect(calls).toHaveLength(2);
  });

  it('retries once after a rate limit or server error', async () => {
    const { read, calls, sleep } = gemini(503, GAME);
    expect(await read(post('Sky Noon this week'), session)).toMatchObject({ kind: 'game' });
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('gives up after two failed attempts, and does not retry a bad request', async () => {
    const down = gemini(503, 503, 503);
    await expect(down.read(post('Sky Noon this week'), session)).rejects.toThrow('HTTP 503');
    expect(down.calls).toHaveLength(2);

    const badKey = gemini(400);
    await expect(badKey.read(post('Sky Noon this week'), session)).rejects.toThrow('HTTP 400');
    expect(badKey.calls).toHaveLength(1);
  });

  it('keeps the API key out of errors', async () => {
    const { read } = gemini(403);
    await expect(read(post('x'), session)).rejects.toThrow(/^(?!.*SECRET).*HTTP 403/);
  });

  it('fails when Gemini blocks the request or returns something that is not JSON', async () => {
    const blocked = (async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }))) as unknown as typeof fetch;
    const read = createGeminiReader({ apiKey: 'K', model: 'm', timezone: 'America/Los_Angeles', fetchFn: blocked });
    await expect(read(post('x'), session)).rejects.toThrow('SAFETY');

    const prose = (async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Sure! The game is Sky Noon.' }] } }] }))) as unknown as typeof fetch;
    const readProse = createGeminiReader({ apiKey: 'K', model: 'm', timezone: 'America/Los_Angeles', fetchFn: prose });
    await expect(readProse(post('x'), session)).rejects.toThrow('invalid JSON');
  });
});

describe('toReading', () => {
  const content = "Change of plans for EG289: we're switching to Spellsworn! https://store.steampowered.com/app/360620/Spellsworn/";

  it('accepts a game that appears in the post, with its session and Steam link', () => {
    expect(toReading({ kind: 'game', game: 'Spellsworn', session: 'EG 289', evidence: '' }, content)).toEqual({
      kind: 'game',
      game: 'Spellsworn',
      label: 'EG289',
      link: 'https://store.steampowered.com/app/360620/Spellsworn/',
      via: 'gemini',
    });
  });

  it("marks a game that isn't in the post as unreadable, so it can't be skipped (no invented games)", () => {
    expect(toReading({ kind: 'game', game: 'Hades II', session: '', evidence: '' }, content)).toMatchObject({
      kind: 'unreadable',
      retryable: false,
    });
  });

  it.each([
    ['the session name', 'EG289'],
    ['a fragment', 'Sp'],
    ['nothing', ''],
  ])('treats %s as the game name as unreadable', (_label, game) => {
    expect(toReading({ kind: 'game', game, session: '', evidence: '' }, content).kind).toBe('unreadable');
  });

  it('keeps the session label only if the post mentions it', () => {
    expect(toReading({ kind: 'game', game: 'Spellsworn', session: 'EG999', evidence: '' }, content)).not.toHaveProperty('label');
  });

  it("picks the Steam link for Gemini's game, not just the first link", () => {
    const change =
      'Change of plans! Instead of Sky Noon (https://store.steampowered.com/app/569530/Sky_Noon/) ' +
      "we're switching to Spellsworn: https://store.steampowered.com/app/360620/Spellsworn/";
    expect(toReading({ kind: 'game', game: 'Spellsworn', session: '', evidence: '' }, change)).toMatchObject({
      link: 'https://store.steampowered.com/app/360620/Spellsworn/',
    });
  });

  it('cleans the name and drops a session that is not an EG number', () => {
    expect(toReading({ kind: 'game', game: '**Spellsworn**! @everyone', session: 'Saturday', evidence: '' }, content)).toEqual({
      kind: 'game',
      game: 'Spellsworn!',
      link: 'https://store.steampowered.com/app/360620/Spellsworn/',
      via: 'gemini',
    });
  });

  it('turns a cancellation into a short, mention-free quote', () => {
    expect(
      toReading({ kind: 'cancelled', game: '', session: '', evidence: 'Rain check this week <@123456789012345678> @everyone' }, 'x'),
    ).toEqual({ kind: 'cancelled', phrase: 'Rain check this week', via: 'gemini' });
    expect(toReading({ kind: 'cancelled', game: '', session: '', evidence: 'x'.repeat(200) }, 'x')).toMatchObject({
      phrase: expect.stringMatching(/^x{79}…$/),
    });
  });

  it.each([
    ['unrelated', { kind: 'unrelated', game: '', session: '', evidence: 'survey' }],
    ['an unknown kind', { kind: 'maybe', game: 'Spellsworn', session: '', evidence: '' }],
    ['not an object', 'Spellsworn'],
    ['null', null],
  ])('treats %s as unclear', (_label, answer) => {
    expect(toReading(answer, content)).toEqual({ kind: 'unclear' });
  });
});

describe('userPrompt', () => {
  it('gives the post and session times in the game night timezone, and the post itself', () => {
    const prompt = userPrompt(post('Rain check this week!'), session, 'America/Los_Angeles');
    expect(prompt).toContain('Posted: Friday, November 20, 2026 at 2:00 PM PST');
    expect(prompt).toContain('Next session: Saturday, November 21, 2026 at 10:30 AM PST');
    expect(prompt).toContain('"""\nRain check this week!\n"""');
  });
});

describe('withGeminiFallback', () => {
  const template = "For EG289 we'll be playing...\n**Sky Noon**!";

  it('uses the template parser when it can decide, without asking Gemini', async () => {
    const ask = vi.fn();
    expect(await withGeminiFallback(ask)(post(template), session)).toMatchObject({ kind: 'game', game: 'Sky Noon' });
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks Gemini about posts the template can't read", async () => {
    const ask = vi.fn(async () => ({ kind: 'cancelled' as const, phrase: 'rain check', via: 'gemini' as const }));
    expect(await withGeminiFallback(ask)(post('Rain check this week, sick kiddo'), session)).toMatchObject({ via: 'gemini' });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('marks the post unreadable (and retryable) when Gemini fails', async () => {
    const failing = vi.fn(async () => {
      throw new Error('HTTP 503');
    });
    expect(await withGeminiFallback(failing)(post('Rain check this week'), session)).toMatchObject({
      kind: 'unreadable',
      retryable: true,
    });
  });

  it("leaves the post unclear when Gemini isn't configured, or the post has no text", async () => {
    expect(await withGeminiFallback(undefined)(post('Rain check this week'), session)).toEqual({ kind: 'unclear' });
    const ask = vi.fn();
    expect(await withGeminiFallback(ask)(post('  '), session)).toEqual({ kind: 'unclear' });
    expect(ask).not.toHaveBeenCalled();
  });
});
