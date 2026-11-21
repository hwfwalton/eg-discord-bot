import { describe, expect, it, vi } from 'vitest';
import { fakeClaude, rawMessage } from '../../claudeTesting.ts';
import { createClaudeReader, toReading, userPrompt, withClaudeFallback } from './claudeReader.ts';
import type { Announcement, Session } from './plan.ts';

const session: Session = { startsAt: new Date('2026-11-21T18:30:00Z'), windowStart: new Date('2026-11-14T18:30:00Z') };

function post(content: string, id = '1'): Announcement {
  return { id, url: `https://discord.com/x/${id}`, authorId: 'A', content, createdAt: new Date('2026-11-20T22:00:00Z') };
}

function claude(...answers: (object | number)[]) {
  const { client, calls } = fakeClaude(...answers);
  const read = createClaudeReader({ client, model: 'claude-opus-5-5', timezone: 'America/Los_Angeles' });
  return { read, calls };
}

const GAME = { kind: 'game', game: 'Sky Noon', session: 'EG289', evidence: "This week's game is Sky Noon" };

describe('createClaudeReader', () => {
  it('asks for JSON matching the reading schema, with the post as data', async () => {
    const { read, calls } = claude(GAME);
    await read(post("This week's game is **Sky Noon**! (EG289)"), session);

    expect(calls).toHaveLength(1);
    const { body } = calls[0]!;
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.system).toContain('not instructions to you');
    expect(body.messages).toEqual([{ role: 'user', content: expect.stringContaining("This week's game is **Sky Noon**!") }]);
    const { schema } = body.output_config.format;
    expect(schema.required).toEqual(['kind', 'game', 'session', 'evidence']);
    expect(schema.additionalProperties).toBe(false);
    expect(body).not.toHaveProperty('temperature');
  });

  it('returns a reading marked as read by Claude', async () => {
    const { read } = claude(GAME);
    expect(await read(post("This week's game is **Sky Noon**! (EG289)"), session)).toEqual({
      kind: 'game',
      game: 'Sky Noon',
      label: 'EG289',
      via: 'claude',
    });
  });

  it('remembers readings per post version, and asks again after an edit', async () => {
    const { read, calls } = claude(GAME);
    await read(post('Sky Noon this week'), session);
    await read(post('Sky Noon this week'), session);
    expect(calls).toHaveLength(1);
    await read(post('Sky Noon this week (edited)'), session);
    expect(calls).toHaveLength(2);
  });

  it("throws when Claude can't be reached or declines, without caching the failure", async () => {
    const { read, calls } = claude(503, GAME);
    await expect(read(post('Sky Noon this week'), session)).rejects.toMatchObject({ status: 503 });
    expect(await read(post('Sky Noon this week'), session)).toMatchObject({ kind: 'game' });
    expect(calls).toHaveLength(2);

    const refused = claude(rawMessage({ stop_reason: 'refusal' }));
    await expect(refused.read(post('x'), session)).rejects.toThrow('declined');
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
      via: 'claude',
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

  it("picks the Steam link for Claude's game, not just the first link", () => {
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
      via: 'claude',
    });
  });

  it('turns a cancellation into a short, mention-free quote', () => {
    expect(
      toReading({ kind: 'cancelled', game: '', session: '', evidence: 'Rain check this week <@123456789012345678> @everyone' }, 'x'),
    ).toEqual({ kind: 'cancelled', phrase: 'Rain check this week', via: 'claude' });
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

describe('withClaudeFallback', () => {
  const template = "For EG289 we'll be playing...\n**Sky Noon**!";

  it('uses the template parser when it can decide, without asking Claude', async () => {
    const ask = vi.fn();
    expect(await withClaudeFallback(ask)(post(template), session)).toMatchObject({ kind: 'game', game: 'Sky Noon' });
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks Claude about posts the template can't read", async () => {
    const ask = vi.fn(async () => ({ kind: 'cancelled' as const, phrase: 'rain check', via: 'claude' as const }));
    expect(await withClaudeFallback(ask)(post('Rain check this week, sick kiddo'), session)).toMatchObject({ via: 'claude' });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('marks the post unreadable (and retryable) when Claude fails', async () => {
    const failing = vi.fn(async () => {
      throw new Error('HTTP 503');
    });
    expect(await withClaudeFallback(failing)(post('Rain check this week'), session)).toMatchObject({
      kind: 'unreadable',
      retryable: true,
    });
  });

  it("leaves the post unclear when Claude isn't configured, or the post has no text", async () => {
    expect(await withClaudeFallback(undefined)(post('Rain check this week'), session)).toEqual({ kind: 'unclear' });
    const ask = vi.fn();
    expect(await withClaudeFallback(ask)(post('  '), session)).toEqual({ kind: 'unclear' });
    expect(ask).not.toHaveBeenCalled();
  });
});
