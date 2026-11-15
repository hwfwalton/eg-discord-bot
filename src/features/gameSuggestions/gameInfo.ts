// Looks up a suggested game and builds the reply.
import { EmbedBuilder, type MessageCreateOptions } from 'discord.js';
import { log } from '../../log.ts';
import type { ItadClient, ItadDeals } from './itad.ts';
import { type SteamGame, type SteamMatch, getSteamGame, pickMatch, searchSteam } from './steam.ts';

export interface GameLookup {
  query: string;
  match?: SteamMatch;
  game?: SteamGame;
  deals?: ItadDeals;
}

export interface LookupDeps {
  fetchFn?: typeof fetch;
  /** Optional: without it, replies just skip the deal info. */
  itad?: ItadClient;
}

export async function lookUpGame(query: string, { fetchFn = fetch, itad }: LookupDeps = {}): Promise<GameLookup> {
  const match = pickMatch(query, await searchSteam(query, fetchFn));
  if (!match) return { query };
  const game = await getSteamGame(match.item.id, fetchFn);
  if (!game) return { query, match };

  // Deals only matter for paid games.
  let deals: ItadDeals | undefined;
  if (itad && !game.isFree) {
    try {
      deals = await itad.dealsForSteamApp(game.id);
    } catch (err) {
      log.warn(`IsThereAnyDeal lookup failed for "${game.name}"; replying without deals`, err);
    }
  }
  return { query, match, game, deals };
}

const STEAM_BLUE = 0x1b2838;
const DESCRIPTION_LIMIT = 300;

export function gameInfoMessage({ query, match, game, deals }: GameLookup): MessageCreateOptions {
  if (!match || !game) {
    return { content: `🔍 I couldn't find **${query}** on Steam.`, allowedMentions: { parse: [] } };
  }

  const embed = new EmbedBuilder()
    .setColor(STEAM_BLUE)
    .setTitle(game.name)
    .setURL(game.url)
    .setDescription(truncate(game.description, DESCRIPTION_LIMIT) || null)
    .addFields(
      { name: 'Steam price', value: priceText(game), inline: true },
      { name: 'Released', value: game.comingSoon ? `Coming ${game.releaseDate ?? 'soon'}` : (game.releaseDate ?? '—'), inline: true },
      { name: 'Multiplayer', value: game.multiplayer.length ? game.multiplayer.join(', ') : 'Single-player only', inline: true },
    );

  if (deals?.current) {
    const c = deals.current;
    const details = [c.cut > 0 ? `-${c.cut}%` : '', c.voucher ? `code \`${c.voucher}\`` : ''].filter(Boolean).join(', ');
    embed.addFields({ name: 'Best price now', value: `[${c.price.text} at ${c.shop}](${c.url})${details ? ` (${details})` : ''}`, inline: true });
  }
  if (deals?.lowest) {
    const l = deals.lowest;
    const when = l.date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    embed.addFields({ name: 'Historical low', value: `${l.price.text} at ${l.shop} (${when})`, inline: true });
  }

  const links = [`[Steam](${game.url})`, ...(deals ? [`[IsThereAnyDeal](${deals.url})`] : [])];
  embed.addFields({ name: 'Links', value: links.join(' · ') });
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
