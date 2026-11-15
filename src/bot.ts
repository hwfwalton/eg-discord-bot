import {
  Client,
  DiscordAPIError,
  Events,
  GatewayIntentBits,
  MessageFlags,
  RESTJSONErrorCodes,
  type Interaction,
} from 'discord.js';
import { buildCommands, commandMap } from './commands/index.ts';
import type { Command } from './commands/types.ts';
import type { Config } from './config.ts';
import { registerGameNight } from './features/gameNight/gameNight.ts';
import { registerGameSuggestions } from './features/gameSuggestions/gameSuggestions.ts';
import { log } from './log.ts';

export function createBot(config: Config): Client {
  const intents = [GatewayIntentBits.Guilds];
  if (config.gameNight || config.gameSuggestions) {
    // To read messages as they're posted: announcements (game night) and "@EGBot <game>" (suggestions).
    // Message Content is a "privileged" intent: it must also be switched on for the bot in the
    // Discord Developer Portal.
    intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  }
  const client = new Client({ intents });

  const gameNight = config.gameNight ? registerGameNight(client, config.gameNight) : undefined;
  const gameSuggestions = config.gameSuggestions
    ? registerGameSuggestions(client, config.gameSuggestions)
    : undefined;
  log.info(`Features: game night ${gameNight ? 'on' : 'off'}, game suggestions ${gameSuggestions ? 'on' : 'off'}`);

  const commands = buildCommands({ gameNight, gameSuggestions });
  const byName = commandMap(commands);

  client.once(Events.ClientReady, async (ready) => {
    log.info(`Logged in as ${ready.user.tag}`);
    await registerCommands(ready, config.guildIds, commands);
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction, config, byName);
  });

  client.on(Events.Error, (err) => log.error('Discord client error', err));
  client.on(Events.Warn, (message) => log.warn(message));

  return client;
}

/**
 * Registers our slash commands in each configured server. Server-scoped commands
 * update instantly (global ones can take a while), and `set` replaces the whole
 * list, so removed commands disappear too.
 */
async function registerCommands(client: Client<true>, guildIds: string[], commands: Command[]): Promise<void> {
  const body = commands.map((c) => c.data.toJSON());
  for (const guildId of guildIds) {
    try {
      const guild = await client.guilds.fetch(guildId);
      await guild.commands.set(body);
      log.info(`Registered ${body.length} command(s) in "${guild.name}" (${guildId})`);
    } catch (err) {
      if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownGuild) {
        log.warn(`The bot isn't in server ${guildId} yet, so no commands were registered there. Run "npm run invite".`);
      } else {
        log.warn(`Could not register commands in server ${guildId}`, err);
      }
    }
  }
}

async function handleInteraction(
  interaction: Interaction,
  config: Config,
  byName: Map<string, Command>,
): Promise<void> {
  if (!interaction.isChatInputCommand() && !interaction.isAutocomplete()) return;

  // Another instance of the bot (e.g. prod vs. local dev) may own this server; stay out of its way.
  if (!interaction.guildId || !config.guildIds.includes(interaction.guildId)) return;

  const command = byName.get(interaction.commandName);
  if (!command) {
    log.warn(`Received unknown command /${interaction.commandName}`);
    return;
  }

  if (interaction.isAutocomplete()) {
    // Best effort: if this fails or is too slow, Discord just shows no suggestions.
    await command.autocomplete?.(interaction).catch((err: unknown) => log.warn(`/${interaction.commandName} autocomplete failed`, err));
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    log.error(`/${interaction.commandName} failed`, err);
    const reply = { content: 'Something went wrong running that command.', flags: MessageFlags.Ephemeral } as const;
    const send = interaction.replied || interaction.deferred ? interaction.followUp(reply) : interaction.reply(reply);
    await send.catch((replyErr: unknown) => log.error('Could not send error reply', replyErr));
  }
}
