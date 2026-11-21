import { describe, expect, it } from 'vitest';
import { applicationIdFromToken, loadConfig } from './config.ts';

const GUILD = '123456789012345678';
const noFile = () => {
  throw new Error('should not read a file');
};

describe('loadConfig', () => {
  it('prefers DISCORD_TOKEN over the token file', () => {
    const config = loadConfig({ DISCORD_TOKEN: ' abc ', DISCORD_TOKEN_FILE: '/x', GUILD_IDS: GUILD }, noFile);
    expect(config.token).toBe('abc');
  });

  it('reads and trims the token from DISCORD_TOKEN_FILE', () => {
    const config = loadConfig({ DISCORD_TOKEN_FILE: '/secret', GUILD_IDS: GUILD }, (path) => {
      expect(path).toBe('/secret');
      return 'from-file\n';
    });
    expect(config.token).toBe('from-file');
  });

  it('fails clearly when no token is configured', () => {
    expect(() => loadConfig({ GUILD_IDS: GUILD }, noFile)).toThrow(/DISCORD_TOKEN/);
  });

  it('parses a comma-separated GUILD_IDS list', () => {
    const config = loadConfig({ DISCORD_TOKEN: 't', GUILD_IDS: ` ${GUILD}, 234567890123456789 ,` }, noFile);
    expect(config.guildIds).toEqual([GUILD, '234567890123456789']);
  });

  it('rejects missing or malformed GUILD_IDS', () => {
    expect(() => loadConfig({ DISCORD_TOKEN: 't' }, noFile)).toThrow(/GUILD_IDS/);
    expect(() => loadConfig({ DISCORD_TOKEN: 't', GUILD_IDS: 'my-server' }, noFile)).toThrow(/my-server/);
  });

  it('leaves features off when their channels are not set', () => {
    const config = loadConfig({ DISCORD_TOKEN: 't', GUILD_IDS: GUILD, GAME_SUGGESTIONS_CHANNEL_ID: '' }, noFile);
    expect(config.gameNight).toBeUndefined();
    expect(config.gameSuggestions).toBeUndefined();
  });

  it('requires both game night channels together', () => {
    expect(() =>
      loadConfig({ DISCORD_TOKEN: 't', GUILD_IDS: GUILD, GAME_NIGHT_ANNOUNCEMENTS_CHANNEL_ID: GUILD }, noFile),
    ).toThrow(/GAME_NIGHT_CHANNEL_ID/);
  });

  it('turns on the Claude fallback for game night when a key is set', () => {
    const base = { DISCORD_TOKEN: 't', GUILD_IDS: GUILD, GAME_NIGHT_ANNOUNCEMENTS_CHANNEL_ID: GUILD, GAME_NIGHT_CHANNEL_ID: GUILD };
    expect(loadConfig(base, noFile).gameNight?.claude).toBeUndefined();
    expect(loadConfig({ ...base, ANTHROPIC_API_KEY_FILE: '/a' }, () => 'sk-ant-x\n').gameNight?.claude).toEqual({
      apiKey: 'sk-ant-x',
      model: 'claude-opus-5-5',
    });
    expect(loadConfig({ ...base, ANTHROPIC_API_KEY: 'k', CLAUDE_MODEL: 'claude-haiku-5-5' }, noFile).gameNight?.claude?.model).toBe('claude-haiku-5-5');
  });

  it('rejects a CLAUDE_MODEL that isn\'t an API model ID', () => {
    const env = { DISCORD_TOKEN: 't', GUILD_IDS: GUILD, ANTHROPIC_API_KEY: 'k', CLAUDE_MODEL: 'opus' };
    expect(() => loadConfig(env, noFile)).toThrow(/CLAUDE_MODEL "opus"/);
    expect(() => loadConfig({ ...env, CLAUDE_MODEL: 'claude-opus-5.5' }, noFile)).toThrow(/isn't a Claude API model ID/);
    expect(loadConfig({ ...env, CLAUDE_MODEL: 'claude-haiku-4-5-20251001' }, noFile).gameNight).toBeUndefined();
  });

  it('sets up player research from the same Claude key, with optional Tavily web search', () => {
    const env = { DISCORD_TOKEN: 't', GUILD_IDS: GUILD, GAME_SUGGESTIONS_CHANNEL_ID: GUILD, ANTHROPIC_API_KEY: 'a', TAVILY_API_KEY_FILE: '/t' };
    expect(loadConfig(env, () => 'tvly-x\n').gameSuggestions).toEqual({
      forumChannelId: GUILD,
      claude: { apiKey: 'a', model: 'claude-opus-5-5' },
      tavilyApiKey: 'tvly-x',
    });
  });

  it('reads the optional ITAD key from ITAD_API_KEY_FILE', () => {
    const env = { DISCORD_TOKEN: 't', GUILD_IDS: GUILD, GAME_SUGGESTIONS_CHANNEL_ID: GUILD, ITAD_API_KEY_FILE: '/itad' };
    expect(loadConfig(env, () => 'itad-key\n').gameSuggestions).toEqual({ forumChannelId: GUILD, itadApiKey: 'itad-key' });
    const withoutKey = { DISCORD_TOKEN: 't', GUILD_IDS: GUILD, GAME_SUGGESTIONS_CHANNEL_ID: GUILD };
    expect(loadConfig(withoutKey, noFile).gameSuggestions).toEqual({ forumChannelId: GUILD });
  });
});

describe('applicationIdFromToken', () => {
  it('decodes the ID from an unpadded base64 first segment', () => {
    const id = '345678901234567890';
    const segment = Buffer.from(id).toString('base64').replace(/=+$/, '');
    expect(applicationIdFromToken(`${segment}.abc.def`)).toBe(id);
  });

  it('rejects tokens that do not start with an ID', () => {
    expect(() => applicationIdFromToken('bm90LWFuLWlk.abc.def')).toThrow();
  });
});
