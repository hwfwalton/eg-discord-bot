// Replies with game info inside each new post in the game-suggestions forum.
import { setTimeout as sleep } from 'node:timers/promises';
import { Events, type AnyThreadChannel, type Client } from 'discord.js';
import type { GameSuggestionsConfig } from '../../config.ts';
import { log } from '../../log.ts';
import { gameInfoMessage, lookUpGame } from './gameInfo.ts';

export function registerGameSuggestions(client: Client, config: GameSuggestionsConfig): void {
  async function onThreadCreate(thread: AnyThreadChannel, newlyCreated: boolean): Promise<void> {
    if (!newlyCreated || thread.parentId !== config.forumChannelId || thread.ownerId === client.user?.id) return;

    const query = thread.name.trim();
    log.info(`Game suggestion: looking up "${query}"`);
    const reply = gameInfoMessage(await lookUpGame(query));

    // A forum post's opening message can arrive just after the thread itself, and Discord
    // rejects replies until it exists, so retry briefly.
    for (let attempt = 1; ; attempt++) {
      try {
        await thread.send(reply);
        return;
      } catch (err) {
        if (attempt >= 4) throw err;
        await sleep(attempt * 1000);
      }
    }
  }

  client.on(Events.ThreadCreate, (thread, newlyCreated) => {
    onThreadCreate(thread, newlyCreated).catch((err) => log.error(`Game suggestion reply failed in "${thread.name}"`, err));
  });
}
