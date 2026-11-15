import { describe, expect, it } from 'vitest';
import { type Announcement, createSchedule, decidePlan, latestSession, nextSession } from './plan.ts';

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

  it('uses the newest announcement that names a game', () => {
    const plan = decidePlan(
      [post("we'll be playing **Hades II**", '2026-11-09T20:00:00Z'), post("we'll be playing **Factorio** instead", '2026-11-11T20:00:00Z')],
      session,
    );
    expect(plan).toMatchObject({ kind: 'game', game: 'Factorio' });
  });

  it('ignores newer posts that are not about game night', () => {
    const plan = decidePlan(
      [post("we'll be playing **Hades II**", '2026-11-09T20:00:00Z'), post('Server rules updated', '2026-11-12T20:00:00Z')],
      session,
    );
    expect(plan).toMatchObject({ kind: 'game', game: 'Hades II' });
  });

  it('respects a cancellation posted after the game announcement', () => {
    const plan = decidePlan(
      [post("we'll be playing **Hades II**", '2026-11-09T20:00:00Z'), post('Sorry, no game this week', '2026-11-13T20:00:00Z')],
      session,
    );
    expect(plan).toMatchObject({ kind: 'cancelled' });
  });

  it("ignores last week's announcement", () => {
    expect(decidePlan([post("we'll be playing **Hades II**", '2026-11-05T20:00:00Z')], session)).toEqual({ kind: 'none' });
  });

  it('has no plan when nothing was announced', () => {
    expect(decidePlan([], session)).toEqual({ kind: 'none' });
  });
});
