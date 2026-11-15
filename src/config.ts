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
  /** Gemini reads announcements that don't follow the template; off when no API key is set. */
  gemini?: { apiKey: string; model: string };
}

/** Gemini 3.5 Flash-Lite: stable, cheapest current Flash-Lite, on the API's free tier. */
export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite';

export interface GameSuggestionsConfig {
  /** Forum channel where each post's title is a suggested game. */
  forumChannelId: string;
  /** IsThereAnyDeal API key; without it, replies skip deal info. */
  itadApiKey?: string;
}

export interface Config {
  token: string;
  /** Servers this instance registers commands in and responds to. */
  guildIds: string[];
  /** Weekly game-night reminder; disabled when its channels aren't set. */
  gameNight?: GameNightConfig;
  /** Game info replies in the suggestions forum; disabled when its channel isn't set. */
  gameSuggestions?: GameSuggestionsConfig;
}

type Env = Record<string, string | undefined>;
type ReadFile = (path: string) => string;

const defaultReadFile: ReadFile = (path) => readFileSync(path, 'utf8');

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Reads config from environment variables. See .env.example for the full list.
 */
export function loadConfig(env: Env = process.env, readFile: ReadFile = defaultReadFile): Config {
  return {
    token: loadToken(env, readFile),
    guildIds: parseGuildIds(env.GUILD_IDS),
    gameNight: parseGameNight(env, readFile),
    gameSuggestions: parseGameSuggestions(env, readFile),
  };
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

function parseGameNight(env: Env, readFile: ReadFile): GameNightConfig | undefined {
  const announcementsChannelId = optionalId(env, 'GAME_NIGHT_ANNOUNCEMENTS_CHANNEL_ID');
  const startChannelId = optionalId(env, 'GAME_NIGHT_CHANNEL_ID');
  if (!announcementsChannelId && !startChannelId) return undefined;
  if (!announcementsChannelId || !startChannelId) {
    throw new Error('Game night needs both GAME_NIGHT_ANNOUNCEMENTS_CHANNEL_ID and GAME_NIGHT_CHANNEL_ID (or neither).');
  }

  const schedule = env.GAME_NIGHT_SCHEDULE?.trim() || '30 10 * * 6';
  const timezone = env.GAME_NIGHT_TIMEZONE?.trim() || 'America/Los_Angeles';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new Error(`GAME_NIGHT_TIMEZONE "${timezone}" isn't a valid timezone (e.g. America/Los_Angeles).`);
  }
  try {
    new Cron(schedule, { timezone, paused: true });
  } catch (err) {
    throw new Error(`GAME_NIGHT_SCHEDULE "${schedule}" isn't a valid cron pattern: ${(err as Error).message}`);
  }

  const geminiApiKey = readSecret(env, 'GEMINI_API_KEY', readFile);
  const gemini = geminiApiKey
    ? { apiKey: geminiApiKey, model: env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL }
    : undefined;

  return { announcementsChannelId, startChannelId, schedule, timezone, ...(gemini && { gemini }) };
}

function parseGameSuggestions(env: Env, readFile: ReadFile): GameSuggestionsConfig | undefined {
  const forumChannelId = optionalId(env, 'GAME_SUGGESTIONS_CHANNEL_ID');
  if (!forumChannelId) return undefined;
  const itadApiKey = readSecret(env, 'ITAD_API_KEY', readFile);
  return { forumChannelId, ...(itadApiKey && { itadApiKey }) };
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
