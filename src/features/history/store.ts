// The record on disk and the data the page shows.
//
// The record is two CSV files the owner can edit by hand (see record.ts). When a live source is given
// (the announcements channel and the game night schedule), the weeks since the record's last row are
// worked out from the announcements (live.ts) and appended to sessions.csv, so the record keeps
// itself up to date and stays complete even if those posts are edited or deleted later. Rows already
// in the file are never rewritten: to correct one, edit the file.
import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Cron } from 'croner';
import { log as defaultLog } from '../../log.ts';
import { type AnnouncementPost, type LiveSession, localDate, nextUp, sessionsSince, timezoneLabel } from './live.ts';
import { appendGames, appendSessions, parseGames, parseSessions } from './record.ts';
import { buildHistory } from './stats.ts';
import type { DataNote, GameInfo, HistoryData, NextSession, SessionRow } from './types.ts';

export const SESSIONS_FILE = 'sessions.csv';
export const GAMES_FILE = 'games.csv';

/** How far back an empty record starts when the bot fills it in from the announcements. */
const EMPTY_RECORD_LOOKBACK_DAYS = 60;
/** Posts are fetched from this long before the record's last row, to cover that week's announcement. */
const POSTS_MARGIN_DAYS = 8;
const DAY_MS = 24 * 3600_000;

/** Where newer sessions come from: the announcements channel and the game night schedule. */
export interface LiveSource {
  schedule: Cron;
  /** The channel's posts since `since`, or undefined while Discord isn't connected. */
  fetchPosts(since: Date): Promise<AnnouncementPost[] | undefined>;
}

export interface HistoryStoreOptions {
  /** Folder holding sessions.csv and games.csv. */
  dir: string;
  title: string;
  /** IANA timezone of the schedule: decides what "today" is and how start times read. */
  timezone: string;
  live?: LiveSource;
  /** How long computed data is reused before the files and Discord are looked at again. */
  maxAgeMs?: number;
  now?: () => Date;
  log?: Pick<typeof defaultLog, 'info' | 'warn'>;
}

export interface HistoryStore {
  getData(): Promise<HistoryData>;
  /** Forget what was computed, e.g. because a new announcement was posted. */
  invalidate(): void;
}

interface TextFile {
  path: string;
  /** '' when the file doesn't exist. */
  text: string;
  exists: boolean;
  /** Modification time and size when read, to notice an edit made since. */
  stamp: string;
}

export function createHistoryStore(options: HistoryStoreOptions): HistoryStore {
  const { dir, title, timezone, live } = options;
  const maxAgeMs = options.maxAgeMs ?? 30_000;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? defaultLog;

  let cached: { data: Promise<HistoryData>; at: number } | undefined;
  /** Loads run one at a time, so two of them can never append the same week. */
  let running: Promise<unknown> = Promise.resolve();
  /** So a folder that can't be written to is logged once, not on every page load. */
  let warnedAboutSaving = false;

  async function compute(): Promise<HistoryData> {
    const at = now();
    const notes: DataNote[] = [];
    const sessionsFile = await readText(join(dir, SESSIONS_FILE));
    const gamesFile = await readText(join(dir, GAMES_FILE));
    if (!sessionsFile.exists) {
      notes.push({ kind: 'info', text: `There is no ${SESSIONS_FILE} in the history folder yet.` });
    }
    const parsedSessions = parseSessions(sessionsFile.text);
    const parsedGames = parseGames(gamesFile.text);
    notes.push(...parsedSessions.notes, ...parsedGames.notes);

    let sessions = parsedSessions.rows;
    let games = parsedGames.rows;
    let next: NextSession | undefined;
    const today = localDate(at, timezone);
    // A row dated after today (a typo in the year, say) must not hold back the weeks before it.
    const future = sessions.filter((row) => row.date > today);
    if (future.length > 0) {
      notes.push({
        kind: 'warning',
        text: `${SESSIONS_FILE} has ${future.length === 1 ? 'a row' : `${future.length} rows`} dated after today (${future[0]?.date}). Check the year.`,
      });
    }
    const last = sessions.findLast((row) => row.date <= today);
    if (live) {
      try {
        const after = last?.date ?? localDate(new Date(at.getTime() - EMPTY_RECORD_LOOKBACK_DAYS * DAY_MS), timezone);
        const since = new Date(Date.parse(`${after}T00:00:00Z`) - POSTS_MARGIN_DAYS * DAY_MS);
        const posts = await live.fetchPosts(since);
        if (!posts) {
          notes.push({ kind: 'info', text: 'Not connected to Discord yet, so newer sessions have not been checked.' });
        } else {
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
          if (added.length > 0) {
            const newGames = newGameInfos(added, games);
            // While the file has rows that couldn't be read, one of them may be this very week: don't add to it.
            const readable = parsedSessions.notes.every((note) => note.kind !== 'warning') && future.length === 0;
            const saved = readable && (await save(sessionsFile, gamesFile, added, newGames));
            if (!saved) {
              notes.push({
                kind: 'warning',
                text: `${added.length === 1 ? '1 new session is' : `${added.length} new sessions are`} shown from the announcements but could not be saved to ${SESSIONS_FILE}. ${readable ? 'Check that the history folder and the files in it are writable.' : 'Fix the rows listed here first.'}`,
              });
            }
            sessions = [...sessions, ...added.map((a) => a.row)];
            games = [...games, ...newGames];
          }
          next = await nextUp({ posts, schedule: live.schedule, timezone, now: at, knownGames: knownGameNames(sessions, games) });
        }
      } catch (err) {
        log.warn('History: checking the announcements for newer sessions failed', err);
        notes.push({ kind: 'warning', text: 'Newer sessions could not be checked on Discord just now.' });
      }
    }

    return buildHistory({
      title,
      now: at,
      today,
      timezone: timezoneLabel(timezone, at),
      sessions,
      games,
      notes,
      ...(next && { next }),
    });
  }

  /**
   * Appends the new rows to the files. Only ever adds to the end, and not at all if a file changed
   * since it was read (the next load starts from the edited file instead).
   */
  async function save(sessionsFile: TextFile, gamesFile: TextFile, added: LiveSession[], newGames: GameInfo[]): Promise<boolean> {
    try {
      await mkdir(dir, { recursive: true });
      const withRows = appendSessions(sessionsFile.text, added.map((a) => a.row));
      // appendSessions leaves a file alone when rows couldn't be read back from it (no Date column, an unclosed quote).
      if (withRows === sessionsFile.text) throw new Error(`${SESSIONS_FILE} can't take new rows as it is (see the notes on the page)`);
      await appendTo(sessionsFile, withRows);
      if (newGames.length > 0) {
        // The sessions are saved by now, so a problem here only costs the new games their rows.
        await appendTo(gamesFile, appendGames(gamesFile.text, newGames)).catch((err: unknown) =>
          log.warn(`History: could not add ${newGames.map((g) => g.name).join(', ')} to ${GAMES_FILE}`, err),
        );
      }
      log.info(`History: added ${added.length} session(s) to ${SESSIONS_FILE}: ${added.map((a) => a.row.session ?? a.row.date).join(', ')}`);
      return true;
    } catch (err) {
      if (!warnedAboutSaving) log.warn(`History: could not save new sessions to ${join(dir, SESSIONS_FILE)} (is the folder writable?)`, err);
      warnedAboutSaving = true;
      return false;
    }
  }

  return {
    getData() {
      const at = now().getTime();
      if (!cached || at - cached.at >= maxAgeMs) {
        const data = running.then(compute);
        running = data.catch(() => {});
        cached = { data, at };
        // A failed load isn't kept: the next request tries again.
        data.catch(() => {
          if (cached?.data === data) cached = undefined;
        });
      }
      return cached.data;
    },
    invalidate() {
      cached = undefined;
    },
  };
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
  if (current.stamp !== file.stamp) throw new Error(`${file.path} changed while new rows were being added; trying again on the next load.`);
  await appendFile(file.path, addition, 'utf8');
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
