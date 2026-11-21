import { describe, expect, it } from 'vitest';
import { multiplayerFields, pcgwMultiplayer, wikiToText } from './pcgamingwiki.ts';

// Trimmed from the real ROUNDS page.
const ROUNDS = `{{Infobox game}}
==Network==
{{Network/Multiplayer
|local play           = true
|local play players   = 2
|local play modes     = Versus
|local play notes     = [https://rounds.thunderstore.io/package/olavim/RoundsWithFriends/ Up to 16 players in local and private online lobbies via Rounds With Friends mod.] <ref>{{Refurl|url=https://rounds.thunderstore.io/package/olavim/RoundsWithFriends/|title=RoundsWithFriends|date=June 2022}}</ref>
|lan play             = false
|lan play players     =
|online play          = true
|online play players  = 2
|online play notes    = [https://rounds.thunderstore.io/package/olavim/RoundsWithFriends/ Up to 16 players in local and private online lobbies via Rounds With Friends mod.] <ref>{{Refurl|url=https://rounds.thunderstore.io/package/olavim/RoundsWithFriends/|title=RoundsWithFriends|date=June 2022}}</ref>
}}
==Other==`;

describe('multiplayerFields', () => {
  it("reads the template's fields, including ones with nested templates", () => {
    const fields = multiplayerFields(ROUNDS);
    expect(fields['online play players']).toBe('2');
    expect(fields['local play notes']).toContain('Rounds With Friends');
    expect(fields['lan play players']).toBe('');
    expect(Object.keys(fields)).not.toContain('==other==');
  });

  it('returns nothing for pages without the template', () => {
    expect(multiplayerFields('{{Infobox game}} no network section')).toEqual({});
  });
});

describe('wikiToText', () => {
  it('keeps link text and URL, and drops refs and templates', () => {
    expect(wikiToText("[https://x.io/mod Up to 16 players via '''Mod'''.] <ref>{{Refurl|url=x}}</ref><br>More")).toBe(
      'Up to 16 players via Mod. (https://x.io/mod) More',
    );
  });
});

describe('pcgwMultiplayer', () => {
  function wiki(page: string | undefined, wikitext = ROUNDS) {
    const urls: string[] = [];
    const fetchFn = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      urls.push(url.searchParams.get('action') ?? '');
      if (url.searchParams.get('action') === 'idlookup') {
        return new Response(JSON.stringify({ idlookup: page ? [{ title: { Page: page } }] : [] }));
      }
      return new Response(JSON.stringify({ parse: { wikitext: { '*': wikitext } } }));
    }) as typeof fetch;
    return { fetchFn, urls };
  }

  it('looks the game up by Steam app ID and reads its player counts and notes', async () => {
    const { fetchFn, urls } = wiki('Rounds');
    expect(await pcgwMultiplayer(1557740, fetchFn)).toEqual({
      page: 'Rounds',
      url: 'https://www.pcgamingwiki.com/wiki/Rounds',
      onlinePlayers: 2,
      localPlayers: 2,
      lanPlayers: undefined,
      notes:
        'Up to 16 players in local and private online lobbies via Rounds With Friends mod. (https://rounds.thunderstore.io/package/olavim/RoundsWithFriends/)',
    });
    expect(urls).toEqual(['idlookup', 'parse']);
  });

  it("returns undefined when there's no page, or the page has no multiplayer data", async () => {
    expect(await pcgwMultiplayer(1, wiki(undefined).fetchFn)).toBeUndefined();
    expect(await pcgwMultiplayer(1, wiki('Solo Game', '{{Infobox game}}').fetchFn)).toBeUndefined();
  });
});
