import {
  Client,
  DiscordAPIError,
  Events,
  GatewayIntentBits,
  MessageFlags,
  RESTJSONErrorCodes,
  type Interaction,
} from 'discord.js';
import { commandMap, commands } from './commands/index.ts';
import type { Config } from './config.ts';
import { log } from './log.ts';

export function createBot(config: Config): Client {
  const client = new Client({
    // Only the "Guilds" intent for now: enough for slash commands and threads.
    // Add intents as features need them (e.g. GuildScheduledEvents for event reminders).
    intents: [GatewayIntentBits.Guilds],
  });

  const byName = commandMap(commands);

  client.once(Events.ClientReady, async (ready) => {
    log.info(`Logged in as ${ready.user.tag}`);
    await registerCommands(ready, config.guildIds);
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
async function registerCommands(client: Client<true>, guildIds: string[]): Promise<void> {
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
  byName: ReturnType<typeof commandMap>,
): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  // Another instance of the bot (e.g. prod vs. local dev) may own this server; stay out of its way.
  if (!interaction.guildId || !config.guildIds.includes(interaction.guildId)) return;

  const command = byName.get(interaction.commandName);
  if (!command) {
    log.warn(`Received unknown command /${interaction.commandName}`);
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
