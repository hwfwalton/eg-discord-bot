// Discord wiring for the game suggestions forum:
// - each new post someone makes gets a reply with the game's Steam/IsThereAnyDeal info
// - "/suggest <game>" and "@EGBot <game>" create a post for a game (see suggest.ts)
import { setTimeout as sleep } from 'node:timers/promises';
import {
  ChannelType,
  Events,
  type AnyThreadChannel,
  type ApplicationCommandOptionChoiceData,
  type Client,
  type ForumChannel,
  type Message,
  type User,
} from 'discord.js';
import type { GameSuggestionsConfig } from '../../config.ts';
import { log } from '../../log.ts';
import { gameInfoMessage, lookUpGame } from './gameInfo.ts';
import { createItadClient } from './itad.ts';
import { searchSteam } from './steam.ts';
import {
  type SuggestResult,
  type SuggestionRequest,
  autocompleteChoices,
  createSuggester,
  parseMention,
  resultText,
} from './suggest.ts';

/** Discord gives autocomplete 3 seconds to answer; leave room for the reply itself. */
const AUTOCOMPLETE_TIMEOUT_MS = 2_000;

export interface GameSuggestions {
  suggest(request: SuggestionRequest & { user: User; guildId: string }): Promise<SuggestResult>;
  /** Choices for `/suggest`'s game option as the user types. */
  autocomplete(typed: string): Promise<ApplicationCommandOptionChoiceData<string>[]>;
}

export function registerGameSuggestions(client: Client, config: GameSuggestionsConfig): GameSuggestions {
  const itad = config.itadApiKey ? createItadClient(config.itadApiKey) : undefined;
  if (!itad) log.warn('No ITAD_API_KEY set; game suggestion replies will skip IsThereAnyDeal info');

  let forumChannel: ForumChannel | undefined;
  async function getForum(): Promise<ForumChannel> {
    if (forumChannel) return forumChannel;
    const channel = await client.channels.fetch(config.forumChannelId);
    if (channel?.type !== ChannelType.GuildForum) {
      throw new Error(`GAME_SUGGESTIONS_CHANNEL_ID ${config.forumChannelId} isn't a forum channel the bot can see.`);
    }
    return (forumChannel = channel);
  }

  const suggester = createSuggester(getForum, { itad });

  async function onThreadCreate(thread: AnyThreadChannel, newlyCreated: boolean): Promise<void> {
    // Posts the bot makes itself (via /suggest or @EGBot) already carry the info card.
    if (!newlyCreated || thread.parentId !== config.forumChannelId || thread.ownerId === client.user?.id) return;

    const query = thread.name.trim();
    log.info(`Game suggestion: looking up "${query}"`);
    const reply = gameInfoMessage(await lookUpGame(query, { itad }));

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

  /** "@EGBot <game>" in any channel of the forum's server. */
  async function onMessage(message: Message): Promise<void> {
    if (message.author.bot || !message.inGuild() || !client.user) return;
    const request = parseMention(message.content, {
      userId: client.user.id,
      roleId: message.guild.members.me?.roles.botRole?.id,
    });
    if (!request) return;

    // Dev and prod share one bot account; only the instance whose forum is in this server answers.
    const forum = await getForum();
    if (message.guildId !== forum.guildId) return;

    await message.channel.sendTyping().catch(() => undefined);
    let reply: string;
    try {
      const result = await suggester.suggest({
        ...request,
        userId: message.author.id,
        userTag: message.author.tag,
        guildId: message.guildId,
        // Chat like "@EGBot thanks!" also starts with a mention, so only create posts for exact matches.
        requireExactMatch: true,
      });
      reply = resultText(result);
    } catch (err) {
      log.error(`Game suggestion from ${message.author.tag} failed`, err);
      reply = 'Sorry, something went wrong adding that game. Please try again in a bit.';
    }
    // failIfNotExists: still answer (as a plain message) if they deleted their message meanwhile.
    await message.reply({ content: reply, allowedMentions: { parse: [], repliedUser: false }, failIfNotExists: false });
  }

  client.on(Events.ThreadCreate, (thread, newlyCreated) => {
    onThreadCreate(thread, newlyCreated).catch((err) => log.error(`Game suggestion reply failed in "${thread.name}"`, err));
  });
  client.on(Events.MessageCreate, (message) => {
    onMessage(message).catch((err) => log.error('Handling a game suggestion mention failed', err));
  });

  return {
    suggest: ({ user, ...request }) => suggester.suggest({ ...request, userId: user.id, userTag: user.tag }),

    async autocomplete(typed) {
      const query = typed.trim();
      if (query.length < 2) return autocompleteChoices(query, []);
      const items = await searchSteam(query, fetch, AUTOCOMPLETE_TIMEOUT_MS).catch(() => []);
      return autocompleteChoices(query, items);
    },
  };
}
