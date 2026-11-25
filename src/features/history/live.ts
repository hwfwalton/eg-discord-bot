// What the #announcements channel says happened after the record's last row, so the bot can add
// those weeks itself, plus what the next session will be. Pure functions over what's passed in:
// no Discord calls, and "now" is an argument.
//
// Posts are read with the template parser only, never Claude: the record has to come out the
// same every time, for free.
import type { Cron } from 'croner';
import { gameKey } from '../../gameName.ts';
import { readAnnouncement, steamLinkFor } from '../gameNight/announcement.ts';
import { type Announcement, type Plan, type Session, decidePlan, nextSession, sessionStartingAt } from '../gameNight/plan.ts';

type GamePlan = Extract<Plan, { kind: 'game' }>;
import { AUTO_SOURCE, type NextSession, type SessionRow } from './types.ts';

export interface AnnouncementPost extends Announcement {
  authorName: string;
}

export interface LiveOptions {
  /** Recent posts of the announcements channel, in any order. */
  posts: AnnouncementPost[];
  /** From createSchedule(pattern, timezone) in plan.ts. */
  schedule: Cron;
  /** IANA name, e.g. "America/Los_Angeles". */
  timezone: string;
  /** YYYY-MM-DD: date of the record's last row; only later sessions are returned. "" for an empty record. */
  after: string;
  now: Date;
  /** Game names already in the record, in their canonical spelling. */
  knownGames: string[];
}

export interface LiveSession {
  row: SessionRow;
  /** Store link from the post, set only when the row has exactly one game and that game is new to the record. */
  link?: string;
  /** Games in the row that were not in knownGames (or earlier rows of this same result). */
  newGames: string[];
}

/** Five years of weeks: the most one call looks at, so a very old record can't keep it busy for long. */
const MAX_SESSIONS = 260;

/**
 * One row for each scheduled session after `after` that has started and was announced or called
 * off, oldest first. Weeks nobody posted about get no row. A record more than MAX_SESSIONS
 * posted-in weeks behind gets the oldest of them; call again with the new last date for the rest.
 */
export async function sessionsSince(options: LiveOptions): Promise<LiveSession[]> {
  const { schedule, timezone, after, now } = options;
  const posts = newestFirst(options.posts);
  const authors = new Map(posts.map((post) => [post.id, post.authorName]));
  // Grows as rows are made, so a new game played two weeks running is new (and spelled) once.
  const known = [...options.knownGames];
  const sessions: LiveSession[] = [];

  for (const startsAt of startsSince(posts, schedule, timezone, after, now)) {
    const session = sessionStartingAt(schedule, startsAt);
    let plan = await decidePlan(posts, session);
    if (plan.kind !== 'game' && plan.kind !== 'cancelled') continue;

    // A later post only calls the week off if it says "cancel": "no game purchase needed" in a
    // reminder must not turn an announced session into a week off for good.
    const announced = plan.kind === 'cancelled' ? announcedBefore(posts, session, plan.source) : undefined;
    if (plan.kind === 'cancelled' && announced && !/cancel/i.test(plan.phrase)) plan = announced;

    const date = localDate(startsAt, timezone);
    const announcedBy = authors.get(plan.source.id);
    if (plan.kind === 'cancelled') {
      const status = /cancel/i.test(plan.phrase) ? 'Cancelled' : 'No session';
      // What had been announced stays on the row, so a wrong "cancelled" is one edit to put right.
      const planned = announced ? resolveGames(announced.game, known).games : [];
      sessions.push({
        row: { date, status, games: [], planned, ...(announcedBy && { announcedBy }), source: AUTO_SOURCE },
        newGames: [],
      });
      continue;
    }

    const { games, demo } = resolveGames(plan.game, known);
    const newGames = games.filter((game) => !known.includes(game));
    known.push(...newGames);
    const cost = costFromPost(plan.source.content, demo);
    const link = games.length === 1 && newGames.length === 1 ? storeLink(plan.source.content, plan.game) : undefined;
    sessions.push({
      row: {
        ...(plan.label && { session: plan.label }),
        date,
        start: localStart(startsAt, timezone),
        status: 'Played',
        games,
        planned: [],
        ...(cost && { cost }),
        ...(announcedBy && { announcedBy }),
        source: AUTO_SOURCE,
        ...(demo && { notes: 'Demo' }),
      },
      ...(link && { link }),
      newGames,
    });
  }
  return sessions;
}

/** The newest template announcement of a game in the session's window that is older than `than`. */
function announcedBefore(posts: AnnouncementPost[], session: Session, than: Announcement): GamePlan | undefined {
  const earlier = posts
    .filter((p) => p.createdAt > session.windowStart && p.createdAt < than.createdAt)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const source of earlier) {
    const reading = readAnnouncement(source.content);
    if (reading.kind === 'game') return { ...reading, source };
    if (reading.kind === 'cancelled') return undefined;
  }
  return undefined;
}

/** The next session after `now` and what has been announced for it. Undefined if the schedule has ended. */
export async function nextUp(options: Omit<LiveOptions, 'after'>): Promise<NextSession | undefined> {
  const { schedule, timezone, now, knownGames } = options;
  const posts = newestFirst(options.posts);
  if (!schedule.nextRun(now)) return undefined; // nextSession would throw
  const session = nextSession(schedule, now);
  const plan = await decidePlan(posts, session);
  const when = { date: localDate(session.startsAt, timezone), start: localStart(session.startsAt, timezone) };

  if (plan.kind === 'game') {
    const { games } = resolveGames(plan.game, knownGames);
    return { ...when, status: 'announced', ...(plan.label && { session: plan.label }), games };
  }
  return { ...when, status: plan.kind === 'cancelled' ? 'cancelled' : 'unannounced', games: [] };
}

/**
 * The posts as decidePlan reads them, newest first. It leaves posts of the same millisecond in
 * the order it got them, so here the higher message ID (the later post) goes first: the result
 * can't depend on the order the posts were given in. A post with no usable time is dropped.
 */
function newestFirst(posts: AnnouncementPost[]): AnnouncementPost[] {
  return posts
    .filter((post) => !Number.isNaN(post.createdAt.getTime()))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || compareIds(b.id, a.id));
}

/** Discord IDs are whole numbers too big for a JS number: the longer one is higher, then digit by digit. */
function compareIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * The schedule's start times that could get a row, oldest first: on a later local date than
 * `after`, up to `now`, and with a post written for them (the first start at or after a post is
 * the one it's for). Weeks nobody posted in are stepped over, so a long silence can't use up the
 * cap and leave the record stuck behind it. Each start is asked from the schedule, so it keeps
 * its local time across daylight-saving changes.
 */
function startsSince(posts: Announcement[], schedule: Cron, timezone: string, after: string, now: Date): Date[] {
  const earliest = earliestStart(after);
  if (earliest === undefined) return [];
  // A post from before `earliest` can only matter to the first start after `earliest`.
  const times = posts.map((post) => Math.max(post.createdAt.getTime(), earliest)).sort((a, b) => a - b);

  const starts: Date[] = [];
  let covered = -Infinity; // posts up to here are for a start that's already been found
  for (const time of times) {
    if (starts.length >= MAX_SESSIONS) break;
    if (time <= covered) continue;
    const start = startAtOrAfter(schedule, time);
    // The posts are in order, so the rest are for later starts still. Written as "not <=" so
    // that a `now` that isn't a date stops here too.
    if (!start || !(start <= now)) break;
    covered = start.getTime();
    if (localDate(start, timezone) > after) starts.push(start);
  }
  return starts;
}

/**
 * A time no start on a later local date than `after` comes before: that day's 00:00 UTC, when
 * the next local day hasn't begun anywhere yet. -Infinity for "" (an empty record). Undefined for
 * an `after` that isn't a date, where guessing could add weeks the record already has.
 */
function earliestStart(after: string): number | undefined {
  if (after === '') return -Infinity;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(after) ? Date.parse(`${after}T00:00:00Z`) : Number.NaN;
  return Number.isNaN(day) ? undefined : day;
}

/** The first start at or after a moment. nextRun looks strictly after its reference, in whole seconds. */
function startAtOrAfter(schedule: Cron, time: number): Date | null {
  const start = schedule.nextRun(new Date(time - 1000));
  return start && start.getTime() < time ? schedule.nextRun(start) : start;
}

/** The post's Steam store page for the game, in the short form the record uses. */
function storeLink(content: string, game: string): string | undefined {
  const appId = steamLinkFor(content, game)?.match(/\/app\/(\d+)/)?.[1];
  return appId ? `https://store.steampowered.com/app/${appId}/` : undefined;
}

// "Plucked Demo", "Ultimate Sheep Raccoon (demo)", "Fishards - Demo": only at the end of a name.
const DEMO_MARKER = /(?:\s*[:,]\s*|\s+[-–—]\s*|\s+)(?:demos?|\(demos?\)|\[demos?\])[!.]*\s*$/i;
// "ROUNDS (but now with more mods)"
const TRAILING_NOTE = /\s*\([^()]*\)$/;
// " and ", " & ", ",", ";" and "+" between games; ", and " is one separator. Captured, so that
// split() keeps the separators and parts can be put back together as they were written.
const LIST_SEPARATOR = /(\s*[,;]\s*(?:(?:and|&)\s+)?|\s+(?:and|&)\s+|\s*\+\s*)/i;
// The most parts of a list that are tried as one game's name ("Rock, Paper, Scissors" is three).
const MAX_PARTS_IN_NAME = 6;

type Known = Map<string, string>;
type Found = { game: string; demo: boolean };

/**
 * Turns an announced name into the record's games: the known spelling of each ("Witch It" ->
 * "Witch It!"), whether it was a demo, and a list ("Elevator and Frog Sqwad") as separate games.
 * A name that matches nothing is one new game, kept as announced (but for any ";", see storable).
 */
export function resolveGames(announced: string, knownGames: string[]): { games: string[]; demo: boolean } {
  // Names with no key (no Latin letters or digits) can't be compared, so they never match.
  const known: Known = new Map();
  for (const game of knownGames) {
    const key = matchKey(game);
    if (key !== '' && !known.has(key)) known.set(key, storable(game));
  }

  const { name, demo } = withoutDemo(announced.trim());
  if (name === '') return { games: [], demo: false };
  const whole = findKnown(name, known);
  if (whole) return { games: [whole.game], demo: demo || whole.demo };

  // A list only if every part is a game the record already has, so a name with "and" or "&" in
  // it ("Heal & Hurt") is never cut up, known or not.
  const list = knownList(name, known);
  if (list) return { games: [...new Set(list.map((part) => part.game))], demo: demo || list.some((part) => part.demo) };
  return { games: [storable(name)], demo };
}

/** The record keeps a session's games in one cell with ";" between them, so a name can't have one. */
function storable(name: string): string {
  return name.replace(/;/g, ',');
}

/**
 * What two names share when they are the same game: gameKey, with "&" read as "and", plus the
 * name's letters in other scripts. gameKey only sees Latin letters and digits, so on its own
 * "原神 2" and "崩坏 2" (both "2") would be one game. "" for a name gameKey has no key for.
 */
function matchKey(name: string): string {
  const key = gameKey(name.replace(/&/g, ' and '));
  if (key === '') return '';
  // Each letter with its marks: an accent on a Latin letter is ignored, as gameKey does, but in
  // other scripts a mark can make a different letter (か and が).
  const letters = name.normalize('NFKD').toLowerCase().match(/[\p{L}\p{N}]\p{M}*/gu) ?? [];
  return `${key} ${letters.filter((letter) => !/^[a-z0-9]/.test(letter)).join('')}`;
}

/**
 * A name read as a list of known games ("Elevator and Frog Sqwad"), or undefined if some part of
 * it isn't one. A known game can have a separator in its own name ("Heal & Hurt and Elevator"),
 * so neighbouring parts are also tried together, and the reading with the fewest games wins.
 */
function knownList(name: string, known: Known): Found[] | undefined {
  const pieces = name.split(LIST_SEPARATOR); // part, separator, part, …
  const parts = (pieces.length + 1) / 2;
  if (parts < 2) return undefined;
  // fewest[i] is the best reading of the parts from i on. Filled from the end, each from the few
  // after it, so a very long list isn't tried every way it could be cut.
  const fewest: (Found[] | undefined)[] = [];
  fewest[parts] = [];
  for (let from = parts - 1; from >= 0; from--) {
    for (let to = Math.min(parts, from + MAX_PARTS_IN_NAME); to > from; to--) {
      const rest = fewest[to];
      if (!rest || (fewest[from]?.length ?? Infinity) <= rest.length + 1) continue;
      const found = findKnown(pieces.slice(2 * from, 2 * to - 1).join('').trim(), known);
      if (found) fewest[from] = [found, ...rest];
    }
  }
  return fewest[0];
}

function withoutDemo(text: string): { name: string; demo: boolean } {
  const marker = text.match(DEMO_MARKER);
  const name = marker ? text.slice(0, marker.index).trim() : '';
  // A game called just "Demo" keeps its name.
  return name ? { name, demo: true } : { name: text, demo: false };
}

/** The known game a name means: as written, or without a demo marker or a trailing "(note)". */
function findKnown(text: string, known: Known): Found | undefined {
  const { name, demo } = withoutDemo(text);
  const game = known.get(matchKey(name));
  if (game !== undefined) return { game, demo };

  const shorter = name.replace(TRAILING_NOTE, '');
  if (shorter === name || shorter === '') return undefined;
  const found = findKnown(shorter, known);
  return found && { game: found.game, demo: demo || found.demo };
}

/**
 * A best-effort reading of what the post says the game costs, in the record's wording ("Free",
 * "Free (demo)", "$4.99", "Host gave out keys"). Undefined when the post doesn't say.
 */
export function costFromPost(content: string, demo: boolean): string | undefined {
  // Struck-through text is an old price, and "feel free to ask" isn't about the price.
  const t = content
    .replace(/~~[^~]*~~/g, '')
    .replace(/non-free|feel free|free to (hop|join|ping|reach|use|ask|mention|bring|request|spectate)/gi, '');
  const price = t.match(/\$(\d+(?:\.\d{2})?)/)?.[0];
  const keys =
    /(message|dm|ping)\b[^.!\n]{0,40}if you don.?t already (own|have)|(message|dm|ping)\b[^.!\n]{0,60}\b(copy|copies|key)|giftable|steam keys?\b|extra (copies|keys)|4-packs?/i.test(
      t,
    );
  if (demo || /\bdemos? (is|are) (both )?free|demo for free|download the [^.!\n]*demo for free/i.test(t)) return 'Free (demo)';
  if (/free[- ]to[- ]keep/i.test(t)) return 'Free to keep (that week)';
  if (/free (for|this) (the )?weekend|free-to-play until|currently free on steam \(sale/i.test(t)) return 'Free (that weekend)';
  if (/friend'?s? ?pass/i.test(t)) return "Free (Friend's Pass)";
  if (/free pass/i.test(t)) return 'Free (Free Pass)';
  if (/screensharing|screen-sharing/i.test(t)) return 'Free (screen-shared)';
  if (/free on (android|ios)/i.test(t)) return `Free on mobile${price ? `, ${price} on Steam` : ''}`;
  if (/\bfree\b/i.test(t)) return 'Free';
  if (price) return keys ? `${price} (host had spare keys)` : price;
  if (keys) return 'Host gave out keys';
  return undefined;
}

/** The calendar date and clock time of a moment in a timezone. Throws for a timezone Intl doesn't know. */
function wallClock(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: part('year').padStart(4, '0'),
    month: part('month'),
    day: part('day'),
    hour: Number(part('hour')) % 24,
    minute: Number(part('minute')),
  };
}

/** YYYY-MM-DD in that timezone. */
export function localDate(at: Date, timezone: string): string {
  const { year, month, day } = wallClock(at, timezone);
  return `${year}-${month}-${day}`;
}

/** The time of day in that timezone, as the record writes it: "10:30am", "11am", "6pm". */
export function localStart(at: Date, timezone: string): string {
  const { hour, minute } = wallClock(at, timezone);
  const minutes = minute === 0 ? '' : `:${String(minute).padStart(2, '0')}`;
  return `${hour % 12 || 12}${minutes}${hour < 12 ? 'am' : 'pm'}`;
}

/**
 * A short name for the timezone: "PT" for America/Los_Angeles. Zones with no year-round
 * abbreviation get their short name at that moment ("GMT+1", "UTC"). Undefined if Intl can't say.
 */
export function timezoneLabel(timezone: string, at: Date): string | undefined {
  const name = (style: 'shortGeneric' | 'short') =>
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: style })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value;
  try {
    // Outside North America the generic name is spelled out ("Germany Time"), which isn't short.
    const generic = name('shortGeneric');
    return generic && /^[A-Z]{2,5}$/.test(generic) ? generic : name('short');
  } catch {
    return undefined; // not a timezone Intl knows
  }
}
