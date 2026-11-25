// Shared types for the session record: the two CSV files (record.ts) and next.json, which the bot
// writes and the history site (a separate repo) reads.

/** What happened in one scheduled week. */
export type SessionStatus = 'Played' | 'Cancelled' | 'No session' | 'Special';

export const SESSION_STATUSES: readonly SessionStatus[] = ['Played', 'Cancelled', 'No session', 'Special'];

/**
 * One row of sessions.csv: one scheduled week (or an extra session).
 *
 * Columns: Session, Date, Start, Status, Games, Planned, Cost, Announced by, Source, Notes.
 */
export interface SessionRow {
  /** The session's name as announced, e.g. "EG289". Missing for off weeks and unnumbered sessions. */
  session?: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  /** Start time as free text, e.g. "10:30am". */
  start?: string;
  status: SessionStatus;
  /** Games actually played (";"-separated in the file). Empty when unknown or nothing was played. */
  games: string[];
  /** What was announced, when something else (or nothing) ended up being played. */
  planned: string[];
  /** What the game cost at the time, as free text: "Free", "Free (demo)", "$2.99", "Host gave out keys". */
  cost?: string;
  announcedBy?: string;
  /** Where the row came from, e.g. "#announcements" or "Announcement (auto)". */
  source?: string;
  notes?: string;
}

/** `source` of rows the bot added itself from an announcement (nobody has checked them). */
export const AUTO_SOURCE = 'Announcement (auto)';

/**
 * One row of games.csv: what kind of game it is. Optional: a game with no row is "Uncategorized".
 *
 * Columns: Game, Style, Mode, Where, Link, Tags, Developer.
 */
export interface GameInfo {
  name: string;
  /** The owner's own genre label, e.g. "Social deduction". */
  style?: string;
  /** "Competitive", "Co-op", "Mixed" or "Party". */
  mode?: string;
  /** "Steam", "Browser", "Discord", … */
  where?: string;
  /** Store or home page. Only http(s) links are kept. */
  link?: string;
  /** Store tags, most relevant first (","-separated in the file). */
  tags: string[];
  developer?: string;
}

/** A problem found while reading a file. */
export interface DataNote {
  kind: 'warning' | 'info';
  text: string;
}

export interface NextSession {
  /** YYYY-MM-DD in the schedule's timezone. */
  date: string;
  start: string;
  status: 'announced' | 'cancelled' | 'unannounced';
  session?: string;
  games: string[];
}

/** What next.json holds: the upcoming session, and when the bot worked it out (ISO 8601). */
export interface NextFile extends NextSession {
  updatedAt: string;
}
