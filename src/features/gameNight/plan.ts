import { Cron } from 'croner';
import { readAnnouncement } from './announcement.ts';

export interface Announcement {
  id: string;
  url: string;
  authorId: string;
  content: string;
  createdAt: Date;
}

export type Plan =
  | { kind: 'game'; game: string; label?: string; link?: string; source: Announcement }
  | { kind: 'cancelled'; phrase: string; source: Announcement }
  | { kind: 'none' };

/** One scheduled game night, and the stretch of time whose announcements apply to it. */
export interface Session {
  /** When the session starts (and the bot posts). */
  startsAt: Date;
  /** The previous session's start; announcements posted after this count for this session. */
  windowStart: Date;
}

/**
 * Decides what happens at a session from the announcements posted in its window.
 * The newest post that names a game or cancels wins; posts that do neither (other
 * news) are skipped, so they don't override the weekly announcement.
 */
export function decidePlan(announcements: Announcement[], session: Session): Plan {
  const inWindow = announcements
    .filter((a) => a.createdAt > session.windowStart && a.createdAt <= session.startsAt)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  for (const source of inWindow) {
    const reading = readAnnouncement(source.content);
    if (reading.kind === 'game') {
      const { kind, ...game } = reading;
      return { kind, ...game, source };
    }
    if (reading.kind === 'cancelled') return { kind: 'cancelled', phrase: reading.phrase, source };
  }
  return { kind: 'none' };
}

export function createSchedule(pattern: string, timezone: string): Cron {
  return new Cron(pattern, { timezone, paused: true });
}

/** The next session after `now`. */
export function nextSession(schedule: Cron, now: Date = new Date()): Session {
  const startsAt = schedule.nextRun(now);
  if (!startsAt) throw new Error('Game night schedule has no upcoming runs.');
  return sessionStartingAt(schedule, startsAt);
}

/** The most recent session that started at or before `now`. */
export function latestSession(schedule: Cron, now: Date = new Date()): Session {
  const [startsAt] = schedule.previousRuns(1, new Date(now.getTime() + 1));
  if (!startsAt) throw new Error('Game night schedule has no past runs.');
  return sessionStartingAt(schedule, startsAt);
}

export function sessionStartingAt(schedule: Cron, startsAt: Date): Session {
  const [windowStart] = schedule.previousRuns(1, startsAt);
  // A schedule with no earlier run (shouldn't happen for a weekly pattern): look back a week.
  return { startsAt, windowStart: windowStart ?? new Date(startsAt.getTime() - 7 * 24 * 3600_000) };
}
