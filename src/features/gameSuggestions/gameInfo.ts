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
  return { query, match, game, deals: await dealsFor(game, itad) };
}

/** Looks up a game by its Steam app ID (e.g. from a store link). Undefined if Steam doesn't know it. */
export async function lookUpSteamApp(
  appId: number,
  { fetchFn = fetch, itad }: LookupDeps = {},
): Promise<GameLookup | undefined> {
  const game = await getSteamGame(appId, fetchFn);
  if (!game) return undefined;
  const match = { item: { id: game.id, name: game.name }, exact: true, others: [] };
  return { query: game.name, match, game, deals: await dealsFor(game, itad) };
}

async function dealsFor(game: SteamGame, itad: ItadClient | undefined): Promise<ItadDeals | undefined> {
  // Deals only matter for paid games.
  if (!itad || game.isFree) return undefined;
  try {
    return await itad.dealsForSteamApp(game.id);
  } catch (err) {
    log.warn(`IsThereAnyDeal lookup failed for "${game.name}"; replying without deals`, err);
    return undefined;
  }
}

const STEAM_BLUE = 0x1b2838;
const DESCRIPTION_LIMIT = 300;

/** The reply posted in a suggestion: the game's info card, or a note that it wasn't found. */
export function gameInfoMessage(lookup: GameLookup): MessageCreateOptions {
  const embed = gameInfoEmbed(lookup);
  return embed
    ? { embeds: [embed], allowedMentions: { parse: [] } }
    : { content: notFoundText(lookup.query), allowedMentions: { parse: [] } };
}

export function notFoundText(query: string): string {
  return `🔍 I couldn't find **${query}** on Steam.`;
}

/** The game's info card, or undefined when there's no Steam match. */
export function gameInfoEmbed({ query, match, game, deals }: GameLookup): EmbedBuilder | undefined {
  if (!match || !game) return undefined;

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

  return embed;
}

function priceText(game: SteamGame): string {
  if (game.isFree) return 'Free';
  return game.price ?? (game.comingSoon ? 'Not yet priced' : '—');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
