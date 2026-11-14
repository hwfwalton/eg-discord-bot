import { describe, expect, it } from 'vitest';
import { normalize, pickMatch, toSteamGame } from './steam.ts';

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
});

describe('normalize', () => {
  it('ignores case, punctuation, trademark symbols and accents', () => {
    expect(normalize('Baldur’s Gate™ 3')).toBe(normalize("baldurs gate 3"));
    expect(normalize('Pokémon')).toBe('pokemon');
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
