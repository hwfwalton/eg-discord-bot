import type { GameNight } from '../features/gameNight/gameNight.ts';
import type { GameSuggestions } from '../features/gameSuggestions/gameSuggestions.ts';
import { gameNightCommand } from './gamenight.ts';
import { ping } from './ping.ts';
import { suggestCommand } from './suggest.ts';
import type { Command } from './types.ts';

/** Features that commands can talk to. Absent when that feature isn't configured. */
export interface CommandDeps {
  gameNight?: GameNight;
  gameSuggestions?: GameSuggestions;
}

/** Every slash command the bot offers. Add new commands here. */
export function buildCommands(deps: CommandDeps = {}): Command[] {
  return [
    ping,
    ...(deps.gameNight ? [gameNightCommand(deps.gameNight)] : []),
    ...(deps.gameSuggestions ? [suggestCommand(deps.gameSuggestions)] : []),
  ];
}

export function commandMap(list: Command[]): Map<string, Command> {
  const map = new Map<string, Command>();
  for (const command of list) {
    if (map.has(command.data.name)) {
      throw new Error(`Duplicate command name: /${command.data.name}`);
    }
    map.set(command.data.name, command);
  }
  return map;
}
