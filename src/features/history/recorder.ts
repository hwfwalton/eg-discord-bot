// Keeps the session record on disk up to date. The record is two CSV files the owner can edit by
// hand (see record.ts): the weeks since its last row are worked out from the announcements
// (live.ts) and appended to sessions.csv, so it stays complete even if those posts are edited or
// deleted later. Rows already in the file are never rewritten: to correct one, edit the file.
// It also writes next.json, the upcoming session, for the history site (a separate repo) to show.
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Cron } from 'croner';
import { log as defaultLog } from '../../log.ts';
import { type AnnouncementPost, type LiveSession, localDate, nextUp, sessionsSince } from './live.ts';
import { appendGames, appendSessions, parseGames, parseSessions } from './record.ts';
import type { GameInfo, NextFile, SessionRow } from './types.ts';

export const SESSIONS_FILE = 'sessions.csv';
export const GAMES_FILE = 'games.csv';
export const NEXT_FILE = 'next.json';

/** How far back an empty record starts when the bot fills it in from the announcements. */
const EMPTY_RECORD_LOOKBACK_DAYS = 60;
/** Posts are fetched from this long before the record's last row, to cover that week's announcement. */
const POSTS_MARGIN_DAYS = 8;
/**
 * next.json is refreshed when it is older than this, even if nothing seems to have changed: a
 * safety net for announcement edits the bot missed while it was disconnected.
 */
export const NEXT_MAX_AGE_MS = 6 * 3600_000;
const DAY_MS = 24 * 3600_000;

/** Where newer sessions come from: the announcements channel and the game night schedule. */
export interface LiveSource {
  schedule: Cron;
  /** The channel's posts since `since`, or undefined while Discord isn't connected. */
  fetchPosts(since: Date): Promise<AnnouncementPost[] | undefined>;
}

export interface RecorderOptions {
  /** Folder holding sessions.csv, games.csv and next.json. */
  dir: string;
  /** IANA timezone of the schedule: decides what "today" is and how start times read. */
  timezone: string;
  live: LiveSource;
  now?: () => Date;
  log?: Pick<typeof defaultLog, 'info' | 'warn'>;
}

/** What one run did, for the logs and the tests. */
export interface RecordResult {
  /** False when Discord wasn't connected yet or reading the announcements failed: nothing changed. */
  checked: boolean;
  /** Rows appended to sessions.csv. */
  added: SessionRow[];
  /** Rows appended to games.csv. */
  addedGames: GameInfo[];
  /** New weeks that were found but not saved (rows to fix in the file first, or it isn't writable). */
  unsaved: SessionRow[];
  /** What was written to next.json; undefined when it wasn't written. */
  next?: NextFile;
}

export interface Recorder {
  /** Adds the weeks since the record's last row and rewrites next.json. Runs one at a time. */
  run(): Promise<RecordResult>;
  /** Whether a run could change anything now (see isDue). Reads the folder, never Discord. */
  due(): Promise<boolean>;
}

interface TextFile {
  path: string;
  /** '' when the file doesn't exist. */
  text: string;
  exists: boolean;
  /** Modification time and size when read, to notice an edit made since. */
  stamp: string;
}

export function createRecorder(options: RecorderOptions): Recorder {
  const { dir, timezone, live } = options;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? defaultLog;
  const sessionsPath = join(dir, SESSIONS_FILE);
  const gamesPath = join(dir, GAMES_FILE);

  /** Runs go one after another, so two of them can never append the same week. */
  let running: Promise<unknown> = Promise.resolve();
  /** So a folder that can't be written to is logged once, not on every run. */
  let warnedAboutSaving = false;
  let warnedAboutNext = false;
  /** The last "fix these rows first" warning, so it isn't repeated while the file stays the same. */
  let lastHoldWarning: string | undefined;
  /** When Discord was last read, and sessions.csv as it was then. */
  let lastCheck: { at: Date; stamp: string } | undefined;

  async function record(): Promise<RecordResult> {
    const at = now();
    const result: RecordResult = { checked: false, added: [], addedGames: [], unsaved: [] };
    const sessionsFile = await readText(sessionsPath);
    const gamesFile = await readText(gamesPath);
    const parsedSessions = parseSessions(sessionsFile.text);
    const parsedGames = parseGames(gamesFile.text);

    const sessions = parsedSessions.rows;
    const games = parsedGames.rows;
    const today = localDate(at, timezone);
    // A row dated after today (a typo in the year, say) must not hold back the weeks before it.
    const future = sessions.filter((row) => row.date > today);
    const last = sessions.findLast((row) => row.date <= today);

    let posts: AnnouncementPost[] | undefined;
    const after = last?.date ?? localDate(new Date(at.getTime() - EMPTY_RECORD_LOOKBACK_DAYS * DAY_MS), timezone);
    try {
      const since = new Date(Date.parse(`${after}T00:00:00Z`) - POSTS_MARGIN_DAYS * DAY_MS);
      posts = await live.fetchPosts(since);
    } catch (err) {
      log.warn('Session record: checking the announcements for newer sessions failed', err);
      return result;
    }
    if (!posts) return result; // not connected to Discord yet
    result.checked = true;

    const found = await sessionsSince({
      posts,
      schedule: live.schedule,
      timezone,
      after,
      now: at,
      knownGames: knownGameNames(sessions, games),
    });
    // If the schedule's day was changed, the last recorded session can turn up again under the new day.
    const added = found.filter((a) => !a.row.session || a.row.session !== last?.session);
    for (const { row } of added) row.announcedBy = plainText(row.announcedBy);
    const newGames = newGameInfos(added, games);
    if (added.length > 0) {
      // While the file has rows that couldn't be read, one of them may be this very week: don't add to it.
      const problems = parsedSessions.notes.filter((note) => note.kind === 'warning').map((note) => note.text);
      if (future.length > 0) {
        problems.push(`${future.length === 1 ? 'A row is' : `${future.length} rows are`} dated after today (${future.map((row) => row.date).join(', ')}): check the year.`);
      }
      if (problems.length > 0) {
        const warning = `Session record: not adding ${describe(added)} to ${sessionsPath} until these rows are fixed: ${problems.join(' ')}`;
        if (warning !== lastHoldWarning) log.warn(warning);
        lastHoldWarning = warning;
        result.unsaved = added.map((a) => a.row);
      } else {
        lastHoldWarning = undefined;
        const saved = await save(sessionsFile, gamesFile, added, newGames);
        if (saved) {
          result.added = added.map((a) => a.row);
          result.addedGames = saved.games;
        } else {
          result.unsaved = added.map((a) => a.row);
        }
      }
    }

    // Games of weeks that couldn't be saved still get the record's spelling in next.json.
    const allSessions = [...sessions, ...added.map((a) => a.row)];
    const next = await nextUp({ posts, schedule: live.schedule, timezone, now: at, knownGames: knownGameNames(allSessions, [...games, ...newGames]) });
    if (next) {
      const file: NextFile = { updatedAt: at.toISOString(), ...next };
      if (await writeNext(file)) result.next = file;
    }
    // The stamp as read, unless this run appended to the file: so an edit made meanwhile (one that
    // stopped the append, say) makes the next hourly check look again.
    const stamp = result.added.length > 0 ? (await readText(sessionsPath).catch(() => sessionsFile)).stamp : sessionsFile.stamp;
    lastCheck = { at, stamp };
    return result;
  }

  /**
   * Appends the new rows to the files. Only ever adds to the end, and not at all if a file changed
   * since it was read (the next run starts from the edited file instead).
   */
  async function save(sessionsFile: TextFile, gamesFile: TextFile, added: LiveSession[], newGames: GameInfo[]): Promise<{ games: GameInfo[] } | undefined> {
    try {
      await mkdir(dir, { recursive: true });
      const withRows = appendSessions(sessionsFile.text, added.map((a) => a.row));
      // appendSessions leaves a file alone when rows couldn't be read back from it (no Date column, an unclosed quote).
      if (withRows === sessionsFile.text) throw new Error(`${SESSIONS_FILE} can't take new rows as it is`);
      await appendTo(sessionsFile, withRows);
      let games: GameInfo[] = [];
      if (newGames.length > 0) {
        // The sessions are saved by now, so a problem here only costs the new games their rows.
        games = await appendTo(gamesFile, appendGames(gamesFile.text, newGames)).then(
          () => newGames,
          (err: unknown) => {
            log.warn(`Session record: could not add ${newGames.map((g) => g.name).join(', ')} to ${GAMES_FILE}`, err);
            return [];
          },
        );
      }
      log.info(`Session record: added ${describe(added)} to ${SESSIONS_FILE}`);
      return { games };
    } catch (err) {
      if (!warnedAboutSaving) log.warn(`Session record: could not save new sessions to ${sessionsPath} (is the folder writable?)`, err);
      warnedAboutSaving = true;
      return undefined;
    }
  }

  /** Replaces next.json in one step (a temp file renamed over it), so a reader never sees half a file. */
  async function writeNext(file: NextFile): Promise<boolean> {
    const path = join(dir, NEXT_FILE);
    const temp = join(dir, `.${NEXT_FILE}.${process.pid}.tmp`);
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
      await rename(temp, path);
      warnedAboutNext = false;
      return true;
    } catch (err) {
      await rm(temp, { force: true }).catch(() => {});
      if (!warnedAboutNext) log.warn(`Session record: could not write ${path}`, err);
      warnedAboutNext = true;
      return false;
    }
  }

  return {
    run() {
      const result = running.then(record);
      running = result.catch(() => {});
      return result;
    },
    async due() {
      const sessionsFile = await readText(sessionsPath);
      const next = await stat(join(dir, NEXT_FILE)).catch(() => undefined);
      const at = now();
      const today = localDate(at, timezone);
      const lastDate = parseSessions(sessionsFile.text).rows.findLast((row) => row.date <= today)?.date ?? '';
      return isDue({
        now: at,
        schedule: live.schedule,
        timezone,
        lastDate,
        stamp: sessionsFile.stamp,
        ...(lastCheck && { lastCheck }),
        ...(next && { nextWrittenAt: next.mtime }),
      });
    },
  };
}

export interface DueState {
  now: Date;
  schedule: Cron;
  timezone: string;
  /** Date of the record's last row up to today; "" for an empty record. */
  lastDate: string;
  /** sessions.csv's stamp now. */
  stamp: string;
  /** When Discord was last read, and sessions.csv's stamp then. Missing before the first run. */
  lastCheck?: { at: Date; stamp: string };
  /** When next.json was last written. Missing when there is none. */
  nextWrittenAt?: Date;
}

/**
 * Whether a run is worth a Discord call: next.json is missing or old, or a scheduled session has
 * started that the record has no row for. That last one only counts if it started after the last
 * look (a week nobody posted in gets no row, and looking every hour won't change that) or the file
 * was edited since (the owner fixed a row that held new weeks back).
 */
export function isDue(state: DueState): boolean {
  const { now, schedule, timezone, lastDate, stamp, lastCheck, nextWrittenAt } = state;
  if (!nextWrittenAt || now.getTime() - nextWrittenAt.getTime() >= NEXT_MAX_AGE_MS) return true;
  const [latestStart] = schedule.previousRuns(1, new Date(now.getTime() + 1));
  if (!latestStart || localDate(latestStart, timezone) <= lastDate) return false;
  return !lastCheck || latestStart > lastCheck.at || stamp !== lastCheck.stamp;
}

async function readText(path: string): Promise<TextFile> {
  try {
    const [text, info] = [await readFile(path, 'utf8'), await stat(path)];
    return { path, text, exists: true, stamp: `${info.mtimeMs}:${info.size}` };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return { path, text: '', exists: false, stamp: '' };
  }
}

/** Writes what `next` adds to the end of the file (`next` always starts with the file's own text). */
async function appendTo(file: TextFile, next: string): Promise<void> {
  if (!next.startsWith(file.text)) throw new Error(`Refusing to rewrite ${file.path}: new rows must only be added at the end.`);
  const addition = next.slice(file.text.length);
  if (!addition) return;
  const current = await readText(file.path);
  if (current.stamp !== file.stamp) throw new Error(`${file.path} changed while new rows were being added; trying again on the next run.`);
  await appendFile(file.path, addition, 'utf8');
}

/** "2 sessions (EG3, 2031-01-25)" */
function describe(added: LiveSession[]): string {
  const names = added.map((a) => a.row.session ?? a.row.date).join(', ');
  return `${added.length === 1 ? '1 session' : `${added.length} sessions`} (${names})`;
}

/**
 * A Discord display name as it goes into the file: without a leading = + - or @, which a
 * spreadsheet app would run as a formula when the owner opens the CSV.
 */
function plainText(text: string | undefined): string | undefined {
  return text?.replace(/^[\s=+\-@]+/, '') || undefined;
}

/** Every game name the record knows, in the spelling to keep using. */
function knownGameNames(sessions: SessionRow[], games: GameInfo[]): string[] {
  const names = new Set(games.map((g) => g.name));
  for (const row of sessions) for (const game of row.games) names.add(game);
  return [...names];
}

/** games.csv rows for games that first appear in the added sessions. */
function newGameInfos(added: LiveSession[], games: GameInfo[]): GameInfo[] {
  const listed = new Set(games.map((g) => g.name.trim().toLowerCase()));
  const infos: GameInfo[] = [];
  for (const { newGames, link } of added) {
    for (const name of newGames) {
      if (listed.has(name.trim().toLowerCase())) continue;
      listed.add(name.trim().toLowerCase());
      infos.push({ name, tags: [], ...(link && newGames.length === 1 && { where: 'Steam', link }) });
    }
  }
  return infos;
}
