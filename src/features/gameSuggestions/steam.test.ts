import { describe, expect, it } from 'vitest';
import { isUnwantedExtra, pickMatch, shortenAbout, steamAppIdFromLink, toSteamGame } from './steam.ts';

const item = (id: number, name: string) => ({ id, name });

describe('pickMatch', () => {
  it('prefers an exact name match, treating II and 2 alike', () => {
    const match = pickMatch('hades 2', [item(1, 'Hades II'), item(2, 'Hades II Original Soundtrack')]);
    expect(match).toMatchObject({ item: { name: 'Hades II' }, exact: true, others: [] });
  });

  it('picks the shortest name containing the query when there is no exact match', () => {
    const match = pickMatch('deep rock', [
      item(1, 'Deep Rock Galactic: Rogue Core'),
      item(2, 'Deep Rock Galactic'),
      item(3, 'Deep Rock Galactic: Survivor'),
    ]);
    expect(match?.item.name).toBe('Deep Rock Galactic');
    expect(match?.exact).toBe(false);
    expect(match?.others.map((o) => o.name)).toEqual(['Deep Rock Galactic: Rogue Core', 'Deep Rock Galactic: Survivor']);
  });

  it('skips soundtracks and demos unless asked for', () => {
    const items = [item(1, 'The Jackbox Party Pack 9 Demo'), item(2, 'The Jackbox Party Pack 9')];
    expect(pickMatch('jackbox party pack 9', items)?.item.id).toBe(2);
    expect(pickMatch('jackbox party pack 9 demo', items)?.item.id).toBe(1);
  });

  it('returns nothing for no results', () => {
    expect(pickMatch('zzqq', [])).toBeUndefined();
  });

  it('treats names that differ only in spacing as exact', () => {
    expect(pickMatch('power wash simulator', [item(1, 'PowerWash Simulator')])).toMatchObject({ exact: true });
  });

  it("never treats a name with no Latin letters as exact, and falls back to Steam's top result", () => {
    expect(pickMatch('原神', [item(1, '崩坏：星穹铁道'), item(2, '原神')])).toMatchObject({ item: { id: 1 }, exact: false });
  });
});

describe('steamAppIdFromLink', () => {
  it.each([
    ['https://store.steampowered.com/app/1145350/Hades_II/', 1145350],
    ['<https://store.steampowered.com/app/569530>', 569530],
    ['https://steamcommunity.com/app/360620/discussions/', 360620],
    ['Hades II', undefined],
    ['https://example.com/app/123', undefined],
  ])('%s -> %s', (text, expected) => {
    expect(steamAppIdFromLink(text)).toBe(expected);
  });
});

describe('isUnwantedExtra', () => {
  it('flags add-ons unless the query asks for them', () => {
    expect(isUnwantedExtra('Hades II Original Soundtrack', 'hades')).toBe(true);
    expect(isUnwantedExtra('Hades II', 'hades')).toBe(false);
    expect(isUnwantedExtra('Plucked Demo', 'plucked demo')).toBe(false);
  });
});

describe('toSteamGame', () => {
  it('summarises price, release and multiplayer modes', () => {
    const game = toSteamGame(1145350, {
      name: 'Hades II',
      is_free: false,
      short_description: 'Battle beyond the Underworld &amp; more',
      price_overview: { final_formatted: '$19.99', discount_percent: 33 },
      release_date: { coming_soon: false, date: 'Sep 25, 2025' },
      categories: [{ id: 2, description: 'Single-player' }],
    });
    expect(game).toMatchObject({
      url: 'https://store.steampowered.com/app/1145350/',
      description: 'Battle beyond the Underworld & more',
      price: '$19.99 (-33%)',
      multiplayer: [],
    });
  });

  it('lists specific multiplayer modes', () => {
    const game = toSteamGame(1, {
      name: 'Apex',
      is_free: true,
      categories: [1, 49, 36, 9, 38].map((id) => ({ id, description: '' })),
    });
    expect(game.multiplayer).toEqual(['Online Co-op', 'Online PvP']);
    expect(game.isFree).toBe(true);
  });
});

describe('toSteamGame platform and text', () => {
  it('reads Mac support, features and the About text', () => {
    const game = toSteamGame(1, {
      name: 'G',
      is_free: false,
      platforms: { windows: true, mac: true },
      categories: [{ id: 44, description: 'Remote Play Together' }],
      about_the_game: '<p>Fight with <b>up to 8</b> players &amp; friends.</p><br>More.',
    });
    expect(game).toMatchObject({ mac: true, features: ['Remote Play Together'] });
    expect(game.about).toBe('Fight with up to 8 players & friends.\nMore.');
  });
});

describe('shortenAbout', () => {
  it('keeps sentences about players when the text is too long', () => {
    const story = 'Long story sentence here. '.repeat(400);
    const short = shortenAbout(`${story}Up to 8 players online.`);
    expect(short.length).toBeLessThanOrEqual(4000);
    expect(short.startsWith('Up to 8 players online.')).toBe(true);
  });
});
