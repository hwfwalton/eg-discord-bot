import { describe, expect, it } from 'vitest';
import { findFriendPass, playersText } from './gameInfo.ts';
import type { GameResearch } from './research.ts';

const WIKI = { title: 'PCGamingWiki: Rounds', url: 'https://www.pcgamingwiki.com/wiki/Rounds' };
const research = (r: Partial<GameResearch>): GameResearch => ({ onlyOneCopyNeeded: false, sources: [WIKI], ...r });

describe('playersText', () => {
  it("writes the counts and any mod in the forum's style", () => {
    expect(
      playersText(
        research({
          onlinePlayers: 2,
          localPlayers: 2,
          mod: { name: 'Rounds With Friends', maxPlayers: 16, url: 'https://thunderstore.io/c/rounds/p/olavim/RoundsWithFriends/' },
        }),
      ),
    ).toBe(
      'Max 2 online · 2 local\n' +
        'Up to 16 with the [Rounds With Friends](https://thunderstore.io/c/rounds/p/olavim/RoundsWithFriends/) mod\n' +
        '_From the Steam page and PCGamingWiki_',
    );
  });

  it("says so when the counts aren't listed, and names only the sources actually used", () => {
    expect(playersText(research({}))).toBe('Max players not listed\n_From the Steam page and PCGamingWiki_');
    expect(playersText(research({ sources: [] }))).toBe('Max players not listed\n_From the Steam page_');
    expect(playersText(research({ localPlayers: 4, mod: { name: 'More_Players [x]' } }))).toBe(
      'Max 4 local\nMore players with the **More\\_Players \\[x\\]** mod\n_From the Steam page and PCGamingWiki_',
    );
  });

  it('credits a web search, linking the page that states the counts', () => {
    expect(
      playersText(research({ onlinePlayers: 8, webSearched: true, citation: { title: 'steamcommunity.com', url: 'https://steamcommunity.com/x' } })),
    ).toBe('Max 8 online\n_From the Steam page, PCGamingWiki and a web search ([steamcommunity.com](https://steamcommunity.com/x))_');
  });

  it('mentions host-only purchases, linking a Friend Pass when there is one', () => {
    expect(playersText(undefined, { id: 3089430, name: 'Prop Sumo Friendpass' })).toBe(
      'Only the host needs to buy it: friends can use the free [Prop Sumo Friendpass](https://store.steampowered.com/app/3089430/)',
    );
    expect(playersText(research({ onlinePlayers: 16, onlyOneCopyNeeded: true }))).toContain('Only the host needs to buy it');
  });

  it('has nothing to say without research or a Friend Pass', () => {
    expect(playersText(undefined)).toBeUndefined();
  });
});

describe('findFriendPass', () => {
  const results = [
    { id: 1, name: 'Prop Sumo' },
    { id: 2, name: 'Prop Sumo Friendpass' },
    { id: 3, name: "Other Game Friend's Pass" },
    { id: 4, name: 'It Takes Two Friend’s Pass' },
    { id: 5, name: 'Overcooked! 2 - Friend Pass' },
  ];

  it("finds this game's Friend Pass, however it's spelled", () => {
    expect(findFriendPass('Prop Sumo', results)).toEqual({ id: 2, name: 'Prop Sumo Friendpass' });
    expect(findFriendPass('Other Game', results)?.id).toBe(3);
  });

  it("ignores other games' passes, including sequels", () => {
    expect(findFriendPass('Sky Noon', results)).toBeUndefined();
    expect(findFriendPass('Overcooked', results)).toBeUndefined();
    expect(findFriendPass('Overcooked! 2', results)?.id).toBe(5);
    expect(findFriendPass('It Takes Two', results)?.id).toBe(4);
  });
});
