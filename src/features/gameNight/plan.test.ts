import { describe, expect, it } from 'vitest';
import { readAnnouncement } from './announcement.ts';
import { type Announcement, type Plan, createSchedule, decidePlan, latestSession, nextSession, planWithRetries } from './plan.ts';

const schedule = createSchedule('30 10 * * 6', 'America/Los_Angeles');

function post(content: string, createdAt: string, id = createdAt): Announcement {
  return { id, url: `https://discord.com/x/${id}`, authorId: '1', content, createdAt: new Date(createdAt) };
}

describe('schedule', () => {
  it('runs Saturdays at 10:30 Pacific, across daylight-saving changes', () => {
    // Nov 14 2026 is a Saturday. PST (UTC-8) after Nov 1.
    const session = nextSession(schedule, new Date('2026-11-12T12:00:00Z'));
    expect(session.startsAt.toISOString()).toBe('2026-11-14T18:30:00.000Z');
    expect(session.windowStart.toISOString()).toBe('2026-11-07T18:30:00.000Z');

    // Summer: PDT (UTC-7).
    expect(nextSession(schedule, new Date('2026-07-01T00:00:00Z')).startsAt.toISOString()).toBe(
      '2026-07-04T17:30:00.000Z',
    );
  });

  it('finds the session that just started', () => {
    const session = latestSession(schedule, new Date('2026-11-14T18:40:00Z'));
    expect(session.startsAt.toISOString()).toBe('2026-11-14T18:30:00.000Z');
  });

  it('counts a session as started at its exact start time', () => {
    const session = latestSession(schedule, new Date('2026-11-14T18:30:00Z'));
    expect(session.startsAt.toISOString()).toBe('2026-11-14T18:30:00.000Z');
  });
});

describe('decidePlan', () => {
  const session = nextSession(schedule, new Date('2026-11-12T12:00:00Z')); // window Nov 7 18:30 -> Nov 14 18:30

  it('uses the newest announcement that names a game', async () => {
    const plan = await decidePlan(
      [post("we'll be playing **Hades II**", '2026-11-09T20:00:00Z'), post("we'll be playing **Factorio** instead", '2026-11-11T20:00:00Z')],
      session,
    );
    expect(plan).toMatchObject({ kind: 'game', game: 'Factorio' });
  });

  it('ignores newer posts that are not about game night', async () => {
    const plan = await decidePlan(
      [post("we'll be playing **Hades II**", '2026-11-09T20:00:00Z'), post('Server rules updated', '2026-11-12T20:00:00Z')],
      session,
    );
    expect(plan).toMatchObject({ kind: 'game', game: 'Hades II' });
  });

  it('respects a cancellation posted after the game announcement', async () => {
    const plan = await decidePlan(
      [post("we'll be playing **Hades II**", '2026-11-09T20:00:00Z'), post('Sorry, no game this week', '2026-11-13T20:00:00Z')],
      session,
    );
    expect(plan).toMatchObject({ kind: 'cancelled' });
  });

  it("ignores last week's announcement", async () => {
    expect(await decidePlan([post("we'll be playing **Hades II**", '2026-11-05T20:00:00Z')], session)).toEqual({ kind: 'none' });
  });

  it('has no plan when nothing was announced', async () => {
    expect(await decidePlan([], session)).toEqual({ kind: 'none' });
  });

  it('reads newest first and stops at the first post that decides', async () => {
    const asked: string[] = [];
    const read = (p: Announcement) => {
      asked.push(p.id);
      return p.id === 'reminder' ? { kind: 'unclear' as const } : { kind: 'game' as const, game: p.id };
    };
    const plan = await decidePlan(
      [
        post('old', '2026-11-08T20:00:00Z', 'older-announcement'),
        post('new', '2026-11-12T20:00:00Z', 'announcement'),
        post('rem', '2026-11-13T20:00:00Z', 'reminder'),
      ],
      session,
      read,
    );
    expect(plan).toMatchObject({ kind: 'game', game: 'announcement' });
    expect(asked).toEqual(['reminder', 'announcement']);
  });

  it("carries a reader's via marker into the plan", async () => {
    const plan = await decidePlan([post('x', '2026-11-12T20:00:00Z')], session, () => ({
      kind: 'cancelled',
      phrase: 'rain check',
      via: 'gemini',
    }));
    expect(plan).toMatchObject({ kind: 'cancelled', phrase: 'rain check', via: 'gemini' });
  });

  describe('with a post Gemini read', () => {
    const announcement = post("For EG289 we'll be playing...\n**Sky Noon**!", '2026-11-12T20:00:00Z', 'announcement');
    const reminder = post('Reminder: Sky Noon in an hour!', '2026-11-14T17:30:00Z', 'reminder');
    const gemini = (game: string) => (p: Announcement) =>
      p.id === 'reminder' ? { kind: 'game' as const, game, via: 'gemini' as const } : readAnnouncementStub(p);

    it('defers to the template announcement when it confirms the same game', async () => {
      const plan = await decidePlan([announcement, reminder], session, gemini('sky noon'));
      expect(plan).toMatchObject({ kind: 'game', game: 'Sky Noon', label: 'EG289', source: { id: 'announcement' } });
      expect(plan).not.toHaveProperty('via');
    });

    it('defers when the names differ only by extra words, e.g. "(PC only)"', async () => {
      for (const name of ['Sky Noon (PC only)', 'Sky']) {
        const plan = await decidePlan([announcement, reminder], session, gemini(name));
        expect(plan).toMatchObject({ kind: 'game', game: 'Sky Noon', source: { id: 'announcement' } });
      }
    });

    it("doesn't ping when it names a different game than the announcement", async () => {
      const plan = await decidePlan([announcement, reminder], session, gemini('Spellsworn'));
      expect(plan).toMatchObject({ kind: 'unsure', retryable: false, source: { id: 'reminder' } });
      expect(plan.kind === 'unsure' && plan.reason).toContain('**Spellsworn**');
    });

    it("doesn't ping when it names a game for a week an earlier post cancelled", async () => {
      const cancelled = post('**No official EG this weekend!**', '2026-11-13T20:00:00Z', 'cancel');
      const plan = await decidePlan([announcement, cancelled, reminder], session, gemini('Sky Noon'));
      expect(plan).toMatchObject({ kind: 'unsure', source: { id: 'reminder' } });
      expect(plan.kind === 'unsure' && plan.reason).toContain('cancelled this session');
    });

    it('decides alone when no template announcement exists that week', async () => {
      const plan = await decidePlan([reminder], session, gemini('Sky Noon'));
      expect(plan).toMatchObject({ kind: 'game', game: 'Sky Noon', via: 'gemini', source: { id: 'reminder' } });
    });

    it('may cancel a week the announcement scheduled', async () => {
      const read = (p: Announcement) =>
        p.id === 'reminder' ? { kind: 'cancelled' as const, phrase: 'rain check', via: 'gemini' as const } : readAnnouncementStub(p);
      expect(await decidePlan([announcement, reminder], session, read)).toMatchObject({ kind: 'cancelled', via: 'gemini' });
    });

    it("doesn't let an older post decide over a newer one Gemini couldn't read", async () => {
      const read = (p: Announcement) =>
        p.id === 'reminder'
          ? { kind: 'unreadable' as const, reason: "couldn't be read because Gemini didn't respond", retryable: true }
          : readAnnouncementStub(p);
      expect(await decidePlan([announcement, reminder], session, read)).toMatchObject({
        kind: 'unsure',
        retryable: true,
        source: { id: 'reminder' },
      });
    });
  });
});

function readAnnouncementStub(p: Announcement) {
  return readAnnouncement(p.content);
}

describe('planWithRetries', () => {
  const source = post('x', '2026-11-12T20:00:00Z');
  const unreachable: Plan = { kind: 'unsure', reason: "couldn't be read", retryable: true, source };
  const conflict: Plan = { kind: 'unsure', reason: 'reads as X', retryable: false, source };
  const game: Plan = { kind: 'game', game: 'Sky Noon', source };

  function sequence(...plans: Plan[]) {
    let i = 0;
    return async () => plans[Math.min(i++, plans.length - 1)]!;
  }

  it('asks again while Gemini is unreachable, and uses the plan once it answers', async () => {
    const sleeps: number[] = [];
    const plan = await planWithRetries(sequence(unreachable, unreachable, game), [10, 20, 40], async (ms) => sleeps.push(ms));
    expect(plan).toBe(game);
    expect(sleeps).toEqual([10, 20]);
  });

  it('gives up after the last delay', async () => {
    const sleeps: number[] = [];
    expect(await planWithRetries(sequence(unreachable), [10, 20], async (ms) => sleeps.push(ms))).toBe(unreachable);
    expect(sleeps).toEqual([10, 20]);
  });

  it("doesn't wait for anything else, including a conflict that retrying can't fix", async () => {
    const sleep = async () => {
      throw new Error('should not wait');
    };
    expect(await planWithRetries(sequence(game), [10], sleep)).toBe(game);
    expect(await planWithRetries(sequence(conflict), [10], sleep)).toBe(conflict);
  });
});
