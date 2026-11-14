import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { Command } from './types.ts';

export const ping: Command = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Check that the bot is alive'),

  async execute(interaction) {
    const latency = interaction.client.ws.ping;
    const uptimeMinutes = Math.floor((interaction.client.uptime ?? 0) / 60_000);
    await interaction.reply({
      content: `Pong! Gateway latency: ${latency >= 0 ? `${latency}ms` : 'measuring…'} · Up ${uptimeMinutes} min`,
      // Ephemeral: only the person who ran the command sees the reply.
      flags: MessageFlags.Ephemeral,
    });
  },
};
