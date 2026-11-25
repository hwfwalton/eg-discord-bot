import { readFileSync } from 'node:fs';
import { Cron } from 'croner';

export interface GameNightConfig {
  /** Channel holding the weekly announcement posts (the source of truth). */
  announcementsChannelId: string;
  /** Channel where the bot posts the @everyone "starting now" message. */
  startChannelId: string;
  /** Cron pattern for when sessions start, e.g. "30 10 * * 6" (Saturdays 10:30). */
  schedule: string;
  /** IANA timezone the schedule is in, e.g. "America/Los_Angeles". */
  timezone: string;
  /** Claude reads announcements that don't follow the template; off when no API key is set. */
  claude?: ClaudeConfig;
}

export interface ClaudeConfig {
  apiKey: string;
  model: string;
}

/** Claude Opus 5.5. */
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

export interface GameSuggestionsConfig {
  /** Forum channel where each post's title is a suggested game. */
  forumChannelId: string;
  /** IsThereAnyDeal API key; without it, replies skip deal info. */
  itadApiKey?: string;
  /** Claude researches player counts and mods from Steam/PCGamingWiki/web text; off without a key. */
  claude?: ClaudeConfig;
  /** Tavily web search key: adds web results to that research. */
  tavilyApiKey?: string;
}

export interface HistoryConfig {
  /** Folder holding the record: sessions.csv, games.csv and next.json. */
  dir: string;
}

export interface Config {
  token: string;
  /** Servers this instance registers commands in and responds to. */
  guildIds: string[];
  /** Weekly game-night reminder; disabled when its channels aren't set. */
  gameNight?: GameNightConfig;
  /** Game info replies in the suggestions forum; disabled when its channel isn't set. */
  gameSuggestions?: GameSuggestionsConfig;
  /** Session record the bot keeps for the history site; disabled when its folder isn't set. */
  history?: HistoryConfig;
}

type Env = Record<string, string | undefined>;
type ReadFile = (path: string) => string;

const defaultReadFile: ReadFile = (path) => readFileSync(path, 'utf8');

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Reads config from environment variables. See .env.example for the full list.
 */
export function loadConfig(env: Env = process.env, readFile: ReadFile = defaultReadFile): Config {
  const claude = parseClaude(env, readFile);
  return {
    token: loadToken(env, readFile),
    guildIds: parseGuildIds(env.GUILD_IDS),
    gameNight: parseGameNight(env, claude),
    gameSuggestions: parseGameSuggestions(env, readFile, claude),
    history: parseHistory(env),
  };
}

/** The Claude API key and model both features use; undefined (Claude off) without a key. */
export function parseClaude(env: Env, readFile: ReadFile = defaultReadFile): ClaudeConfig | undefined {
  const apiKey = readSecret(env, 'ANTHROPIC_API_KEY', readFile);
  if (!apiKey) return undefined;
  const model = env.CLAUDE_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
  // Catches aliases like "opus" and typos like "claude-opus-5.5" before the first request fails.
  if (!/^claude-[a-z0-9-]+$/.test(model)) {
    throw new Error(`CLAUDE_MODEL "${model}" isn't a Claude API model ID (e.g. ${DEFAULT_CLAUDE_MODEL}).`);
  }
  return { apiKey, model };
}

function loadToken(env: Env, readFile: ReadFile): string {
  const token = readSecret(env, 'DISCORD_TOKEN', readFile);
  if (!token) throw new Error('Missing bot token: set DISCORD_TOKEN or DISCORD_TOKEN_FILE.');
  return token;
}

/** Reads a secret from NAME, or from the file named by NAME_FILE. Undefined if neither is set. */
export function readSecret(env: Env, name: string, readFile: ReadFile = defaultReadFile): string | undefined {
  const direct = env[name]?.trim();
  if (direct) return direct;

  const file = env[`${name}_FILE`]?.trim();
  if (!file) return undefined;
  const fromFile = readFile(file).trim();
  if (!fromFile) throw new Error(`${name}_FILE points at an empty file: ${file}`);
  return fromFile;
}

function parseGuildIds(raw: string | undefined): string[] {
  const ids = (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    throw new Error('Missing GUILD_IDS: set it to a comma-separated list of server IDs.');
  }
  const invalid = ids.filter((id) => !SNOWFLAKE.test(id));
  if (invalid.length > 0) {
    throw new Error(`GUILD_IDS contains invalid server IDs: ${invalid.join(', ')}`);
  }
  return ids;
}

function parseGameNight(env: Env, claude: ClaudeConfig | undefined): GameNightConfig | undefined {
  const announcementsChannelId = optionalId(env, 'GAME_NIGHT_ANNOUNCEMENTS_CHANNEL_ID');
  const startChannelId = optionalId(env, 'GAME_NIGHT_CHANNEL_ID');
  if (!announcementsChannelId && !startChannelId) return undefined;
  if (!announcementsChannelId || !startChannelId) {
    throw new Error('Game night needs both GAME_NIGHT_ANNOUNCEMENTS_CHANNEL_ID and GAME_NIGHT_CHANNEL_ID (or neither).');
  }

  const schedule = env.GAME_NIGHT_SCHEDULE?.trim() || '30 10 * * 6';
  const timezone = parseTimezone(env);
  try {
    new Cron(schedule, { timezone, paused: true });
  } catch (err) {
    throw new Error(`GAME_NIGHT_SCHEDULE "${schedule}" isn't a valid cron pattern: ${(err as Error).message}`);
  }

  return { announcementsChannelId, startChannelId, schedule, timezone, ...(claude && { claude }) };
}

function parseGameSuggestions(env: Env, readFile: ReadFile, claude: ClaudeConfig | undefined): GameSuggestionsConfig | undefined {
  const forumChannelId = optionalId(env, 'GAME_SUGGESTIONS_CHANNEL_ID');
  if (!forumChannelId) return undefined;
  const itadApiKey = readSecret(env, 'ITAD_API_KEY', readFile);
  const tavilyApiKey = readSecret(env, 'TAVILY_API_KEY', readFile);
  return { forumChannelId, ...(itadApiKey && { itadApiKey }), ...(claude && { claude }), ...(tavilyApiKey && { tavilyApiKey }) };
}

/** The community's timezone: game night's schedule is in it, and so are the session record's dates. */
function parseTimezone(env: Env): string {
  const timezone = env.GAME_NIGHT_TIMEZONE?.trim() || 'America/Los_Angeles';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new Error(`GAME_NIGHT_TIMEZONE "${timezone}" isn't a valid timezone (e.g. America/Los_Angeles).`);
  }
  return timezone;
}

/** The session record; undefined (off) unless HISTORY_DIR is set. It also needs game night (see bot.ts). */
export function parseHistory(env: Env): HistoryConfig | undefined {
  const dir = env.HISTORY_DIR?.trim();
  return dir ? { dir } : undefined;
}

function optionalId(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  if (!value) return undefined;
  if (!SNOWFLAKE.test(value)) throw new Error(`${name} "${value}" isn't a valid Discord ID.`);
  return value;
}

/** A bot token's first segment is the bot's application ID, base64-encoded. */
export function applicationIdFromToken(token: string): string {
  const [first] = token.split('.');
  const id = Buffer.from(first ?? '', 'base64').toString('utf8');
  if (!SNOWFLAKE.test(id)) {
    throw new Error('Could not read an application ID from the bot token.');
  }
  return id;
}
