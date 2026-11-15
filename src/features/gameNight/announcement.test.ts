import { describe, expect, it } from 'vitest';
import { readAnnouncement, sessionLabelsIn, steamLinkFor } from './announcement.ts';

// Modelled on the format of the weekly #announcements posts (the wording is made up).
const weekly = (game: string, extra = '') =>
  `@everyone\nFor EG288 (11/14 @ 10:30am PT/1:30pm ET) we'll be playing...\n**${game}**!\n\n` +
  `${game} is a coop roguelite!\n\n**${game} is free on Steam (PC only)!**\n` +
  `https://store.steampowered.com/app/5367360/Plucked_Demo/\n\n${extra}**Looking forward to it!**`;

describe('readAnnouncement', () => {
  it('reads the game, session label and Steam link from the weekly template', () => {
    expect(readAnnouncement(weekly('Plucked Demo'))).toEqual({
      kind: 'game',
      game: 'Plucked Demo',
      label: 'EG288',
      link: 'https://store.steampowered.com/app/5367360/Plucked_Demo/',
    });
  });

  it('finds the game even when other bold text comes first', () => {
    const post =
      "@everyone \n**Thanks to everyone who filled out the poll!**\n" +
      '**EG273 is TOMORROW, Saturday (7/18) at 10:30am!**\n\n' +
      "For EG273 we'll be playing...\n**DRAWCERY Demo**!\n";
    expect(readAnnouncement(post)).toMatchObject({ kind: 'game', game: 'DRAWCERY Demo', label: 'EG273' });
  });

  it('handles curly apostrophes, an ellipsis character and strikethrough times', () => {
    const post = "For EG287 (10/31 @ ~~11am PT~~ 10:30am PT) we’ll be playing…\n**One-armed robber**!";
    expect(readAnnouncement(post)).toMatchObject({ game: 'One-armed robber', label: 'EG287' });
  });

  it('works without a label or link', () => {
    expect(readAnnouncement("This week we'll be playing: **Sky Noon**")).toEqual({ kind: 'game', game: 'Sky Noon' });
  });

  it('lets the template win over stray cancel words in the blurb', () => {
    expect(readAnnouncement(weekly('Sky Noon', 'Remember you can animation cancel the grapple!\n')).kind).toBe('game');
  });

  it.each([
    "@everyone\n**No official EG this weekend (11/6)!**\nI'm traveling, see you all next week.",
    "@everyone\n**Sorry all, I have to cancel tomorrow's EG284!**",
    'No EG this week, see you next Saturday!',
    'Game night is CANCELLED this week',
    "We're skipping this week, sorry all",
    'Taking the weekend off, back on the 28th',
  ])('spots a cancellation: %s', (post) => {
    expect(readAnnouncement(post).kind).toBe('cancelled');
  });

  it.each([
    // Saturday-morning reminder: bold text, but not the template, and not a cancellation.
    "@everyone \nHeads up: **EG273 starts in one hour, 10:30am PT (1:30pm ET)!**\n\nWe'll be playing DRAWCERY Demo (PC only)!",
    // Survey / other news.
    "Hey @everyone !\n**Time for a scheduling poll!**\n**Please vote for the times that work for you.**",
  ])('treats non-weekly posts as unclear: %s', (post) => {
    expect(readAnnouncement(post)).toEqual({ kind: 'unclear' });
  });

  it('does not mistake ordinary words for cancellations', () => {
    expect(readAnnouncement('No need to bring anything, there are snacks').kind).toBe('unclear');
  });
});

describe('steamLinkFor', () => {
  const sky = 'https://store.steampowered.com/app/569530/Sky_Noon/';
  const spells = 'https://store.steampowered.com/app/360620/Spellsworn/';

  it("picks the link whose URL names the game", () => {
    expect(steamLinkFor(`Instead of ${sky} we play ${spells}`, 'Spellsworn')).toBe(spells);
    expect(steamLinkFor(`Instead of ${sky} we play ${spells}`, 'Sky Noon')).toBe(sky);
  });

  it("uses a post's only link even if its URL has no name", () => {
    expect(steamLinkFor('Play it: https://store.steampowered.com/app/569530', 'Sky Noon')).toBe('https://store.steampowered.com/app/569530');
  });

  it('gives no link when several games are linked and none matches', () => {
    expect(steamLinkFor(`${sky} ${spells}`, 'Hades II')).toBeUndefined();
    expect(steamLinkFor('no links here', 'Hades II')).toBeUndefined();
  });
});

describe('sessionLabelsIn', () => {
  it('finds session names however they are spaced', () => {
    expect(sessionLabelsIn('EG289 (or eg 290?) and EG 291')).toEqual(new Set(['EG289', 'EG290', 'EG291']));
  });
});
