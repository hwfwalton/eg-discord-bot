// Looks up a suggested game and builds the reply.
import { EmbedBuilder, type MessageCreateOptions } from 'discord.js';
import { type SteamGame, type SteamMatch, getSteamGame, pickMatch, searchSteam } from './steam.ts';

export interface GameLookup {
  query: string;
  match?: SteamMatch;
  game?: SteamGame;
}

export async function lookUpGame(query: string, fetchFn: typeof fetch = fetch): Promise<GameLookup> {
  const match = pickMatch(query, await searchSteam(query, fetchFn));
  if (!match) return { query };
  return { query, match, game: await getSteamGame(match.item.id, fetchFn) };
}

const STEAM_BLUE = 0x1b2838;
const DESCRIPTION_LIMIT = 300;

export function gameInfoMessage({ query, match, game }: GameLookup): MessageCreateOptions {
  if (!match || !game) {
    return { content: `🔍 I couldn't find **${query}** on Steam.`, allowedMentions: { parse: [] } };
  }

  const embed = new EmbedBuilder()
    .setColor(STEAM_BLUE)
    .setTitle(game.name)
    .setURL(game.url)
    .setDescription(truncate(game.description, DESCRIPTION_LIMIT) || null)
    .addFields(
      { name: 'Price', value: priceText(game), inline: true },
      { name: 'Released', value: game.comingSoon ? `Coming ${game.releaseDate ?? 'soon'}` : (game.releaseDate ?? '—'), inline: true },
      { name: 'Multiplayer', value: game.multiplayer.length ? game.multiplayer.join(', ') : 'Single-player only', inline: true },
      { name: 'Links', value: `[Steam](${game.url})` },
    );
  if (game.headerImage) embed.setImage(game.headerImage);

  if (!match.exact) {
    const others = match.others.map((o) => `[${o.name}](https://store.steampowered.com/app/${o.id}/)`).join(' · ');
    embed.setFooter({ text: `Best guess for “${query}”. Not right? Other matches are listed above.` });
    if (others) embed.addFields({ name: 'Other matches', value: others });
  }

  return { embeds: [embed], allowedMentions: { parse: [] } };
}

function priceText(game: SteamGame): string {
  if (game.isFree) return 'Free';
  return game.price ?? (game.comingSoon ? 'Not yet priced' : '—');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
