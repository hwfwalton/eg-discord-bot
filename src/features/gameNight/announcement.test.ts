import { describe, expect, it } from 'vitest';
import { cleanGameName, readAnnouncement } from './announcement.ts';

describe('readAnnouncement', () => {
  it('takes the first bolded text as the game', () => {
    expect(readAnnouncement('@everyone This Saturday we are playing **Hades II**! Bring snacks.')).toEqual({
      kind: 'game',
      game: 'Hades II',
    });
  });

  it('handles multi-line posts and bold-italic', () => {
    const post = '@everyone\n🎮 Game night this week:\n***Lethal Company***\nSee you at 10:30!';
    expect(readAnnouncement(post)).toEqual({ kind: 'game', game: 'Lethal Company' });
  });

  it.each([
    'No game this week, see you next Saturday!',
    'Game night is CANCELLED this week',
    'Heads up: no session on Saturday.',
    "We're skipping this week, sorry all",
    'Taking the week off — back on the 28th',
    'Taking a break for the holidays',
  ])('spots a cancellation: %s', (post) => {
    expect(readAnnouncement(post).kind).toBe('cancelled');
  });

  it('treats a cancellation as winning over a bolded name', () => {
    expect(readAnnouncement('**Hades II** is canceled, we will play it next week')).toEqual({
      kind: 'cancelled',
      phrase: 'canceled',
    });
  });

  it('is unclear when there is neither a bold name nor a cancellation', () => {
    expect(readAnnouncement('@everyone The server rules have been updated.')).toEqual({ kind: 'unclear' });
  });

  it('does not mistake ordinary words for cancellations', () => {
    expect(readAnnouncement("Don't skip the tutorial in **Factorio**").kind).toBe('game');
    expect(readAnnouncement('No need to bring anything, we play **Jackbox**').kind).toBe('game');
  });

  it('skips bold spans that are only decoration', () => {
    expect(readAnnouncement('**@everyone** we play **Deep Rock Galactic**')).toEqual({
      kind: 'game',
      game: 'Deep Rock Galactic',
    });
  });
});

describe('cleanGameName', () => {
  it.each([
    ['🎮 Hades II', 'Hades II'],
    ['[Hades II](https://store.steampowered.com/app/1145350)', 'Hades II'],
    ['<:steam:123456789> Lethal Company:', 'Lethal Company'],
    ['*Overcooked! 2*', 'Overcooked! 2'],
    ['__Baldur’s Gate 3__ —', 'Baldur’s Gate 3'],
    ['Stardew  Valley', 'Stardew Valley'],
  ])('%s -> %s', (raw, expected) => {
    expect(cleanGameName(raw)).toBe(expected);
  });
});
