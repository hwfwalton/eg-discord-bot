import { ping } from './ping.ts';
import type { Command } from './types.ts';

/** Every slash command the bot offers. Add new commands here. */
export const commands: Command[] = [ping];

export function commandMap(list: Command[] = commands): Map<string, Command> {
  const map = new Map<string, Command>();
  for (const command of list) {
    if (map.has(command.data.name)) {
      throw new Error(`Duplicate command name: /${command.data.name}`);
    }
    map.set(command.data.name, command);
  }
  return map;
}
