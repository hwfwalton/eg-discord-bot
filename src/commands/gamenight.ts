import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { GameNight } from '../features/gameNight/gameNight.ts';
import type { Command } from './types.ts';

export function gameNightCommand(gameNight: GameNight): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('gamenight')
      .setDescription("Show what the bot will announce for the next game night"),

    async execute(interaction) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await interaction.editReply({ content: await gameNight.describeNext(), allowedMentions: { parse: [] } });
    },
  };
}
