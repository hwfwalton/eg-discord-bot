import { describe, expect, it } from 'vitest';
import type { GameLookup } from './gameInfo.ts';
import type { GameResearch } from './research.ts';
import type { SteamGame } from './steam.ts';
import { TAG, chooseTags, mergeTagIds, missingTags, tagIdsFor, tagIdsToAdd } from './tags.ts';

const base: SteamGame = {
  id: 1,
  name: 'Game',
  url: '',
  description: '',
  isFree: false,
  comingSoon: false,
  multiplayer: [],
  mac: false,
  features: [],
  about: '',
};

function lookup(game: Partial<SteamGame> = {}, research?: Partial<GameResearch>, friendPass = false, exact = true): GameLookup {
  return {
    query: 'q',
    match: { item: { id: 1, name: 'Game' }, exact, others: [] },
    game: { ...base, ...game },
    ...(research && { research: { onlyOneCopyNeeded: false, sources: [], ...research } }),
    ...(friendPass && { friendPass: { id: 2, name: 'Game Friendpass' } }),
  };
}

describe('chooseTags', () => {
  it('tags free and Mac games from Steam', () => {
    expect(chooseTags(lookup({ isFree: true, mac: true }))).toEqual([TAG.free, TAG.mac]);
    expect(chooseTags(lookup())).toEqual([]);
  });

  it('tags host-only purchases from a Friend Pass app or the research', () => {
    expect(chooseTags(lookup({}, undefined, true))).toEqual([TAG.oneCopy]);
    expect(chooseTags(lookup({ isFree: true }, { onlyOneCopyNeeded: true }))).toEqual([TAG.free, TAG.oneCopy]);
  });

  it('tags small games "Max 4 Players", or "Modding Needed" when a mod raises the limit', () => {
    expect(chooseTags(lookup({}, { onlinePlayers: 4, localPlayers: 2 }))).toEqual([TAG.maxFour]);
    // ROUNDS: 2 players, up to 16 with Rounds With Friends.
    expect(chooseTags(lookup({}, { onlinePlayers: 2, mod: { name: 'Rounds With Friends', maxPlayers: 16 } }))).toEqual([TAG.modding]);
    // A mod whose limit isn't known still counts.
    expect(chooseTags(lookup({}, { localPlayers: 4, mod: { name: 'More Players' } }))).toEqual([TAG.modding]);
    // A mod that doesn't raise it doesn't.
    expect(chooseTags(lookup({}, { onlinePlayers: 4, mod: { name: 'Cosmetics', maxPlayers: 4 } }))).toEqual([TAG.maxFour]);
  });

  it("doesn't tag a best guess, which may be a different game", () => {
    expect(chooseTags(lookup({ isFree: true, mac: true }, { onlinePlayers: 4 }, true, false))).toEqual([]);
  });

  it('uses the online limit for online games, not the split-screen one', () => {
    const online = { multiplayer: ['Online Co-op'] };
    expect(chooseTags(lookup(online, { localPlayers: 4 }))).toEqual([]);
    expect(chooseTags(lookup(online, { onlinePlayers: 4, localPlayers: 2 }))).toEqual([TAG.maxFour]);
    expect(chooseTags(lookup({}, { localPlayers: 4 }))).toEqual([TAG.maxFour]);
  });

  it("makes no lobby call from partial research (mods weren't checked) or a 1-player count", () => {
    expect(chooseTags(lookup({}, { onlinePlayers: 2, partial: true }))).toEqual([]);
    expect(chooseTags(lookup({}, { onlinePlayers: 1 }))).toEqual([]);
  });

  it("doesn't tag the player count of bigger or unknown lobbies", () => {
    expect(chooseTags(lookup({}, { onlinePlayers: 8 }))).toEqual([]);
    expect(chooseTags(lookup({}, {}))).toEqual([]);
  });

  it('has nothing to say without a Steam game', () => {
    expect(chooseTags({ query: 'q' })).toEqual([]);
  });
});

describe('tagIdsFor', () => {
  const available = [
    { id: '1', name: 'Free' },
    { id: '2', name: 'Max 4 Players' },
    { id: '3', name: 'Only One Copy Needed' },
  ];

  it("maps names to the forum's tag IDs, ignoring case and skipping tags the forum doesn't have", () => {
    expect(tagIdsFor(['free', 'MacOS', 'Max 4 Players'], available)).toEqual(['1', '2']);
  });
});

describe('tagIdsToAdd', () => {
  const available = [
    { id: 'free', name: 'Free' },
    { id: 'max4', name: 'Max 4 Players' },
    { id: 'mod', name: 'Modding Needed' },
  ];

  it("never contradicts a member's own Max 4 Players / Modding Needed choice", () => {
    expect(tagIdsToAdd(['mod'], ['Free', 'Max 4 Players'], available)).toEqual(['free']);
    expect(tagIdsToAdd(['max4'], ['Modding Needed'], available)).toEqual([]);
    expect(tagIdsToAdd([], ['Free', 'Max 4 Players'], available)).toEqual(['free', 'max4']);
  });
});

describe('missingTags', () => {
  it("lists the bot's tags the forum doesn't have", () => {
    expect(missingTags([{ name: 'free' }, { name: 'Mac' }, { name: 'Max 4 Players' }])).toEqual([TAG.oneCopy, TAG.mac, TAG.modding]);
  });
});

describe('mergeTagIds', () => {
  it('keeps existing tags, adds new ones once, and stays within 5', () => {
    expect(mergeTagIds(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(mergeTagIds(['a', 'b', 'c', 'd'], ['e', 'f'])).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
