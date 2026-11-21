// Forum tags for a suggested game, following the game ideas forum's own conventions:
// - Free: free on Steam.        - MacOS: runs on macOS per Steam.
// - Only One Copy Needed: a free friend pass / guest client, or only the host has to buy it.
// - Max 4 Players: at most 4 players and no mod that raises it.
// - Modding Needed: at most 4 players, but a mod raises the limit (e.g. ROUNDS, TowerFall).
// Sale tags (Usually/Rarely On Sale) and Banked Keys are left to people.
import type { GameLookup } from './gameInfo.ts';

export const TAG = {
  free: 'Free',
  oneCopy: 'Only One Copy Needed',
  mac: 'MacOS',
  maxFour: 'Max 4 Players',
  modding: 'Modding Needed',
} as const;

/** Discord's limit on tags per forum post. */
const MAX_TAGS = 5;
const SMALL_LOBBY = 4;

/**
 * The tag names that apply to a looked-up game. Only for exact Steam matches: a best guess may be a
 * different game, and tags (unlike the card's "best guess" note) can't carry a hedge.
 */
export function chooseTags({ match, game, research, friendPass }: GameLookup): string[] {
  if (!game || !match?.exact) return [];
  const tags: string[] = [];
  if (game.isFree) tags.push(TAG.free);
  if (friendPass || research?.onlyOneCopyNeeded) tags.push(TAG.oneCopy);
  if (game.mac) tags.push(TAG.mac);
  const lobby = lobbyTag(game.multiplayer, research);
  if (lobby) tags.push(lobby);
  return tags;
}

/** "Max 4 Players" or "Modding Needed", when the research supports a call either way. */
function lobbyTag(modes: string[], research: GameLookup['research']): string | undefined {
  // Partial research didn't check for mods, so "no mod" can't be concluded.
  if (!research || research.partial) return undefined;
  // For an online game, only the online limit counts (a 4-player split-screen limit says nothing about online).
  const online = modes.some((mode) => mode.startsWith('Online'));
  const players = online ? research.onlinePlayers : (research.onlinePlayers ?? research.localPlayers);
  if (players === undefined || players < 2 || players > SMALL_LOBBY) return undefined;
  const mod = research.mod;
  const modRaisesIt = mod !== undefined && (mod.maxPlayers === undefined || mod.maxPlayers > players);
  return modRaisesIt ? TAG.modding : TAG.maxFour;
}

/** The forum's tag IDs for these names (matched ignoring case); names the forum doesn't have are skipped. */
export function tagIdsFor(names: readonly string[], available: readonly { id: string; name: string }[]): string[] {
  const byName = new Map(available.map((tag) => [tag.name.trim().toLowerCase(), tag.id]));
  return names.map((name) => byName.get(name.toLowerCase())).filter((id): id is string => id !== undefined);
}

/**
 * Tag IDs to add to a member's post. If they already chose Max 4 Players or Modding Needed, the bot
 * adds neither, so it never contradicts their call.
 */
export function tagIdsToAdd(existing: readonly string[], names: readonly string[], available: readonly { id: string; name: string }[]): string[] {
  const pair = new Set(tagIdsFor([TAG.maxFour, TAG.modding], available));
  const memberChosePair = existing.some((id) => pair.has(id));
  return tagIdsFor(names, available).filter((id) => !(memberChosePair && pair.has(id)));
}

/** Names of our tags the forum doesn't have (e.g. renamed), so they'd be skipped. */
export function missingTags(available: readonly { name: string }[]): string[] {
  const names = new Set(available.map((tag) => tag.name.trim().toLowerCase()));
  return Object.values(TAG).filter((name) => !names.has(name.toLowerCase()));
}

/** A post's existing tags plus new ones: nothing removed, no duplicates, within Discord's limit. */
export function mergeTagIds(existing: readonly string[], added: readonly string[]): string[] {
  return [...new Set([...existing, ...added])].slice(0, MAX_TAGS);
}
