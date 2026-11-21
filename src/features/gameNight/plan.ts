import { Cron } from 'croner';
import { gameKey } from '../../gameName.ts';
import { type Reading, readAnnouncement } from './announcement.ts';

export interface Announcement {
  id: string;
  url: string;
  authorId: string;
  content: string;
  createdAt: Date;
}

export type Plan =
  | { kind: 'game'; game: string; label?: string; link?: string; via?: 'claude'; source: Announcement }
  | { kind: 'cancelled'; phrase: string; via?: 'claude'; source: Announcement }
  /**
   * A post Claude read couldn't be read, or contradicts the week's announcement. No start post:
   * a wrong @everyone ping is worse than a missed one. `retryable` when Claude was unreachable.
   */
  | { kind: 'unsure'; reason: string; retryable: boolean; source: Announcement }
  | { kind: 'none' };

/** Reads one announcement for a session. The default is the template parser (announcement.ts). */
export type ReadPost = (post: Announcement, session: Session) => Reading | Promise<Reading>;

const readTemplate: ReadPost = (post) => readAnnouncement(post.content);

/** One scheduled game night, and the stretch of time whose announcements apply to it. */
export interface Session {
  /** When the session starts (and the bot posts). */
  startsAt: Date;
  /** The previous session's start; announcements posted after this count for this session. */
  windowStart: Date;
}

/**
 * Decides what happens at a session from the announcements posted in its window.
 *
 * The newest post that names a game or cancels wins; posts that do neither (reminders, surveys,
 * news) are skipped, so they don't override the weekly announcement. Posts are read newest first
 * and only until one decides, so a slower reader (Claude) runs rarely.
 *
 * Posts only Claude could read get extra care, since a wrong @everyone ping is worse than a
 * missed one:
 * - If Claude couldn't read a post, nothing older is trusted over it: no start post.
 * - Claude may cancel a session, but it can't announce a game that contradicts the week's
 *   template announcement (a different game, or a cancelled session): no start post either.
 * - If it confirms the announcement's game (e.g. a reminder), the announcement is used.
 */
export async function decidePlan(
  announcements: Announcement[],
  session: Session,
  read: ReadPost = readTemplate,
): Promise<Plan> {
  const inWindow = announcements
    .filter((a) => a.createdAt > session.windowStart && a.createdAt <= session.startsAt)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  for (const [index, source] of inWindow.entries()) {
    const reading = await read(source, session);
    if (reading.kind === 'unclear') continue;
    if (reading.kind === 'unreadable') {
      return { kind: 'unsure', reason: reading.reason, retryable: reading.retryable, source };
    }
    if (reading.via !== 'claude' || reading.kind === 'cancelled') return planFrom(reading, source);

    // Claude read this post as naming a game: check it against the week's template announcement.
    const announced = templateDecision(inWindow.slice(index + 1));
    if (!announced) return planFrom(reading, source);
    if (announced.kind === 'game' && sameGame(announced.game, reading.game)) return announced;
    const reason =
      announced.kind === 'game'
        ? `reads as **${reading.game}**, but [the week's announcement](${announced.source.url}) says **${announced.game}**`
        : `reads as **${reading.game}**, but [an earlier announcement](${announced.source.url}) cancelled this session`;
    return { kind: 'unsure', reason, retryable: false, source };
  }
  return { kind: 'none' };
}

type Decision = Extract<Plan, { kind: 'game' | 'cancelled' }>;

function planFrom(reading: Extract<Reading, { kind: 'game' | 'cancelled' }>, source: Announcement): Decision {
  if (reading.kind === 'game') {
    const { kind, ...details } = reading;
    return { kind, ...details, source };
  }
  const { kind, ...details } = reading;
  return { kind, ...details, source };
}

/** The newest decision the template parser alone finds in these posts. Never calls Claude. */
function templateDecision(posts: Announcement[]): Decision | undefined {
  for (const source of posts) {
    const reading = readAnnouncement(source.content);
    if (reading.kind === 'game' || reading.kind === 'cancelled') return planFrom(reading, source);
  }
  return undefined;
}

/**
 * Whether two names are the same game, allowing extra words on either side:
 * "DRAWCERY Demo (PC only)" or "DRAWCERY" vs "DRAWCERY Demo".
 */
function sameGame(a: string, b: string): boolean {
  const [keyA, keyB] = [gameKey(a), gameKey(b)];
  return keyA !== '' && keyB !== '' && (keyA.includes(keyB) || keyB.includes(keyA));
}

/**
 * Gets the plan, asking again after each delay while it's "unsure" only because Claude couldn't
 * be reached. Used at game time, where a few minutes' delay beats a wrong or missed post.
 */
export async function planWithRetries(
  getPlan: () => Promise<Plan>,
  delaysMs: number[],
  sleep: (ms: number) => Promise<unknown>,
  onRetry: (delayMs: number) => void = () => {},
): Promise<Plan> {
  let plan = await getPlan();
  for (const delay of delaysMs) {
    if (plan.kind !== 'unsure' || !plan.retryable) break;
    onRetry(delay);
    await sleep(delay);
    plan = await getPlan();
  }
  return plan;
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
