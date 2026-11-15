import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';

/** A slash command: its definition (sent to Discord) plus the handler that runs when someone uses it. */
export interface Command {
  data: {
    name: string;
    toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
  };
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  /** Suggests values for options marked `.setAutocomplete(true)` while the user types. */
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}
