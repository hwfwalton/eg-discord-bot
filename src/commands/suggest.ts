import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { GameSuggestions } from '../features/gameSuggestions/gameSuggestions.ts';
import { MAX_NOTE_LENGTH, MAX_TITLE_LENGTH, resultText } from '../features/gameSuggestions/suggest.ts';
import type { Command } from './types.ts';

export function suggestCommand(suggestions: GameSuggestions): Command {
  return {
    data: new SlashCommandBuilder()
      .setName('suggest')
      .setDescription('Suggest a game: adds a post for it in the game ideas forum')
      .addStringOption((option) =>
        option
          .setName('game')
          .setDescription("The game's name (pick a Steam match or type your own)")
          .setRequired(true)
          .setMaxLength(MAX_TITLE_LENGTH)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName('note')
          .setDescription('Optional: why it would be fun, links, etc.')
          .setMaxLength(MAX_NOTE_LENGTH),
      ),

    async execute(interaction) {
      // Looking the game up and checking for an existing post can take a few seconds.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await suggestions.suggest({
        game: interaction.options.getString('game', true),
        note: interaction.options.getString('note') ?? undefined,
        user: interaction.user,
        guildId: interaction.guildId ?? '',
      });
      await interaction.editReply({ content: resultText(result), allowedMentions: { parse: [] } });
    },

    async autocomplete(interaction) {
      await interaction.respond(await suggestions.autocomplete(interaction.options.getFocused()));
    },
  };
}
