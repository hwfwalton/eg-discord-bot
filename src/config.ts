import { readFileSync } from 'node:fs';

export interface Config {
  token: string;
  /** Servers this instance registers commands in and responds to. */
  guildIds: string[];
}

type Env = Record<string, string | undefined>;
type ReadFile = (path: string) => string;

const defaultReadFile: ReadFile = (path) => readFileSync(path, 'utf8');

/**
 * Reads config from environment variables:
 * - DISCORD_TOKEN, or DISCORD_TOKEN_FILE pointing at a file containing the token
 * - GUILD_IDS: comma-separated server IDs
 */
export function loadConfig(env: Env = process.env, readFile: ReadFile = defaultReadFile): Config {
  return {
    token: loadToken(env, readFile),
    guildIds: parseGuildIds(env.GUILD_IDS),
  };
}

function loadToken(env: Env, readFile: ReadFile): string {
  const direct = env.DISCORD_TOKEN?.trim();
  if (direct) return direct;

  const file = env.DISCORD_TOKEN_FILE?.trim();
  if (!file) {
    throw new Error('Missing bot token: set DISCORD_TOKEN or DISCORD_TOKEN_FILE.');
  }
  const fromFile = readFile(file).trim();
  if (!fromFile) {
    throw new Error(`Token file ${file} is empty.`);
  }
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
  const invalid = ids.filter((id) => !/^\d{17,20}$/.test(id));
  if (invalid.length > 0) {
    throw new Error(`GUILD_IDS contains invalid server IDs: ${invalid.join(', ')}`);
  }
  return ids;
}

/** A bot token's first segment is the bot's application ID, base64-encoded. */
export function applicationIdFromToken(token: string): string {
  const [first] = token.split('.');
  const id = Buffer.from(first ?? '', 'base64').toString('utf8');
  if (!/^\d{17,20}$/.test(id)) {
    throw new Error('Could not read an application ID from the bot token.');
  }
  return id;
}
