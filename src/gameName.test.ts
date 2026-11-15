import { describe, expect, it } from 'vitest';
import { cleanGameName, displayGameName, gameKey, normalizeGameName } from './gameName.ts';

describe('cleanGameName', () => {
  it.each([
    ['🎮 Hades II', 'Hades II'],
    ['[Hades II](https://store.steampowered.com/app/1145350)', 'Hades II'],
    ['<:steam:123456789> Lethal Company:', 'Lethal Company'],
    ['*Overcooked! 2*', 'Overcooked! 2'],
    ['__Baldur’s Gate 3__ —', 'Baldur’s Gate 3'],
    ['Stardew  Valley', 'Stardew Valley'],
    ['"Hades II"', 'Hades II'],
    ['“Overcooked!”', 'Overcooked!'],
    ['`Sky Noon`', 'Sky Noon'],
    ['**Spellsworn**.', 'Spellsworn'],
    ['<@123456789012345678>', ''],
    // Quotes and brackets are removed only in matching pairs around the whole name.
    ["'Skribbl.io'", 'Skribbl.io'],
    ['‘Gartic Phone’', 'Gartic Phone'],
    ['(Codenames)', 'Codenames'],
    ['[Among Us]', 'Among Us'],
    ['«Hades»', 'Hades'],
    ['_Hades_', 'Hades'],
    ['"Hades II."', 'Hades II'],
    ['Jackbox Party Pack 3 "Trivia Murder Party"', 'Jackbox Party Pack 3 "Trivia Murder Party"'],
    ['Hades_II', 'Hades_II'],
    ['"Hades II', 'Hades II'],
  ])('%s -> %s', (raw, expected) => {
    expect(cleanGameName(raw)).toBe(expected);
  });
});

describe('displayGameName', () => {
  it('drops trademark symbols', () => {
    expect(displayGameName('Apex Legends™')).toBe('Apex Legends');
    expect(displayGameName('Tom Clancy’s Rainbow Six® Siege')).toBe('Tom Clancy’s Rainbow Six Siege');
  });
});

describe('normalizeGameName', () => {
  it('ignores case, punctuation, trademark symbols and accents', () => {
    expect(normalizeGameName('Baldur’s Gate™ 3')).toBe(normalizeGameName('baldurs gate 3'));
    expect(normalizeGameName('Pokémon')).toBe('pokemon');
  });

  it('treats roman numerals and digits alike', () => {
    expect(normalizeGameName('Hades II')).toBe(normalizeGameName('hades 2'));
  });

  it('matches names that differ only in punctuation', () => {
    expect(normalizeGameName('Deceive Inc.')).toBe(normalizeGameName('Deceive Inc'));
    expect(normalizeGameName('8-Player SpiderHeck')).toBe(normalizeGameName('8 player spiderheck'));
  });
});

describe('gameKey', () => {
  it('also ignores spacing', () => {
    expect(gameKey('PowerWash Simulator')).toBe(gameKey('Power Wash Simulator'));
    expect(gameKey('Skribbl.io')).toBe(gameKey('skribblio'));
    expect(gameKey('Left 4 Dead 2')).not.toBe(gameKey('Left 4 Dead'));
  });

  it('is empty for names with no Latin letters or digits', () => {
    expect(gameKey('原神')).toBe('');
  });
});
