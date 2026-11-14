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
