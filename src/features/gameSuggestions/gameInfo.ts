// Looks up a suggested game and builds the reply.
import { EmbedBuilder, type MessageCreateOptions } from 'discord.js';
import { gameKey } from '../../gameName.ts';
import { log } from '../../log.ts';
import type { ItadClient, ItadDeals } from './itad.ts';
import type { GameResearch, Researcher } from './research.ts';
import { type SteamGame, type SteamMatch, type SteamSearchItem, getSteamGame, pickMatch, searchSteam } from './steam.ts';

export interface GameLookup {
  query: string;
  match?: SteamMatch;
  game?: SteamGame;
  deals?: ItadDeals;
  /** Player counts, mods and host-only purchase (see research.ts). */
  research?: GameResearch;
  /** A separate free "Friend Pass" app on Steam, which means only the host needs to buy the game. */
  friendPass?: SteamSearchItem;
}

export interface LookupDeps {
  fetchFn?: typeof fetch;
  /** Optional: without it, replies just skip the deal info. */
  itad?: ItadClient;
  /** Optional: without it, replies skip player counts and mods. */
  researcher?: Researcher;
}

export async function lookUpGame(query: string, deps: LookupDeps = {}): Promise<GameLookup> {
  const { fetchFn = fetch } = deps;
  const results = await searchSteam(query, fetchFn);
  const match = pickMatch(query, results);
  if (!match) return { query };
  const game = await getSteamGame(match.item.id, fetchFn);
  if (!game) return { query, match };
  return { query, match, game, ...(await detailsFor(game, results, deps)) };
}

/** Looks up a game by its Steam app ID (e.g. from a store link). Undefined if Steam doesn't know it. */
export async function lookUpSteamApp(appId: number, deps: LookupDeps = {}): Promise<GameLookup | undefined> {
  const { fetchFn = fetch } = deps;
  const game = await getSteamGame(appId, fetchFn);
  if (!game) return undefined;
  const match = { item: { id: game.id, name: game.name }, exact: true, others: [] };
  // Searching by name finds any Friend Pass app.
  const results = await searchSteam(game.name, fetchFn).catch(() => []);
  return { query: game.name, match, game, ...(await detailsFor(game, results, deps)) };
}

async function detailsFor(game: SteamGame, results: SteamSearchItem[], { itad, researcher }: LookupDeps) {
  const [deals, research] = await Promise.all([dealsFor(game, itad), researchFor(game, researcher)]);
  const friendPass = findFriendPass(game.name, results);
  return { deals, ...(research && { research }), ...(friendPass && { friendPass }) };
}

/** Adds research to a lookup that was made without it (e.g. once a post is sure to be created). */
export async function withResearch(lookup: GameLookup, researcher: Researcher | undefined): Promise<GameLookup> {
  if (!lookup.game || lookup.research || !researcher) return lookup;
  const research = await researchFor(lookup.game, researcher);
  return research ? { ...lookup, research } : lookup;
}

async function researchFor(game: SteamGame, researcher: Researcher | undefined): Promise<GameResearch | undefined> {
  if (!researcher) return undefined;
  try {
    return await researcher(game);
  } catch (err) {
    log.warn(`Researching "${game.name}" failed; replying without player counts`, err);
    return undefined;
  }
}

const FRIEND_PASS = /\bfriends?\s*['’]?\s*s?\s*pass\b|\bfriendpass\b/i;

/**
 * A search result that's this game's free Friend Pass app, e.g. "Prop Sumo Friendpass" or
 * "It Takes Two Friend’s Pass". The rest of its name must be exactly this game's, so
 * "Overcooked! 2 Friend Pass" isn't taken for "Overcooked".
 */
export function findFriendPass(name: string, results: SteamSearchItem[]): SteamSearchItem | undefined {
  const key = gameKey(name);
  if (!key) return undefined;
  return results.find((item) => FRIEND_PASS.test(item.name) && gameKey(item.name.replace(FRIEND_PASS, ' ').replace(/[-–—:]\s*$/, '')) === key);
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
export function gameInfoEmbed({ query, match, game, deals, research, friendPass }: GameLookup): EmbedBuilder | undefined {
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

  const players = playersText(research, friendPass);
  if (players) embed.addFields({ name: 'Players', value: players });

  // PCGamingWiki's license (CC BY-NC-SA) asks for a link back when its data is used.
  const wiki = research?.sources.find((source) => source.url.startsWith('https://www.pcgamingwiki.com/'));
  const links = [
    `[Steam](${game.url})`,
    ...(deals ? [`[IsThereAnyDeal](${deals.url})`] : []),
    ...(wiki ? [`[PCGamingWiki](${wiki.url})`] : []),
  ];
  embed.addFields({ name: 'Links', value: links.join(' · ') });
  if (game.headerImage) embed.setImage(game.headerImage);

  if (!match.exact) {
    const others = match.others.map((o) => `[${o.name}](https://store.steampowered.com/app/${o.id}/)`).join(' · ');
    embed.setFooter({ text: `Best guess for “${query}”. Not right? Other matches are listed above.` });
    if (others) embed.addFields({ name: 'Other matches', value: others });
  }

  return embed;
}

/**
 * The Players field, in the forum's own style: "8 online · 4 local", then any mod that raises the
 * limit and whether only the host needs to buy the game. Undefined when there's nothing to say.
 */
export function playersText(research: GameResearch | undefined, friendPass?: SteamSearchItem): string | undefined {
  const lines: string[] = [];
  if (research) {
    const counts = [
      research.onlinePlayers ? `${research.onlinePlayers} online` : '',
      research.localPlayers ? `${research.localPlayers} local` : '',
    ].filter(Boolean);
    lines.push(counts.length ? `Max ${counts.join(' · ')}` : 'Max players not listed');
    const mod = research.mod;
    if (mod) {
      const label = escapeMarkdown(mod.name);
      const name = mod.url ? `[${label}](${mod.url})` : `**${label}**`;
      lines.push(mod.maxPlayers ? `Up to ${mod.maxPlayers} with the ${name} mod` : `More players with the ${name} mod`);
    }
  }
  if (friendPass) {
    lines.push(`Only the host needs to buy it: friends can use the free [${friendPass.name}](https://store.steampowered.com/app/${friendPass.id}/)`);
  } else if (research?.onlyOneCopyNeeded) {
    lines.push('Only the host needs to buy it');
  }
  if (!lines.length) return undefined;
  if (research) lines.push(`_From ${sourcesUsed(research)}_`);
  return lines.join('\n');
}

/** "the Steam page", "the Steam page and PCGamingWiki", "the Steam page, PCGamingWiki and a web search (x.com)". */
function sourcesUsed(research: GameResearch): string {
  const wiki = research.sources.some((source) => source.url.startsWith('https://www.pcgamingwiki.com/'));
  const cite = research.citation ? ` ([${research.citation.title}](${research.citation.url}))` : '';
  const parts = ['the Steam page', ...(wiki ? ['PCGamingWiki'] : []), ...(research.webSearched ? [`a web search${cite}`] : [])];
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]!;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\*_~`|[\]()<>#]/g, '\\$&');
}

function priceText(game: SteamGame): string {
  if (game.isFree) return 'Free';
  return game.price ?? (game.comingSoon ? 'Not yet priced' : '—');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
