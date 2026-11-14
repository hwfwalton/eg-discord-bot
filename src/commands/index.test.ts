import { describe, expect, it } from 'vitest';
import { buildCommands, commandMap } from './index.ts';
import { ping } from './ping.ts';

describe('commands', () => {
  it('every command has a valid definition', () => {
    const all = buildCommands({ gameNight: { describeNext: async () => '' } });
    expect(all.map((c) => c.data.name)).toEqual(['ping', 'gamenight']);
    for (const command of all) {
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
