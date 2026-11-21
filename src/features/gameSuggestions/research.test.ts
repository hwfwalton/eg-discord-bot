import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { fakeClaude } from '../../claudeTesting.ts';
import type { PcgwMultiplayer } from './pcgamingwiki.ts';
import { createResearcher, sourceText, statesCount, toResearch } from './research.ts';
import type { SteamGame } from './steam.ts';

const game: SteamGame = {
  id: 1557740,
  name: 'ROUNDS',
  url: 'https://store.steampowered.com/app/1557740/',
  description: 'A 1v1 card shooter.',
  isFree: false,
  comingSoon: false,
  multiplayer: ['Online PvP'],
  mac: false,
  features: ['Online PvP', 'Remote Play Together'],
  about: 'Duel your friends in 2 player online battles.',
};

const MOD_URL = 'https://rounds.thunderstore.io/package/olavim/RoundsWithFriends/';
const wiki: PcgwMultiplayer = {
  page: 'Rounds',
  url: 'https://www.pcgamingwiki.com/wiki/Rounds',
  onlinePlayers: 2,
  localPlayers: 2,
  notes: `Up to 16 players via Rounds With Friends mod. (${MOD_URL})`,
};

/** A fake Claude that answers with the given schema answer (or an HTTP error), recording requests. */
const claude = (answer: object | number) => fakeClaude(answer);

const options = (client: Anthropic, pcgw = async () => wiki as PcgwMultiplayer | undefined) => ({
  client,
  model: 'claude-opus-5-5',
  pcgw,
});

const ANSWER = { onlinePlayers: 2, localPlayers: 2, modName: 'Rounds With Friends', modMaxPlayers: 16, modUrl: MOD_URL, onlyOneCopyNeeded: false };

describe('createResearcher', () => {
  it('has Claude read the Steam page and PCGamingWiki, crediting the wiki', async () => {
    const { client, calls } = claude(ANSWER);
    expect(await createResearcher(options(client))(game)).toEqual({
      onlinePlayers: 2,
      localPlayers: 2,
      mod: { name: 'Rounds With Friends', maxPlayers: 16, url: MOD_URL },
      onlyOneCopyNeeded: false,
      sources: [{ title: 'PCGamingWiki: Rounds', url: 'https://www.pcgamingwiki.com/wiki/Rounds' }],
    });
    // One request, with no tools: the bot never asks Claude to search the web.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).not.toHaveProperty('tools');
    expect(calls[0]?.body.output_config.format.schema.additionalProperties).toBe(false);
    expect(JSON.stringify(calls[0]?.body)).toContain('Rounds With Friends');
  });

  it("keeps PCGamingWiki's counts, and drops mod numbers and links that aren't in the text", async () => {
    const invented = { ...ANSWER, onlinePlayers: 16, modMaxPlayers: 32, modUrl: 'https://thunderstore.io/c/rounds/p/someone/Other/' };
    const research = await createResearcher(options(claude(invented).client))(game);
    expect(research).toMatchObject({ onlinePlayers: 2, localPlayers: 2, mod: { name: 'Rounds With Friends' } });
    expect(research?.mod).not.toHaveProperty('url');
    expect(research?.mod).not.toHaveProperty('maxPlayers');
  });

  it("doesn't let a free game be 'only one copy needed'", async () => {
    const research = await createResearcher(options(claude({ ...ANSWER, onlyOneCopyNeeded: true }).client))({ ...game, isFree: true });
    expect(research?.onlyOneCopyNeeded).toBe(false);
  });

  it("falls back to PCGamingWiki's numbers (marked partial) when Claude fails, and gives up without them", async () => {
    const { client } = claude(500);
    expect(await createResearcher(options(client))(game)).toMatchObject({ onlinePlayers: 2, localPlayers: 2, partial: true });
    expect(await createResearcher(options(client, async () => undefined))(game)).toBeUndefined();
  });

  it('still reads the Steam page when PCGamingWiki is down', async () => {
    const answer = { ...ANSWER, localPlayers: 0, modName: '', modMaxPlayers: 0, modUrl: '' };
    const research = await createResearcher(
      options(claude(answer).client, async () => {
        throw new Error('PCGamingWiki request failed: HTTP 503');
      }),
    )(game);
    expect(research).toEqual({ onlinePlayers: 2, localPlayers: undefined, onlyOneCopyNeeded: false, sources: [] });
  });
});

describe('createResearcher with web search', () => {
  const RESULT = { title: 'Rivals of Aether mods', url: 'https://steamcommunity.com/app/383980/discussions/0/1/', content: 'The Rivals 8 player mod lets 8 players join.' };

  it('runs two searches, gives Claude the results, and cites the result that states the counts', async () => {
    const queries: string[] = [];
    const webSearch = async (q: string) => {
      queries.push(q);
      return [RESULT];
    };
    const answer = { ...ANSWER, onlinePlayers: 8, localPlayers: 0, modName: '', modMaxPlayers: 0, modUrl: '', sourceUrl: RESULT.url };
    const { client, calls } = claude(answer);
    const research = await createResearcher({ ...options(client, async () => undefined), webSearch })(game);

    expect(queries).toEqual(['"ROUNDS" game max players multiplayer', '"ROUNDS" mod more players']);
    expect(JSON.stringify(calls[0]?.body)).toContain('The Rivals 8 player mod');
    expect(research).toMatchObject({
      onlinePlayers: 8,
      webSearched: true,
      citation: { title: 'steamcommunity.com', url: RESULT.url },
    });
  });

  it("doesn't cite a URL that wasn't in the search results", async () => {
    const answer = { ...ANSWER, sourceUrl: 'https://made-up.example/rounds' };
    const research = await createResearcher({ ...options(claude(answer).client), webSearch: async () => [RESULT] })(game);
    expect(research).not.toHaveProperty('citation');
    expect(research?.webSearched).toBe(true);
  });

  it('carries on without web results when the search fails', async () => {
    const { client, calls } = claude(ANSWER);
    const research = await createResearcher({
      ...options(client),
      webSearch: async () => {
        throw new Error('Tavily search failed: HTTP 432 (plan limit reached)');
      },
    })(game);
    expect(research).toMatchObject({ onlinePlayers: 2, mod: { name: 'Rounds With Friends' } });
    expect(research).not.toHaveProperty('webSearched');
    expect(JSON.stringify(calls[0]?.body)).not.toContain('Web search results');
  });
});

describe('toResearch', () => {
  const text = sourceText(game, wiki);

  it("drops mod links to sites that aren't mod hosts, and out-of-range numbers", () => {
    const research = toResearch(
      { onlinePlayers: 5000, localPlayers: -1, mod: { name: '**Rounds With Friends**', maxPlayers: 16, url: 'https://evil.example/mod' }, onlyOneCopyNeeded: 'yes' },
      { sources: [], text: `${text} https://evil.example/mod` },
    );
    expect(research).toEqual({
      onlinePlayers: undefined,
      localPlayers: undefined,
      mod: { name: 'Rounds With Friends', maxPlayers: 16 },
      onlyOneCopyNeeded: false,
      sources: [],
    });
  });

  it('accepts mod pages on Thunderstore, Nexus Mods, GitHub and the Steam Workshop that the text links', () => {
    for (const url of [
      'https://thunderstore.io/c/rounds/p/olavim/RoundsWithFriends/',
      'https://www.nexusmods.com/towerfall/mods/1',
      'https://github.com/Senyksia/InfiniteFriends',
      'https://steamcommunity.com/sharedfiles/filedetails/?id=1',
    ]) {
      expect(toResearch({ mod: { name: 'Big Lobby', url } }, { sources: [], text: `Big Lobby mod: ${url}` })?.mod?.url).toBe(url);
    }
  });

  it("rejects mod names that aren't in the text, placeholders, and links posing as names", () => {
    const context = { sources: [], text: 'None of the mods. Rounds With Friends (https://x.io)' };
    for (const name of ['Totally Real Mod', 'None', 'Rounds With Friends https://evil.example']) {
      expect(toResearch({ mod: { name } }, context)).not.toHaveProperty('mod');
    }
  });

  it('only accepts a mod URL as a whole token, not the start of a longer one', () => {
    const url = 'https://thunderstore.io/c/rounds/p/a/Mod/';
    const context = { sources: [], text: `Mod at ${url}extra` };
    expect(toResearch({ mod: { name: 'Mod', url } }, context)?.mod).not.toHaveProperty('url');
  });

  it('ignores answers that are not objects', () => {
    expect(toResearch('8 players', { sources: [], text })).toBeUndefined();
  });
});

describe('statesCount', () => {
  it('needs the number near a word about players', () => {
    expect(statesCount('Up to 8 players online.', 8)).toBe(true);
    expect(statesCount('Battle with up to eight friends.', 8)).toBe(true);
    expect(statesCount('Released in 2020. Version 8 is out.', 8)).toBe(false);
  });

  it('ignores prices and decimals', () => {
    expect(statesCount('Only $4.99 for co-op fun!', 4)).toBe(false);
    expect(statesCount('Co-op rated 4.5 stars', 4)).toBe(false);
  });
});
