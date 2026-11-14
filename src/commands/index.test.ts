import { describe, expect, it } from 'vitest';
import { commandMap, commands } from './index.ts';
import { ping } from './ping.ts';

describe('commands', () => {
  it('every command has a valid definition', () => {
    for (const command of commands) {
      // toJSON runs discord.js's own validation (name format, description length, etc.)
      const json = command.data.toJSON();
      expect(json.name).toMatch(/^[a-z0-9_-]{1,32}$/);
      expect(json.description?.length).toBeGreaterThan(0);
    }
  });

  it('rejects duplicate command names', () => {
    expect(() => commandMap([ping, ping])).toThrow(/Duplicate/);
  });
});
