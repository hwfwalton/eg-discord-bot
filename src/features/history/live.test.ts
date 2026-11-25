import { Cron } from 'croner';
import { describe, expect, it } from 'vitest';
import { createSchedule } from '../gameNight/plan.ts';
import {
  type AnnouncementPost,
  type LiveOptions,
  costFromPost,
  localDate,
  localStart,
  nextUp,
  resolveGames,
  sessionsSince,
  timezoneLabel,
} from './live.ts';
import { AUTO_SOURCE } from './types.ts';

// Everything here is made up: the sessions, dates, prices and app IDs (the game titles are real).
// 2030: Saturdays are Feb 2, 9, 16, 23 and Mar 2, 9, 16; Pacific daylight time runs Mar 10 - Nov 3.
const timezone = 'America/Los_Angeles';
const schedule = createSchedule('30 10 * * 6', timezone);

function post(content: string, createdAt: string, authorName = 'Rowan'): AnnouncementPost {
  return { id: createdAt, url: `https://discord.com/x/${createdAt}`, authorId: '1', authorName, content, createdAt: new Date(createdAt) };
}

const weekly = (label: string, game: string, rest = '') =>
  `@everyone\nFor ${label} (2/2 @ 10:30am PT/1:30pm ET) we'll be playing...\n**${game}**!\n\n${rest}`;

function options(posts: AnnouncementPost[], after: string, now: string, knownGames: string[] = []): LiveOptions {
  return { posts, schedule, timezone, after, now: new Date(now), knownGames };
}

describe('sessionsSince', () => {
  it('lets a later post call the week off only if it says "cancel"', async () => {
    const announcement = post(weekly('EG501', 'Sky Noon'), '2030-01-31T20:00:00Z');
    const after = (content: string) =>
      sessionsSince(options([announcement, post(content, '2030-02-01T20:00:00Z')], '2030-01-26', '2030-02-03T00:00:00Z', ['Sky Noon']));

    // "No game ..." and "no events ..." read as calling it off, but these posts don't.
    for (const chatter of ['Reminder: no game purchase needed, the demo is free.', 'Heads up: the clips channel is new. No events are affected.']) {
      expect((await after(chatter)).map((s) => [s.row.status, s.row.session, s.row.games])).toEqual([['Played', 'EG501', ['Sky Noon']]]);
    }
    // A real cancellation keeps what had been planned on the row.
    expect((await after('Sorry all, I have to cancel EG501!')).map((s) => [s.row.status, s.row.games, s.row.planned])).toEqual([
      ['Cancelled', [], ['Sky Noon']],
    ]);
    // With no announcement that week, "no official EG" still means a week off.
    const alone = await sessionsSince(options([post('**No official EG this weekend!**', '2030-02-01T20:00:00Z')], '2030-01-26', '2030-02-03T00:00:00Z'));
    expect(alone.map((s) => [s.row.status, s.row.planned])).toEqual([['No session', []]]);
  });

  it('makes a row for each week that was announced or called off', async () => {
    const posts = [
      // Given newest first, like a channel fetch: the order doesn't matter.
      post(
        weekly('EG502', 'Haste Demo', 'The demo is free on Steam!\nhttps://store.steampowered.com/app/4100200/Haste_Demo/'),
        '2030-02-28T20:00:00Z',
      ),
      // Nothing was posted for Feb 23.
      post("@everyone\n**Sorry all, I have to cancel tomorrow's EG502!**", '2030-02-15T20:00:00Z', 'Mika'),
      post(weekly('EG502', 'Haste Demo'), '2030-02-13T20:00:00Z'),
      post("@everyone\n**No official EG this weekend (2/9)!**\nI'm away, see you all next week.", '2030-02-06T20:00:00Z'),
      post(
        weekly('EG501', 'Sky Noon', 'Sky Noon is $4.99 on Steam!\nhttps://store.steampowered.com/app/569530/Sky_Noon/'),
        '2030-01-31T20:00:00Z',
      ),
    ];

    const sessions = await sessionsSince(options(posts, '2030-01-26', '2030-03-03T00:00:00Z', ['Sky Noon']));

    expect(sessions).toStrictEqual([
      {
        row: {
          session: 'EG501',
          date: '2030-02-02',
          start: '10:30am',
          status: 'Played',
          games: ['Sky Noon'],
          planned: [],
          cost: '$4.99',
          announcedBy: 'Rowan',
          source: AUTO_SOURCE,
        },
        newGames: [],
      },
      {
        row: { date: '2030-02-09', status: 'No session', games: [], planned: [], announcedBy: 'Rowan', source: AUTO_SOURCE },
        newGames: [],
      },
      {
        row: { date: '2030-02-16', status: 'Cancelled', games: [], planned: ['Haste'], announcedBy: 'Mika', source: AUTO_SOURCE },
        newGames: [],
      },
      {
        row: {
          session: 'EG502',
          date: '2030-03-02',
          start: '10:30am',
          status: 'Played',
          games: ['Haste'],
          planned: [],
          cost: 'Free (demo)',
          announcedBy: 'Rowan',
          source: AUTO_SOURCE,
          notes: 'Demo',
        },
        link: 'https://store.steampowered.com/app/4100200/',
        newGames: ['Haste'],
      },
    ]);
  });

  it('tells a cancelled session from a week off by the wording', async () => {
    const posts = [
      post('Game night is CANCELLED this week', '2030-01-31T20:00:00Z'),
      post("We're skipping this week, sorry all", '2030-02-06T20:00:00Z'),
    ];
    const sessions = await sessionsSince(options(posts, '2030-01-26', '2030-02-10T00:00:00Z'));
    expect(sessions.map((s) => s.row.status)).toEqual(['Cancelled', 'No session']);
  });

  it('reads posts with the template only: a game named any other way gets no row', async () => {
    // Claude would read this one for the start post, but the record has to come out the same every time.
    const posts = [post("This Saturday we're on Sky Noon at 10:30, see you all there!", '2030-01-31T20:00:00Z')];
    expect(await sessionsSince(options(posts, '2030-01-26', '2030-02-03T00:00:00Z'))).toEqual([]);
  });

  it('takes only a plain store address and a plain name from a hostile post', async () => {
    const links =
      '[store](javascript:alert(1)) https://store.steampowered.com.evil.example/app/1/ ' +
      'https://store.steampowered.com/app/77/x"onmouseover="alert(1)/?next=//evil.example';
    const posts = [post(weekly('EG501', '=HYPERLINK("http://evil.example","x")', links), '2030-01-31T20:00:00Z')];
    const [session] = await sessionsSince(options(posts, '2030-01-26', '2030-02-03T00:00:00Z'));
    expect(session?.link).toBe('https://store.steampowered.com/app/77/');
    // A cell that starts with = + - or @ is a formula to a spreadsheet app.
    expect(session?.row.games).toEqual(['HYPERLINK("http://evil.example","x")']);

    const noStore = [post(weekly('EG501', 'Haste', '[store](javascript:alert(1)) http://store.steampowered.com/app/77/'), '2030-01-31T20:00:00Z')];
    const [other] = await sessionsSince(options(noStore, '2030-01-26', '2030-02-03T00:00:00Z'));
    expect(other?.newGames).toEqual(['Haste']);
    expect(other).not.toHaveProperty('link');
  });

  it('gives the same rows whatever order two posts of the same moment come in', async () => {
    // Discord's message IDs count up, so the higher one was posted later (19 digits is more than 18).
    const announced = { ...post(weekly('EG501', 'Sky Noon'), '2030-01-31T20:00:00Z'), id: '999999999999999999' };
    const calledOff = { ...post('No EG this week after all, sorry!', '2030-01-31T20:00:00Z', 'Mika'), id: '1000000000000000000' };
    for (const posts of [
      [announced, calledOff],
      [calledOff, announced],
    ]) {
      const [session] = await sessionsSince(options(posts, '2030-01-26', '2030-02-03T00:00:00Z'));
      expect(session?.row).toMatchObject({ status: 'No session', announcedBy: 'Mika' });
      expect(await nextUp({ posts, schedule, timezone, now: new Date('2030-02-01T00:00:00Z'), knownGames: [] })).toMatchObject({
        status: 'cancelled',
      });
    }
  });

  it('makes no row from posts that say nothing', async () => {
    const posts = [post('', '2030-01-31T20:00:00Z'), post(' \n\t ', '2030-02-01T20:00:00Z'), post('@everyone', '2030-02-02T17:00:00Z')];
    expect(await sessionsSince(options(posts, '2030-01-26', '2030-02-03T00:00:00Z'))).toEqual([]);
  });

  it('is not changed by the same post being given twice', async () => {
    const announcement = post(weekly('EG501', 'Haste'), '2030-01-31T20:00:00Z');
    const sessions = await sessionsSince(options([announcement, { ...announcement }, announcement], '2030-01-26', '2030-02-03T00:00:00Z'));
    expect(sessions.map((s) => [s.row.session, s.newGames])).toEqual([['EG501', ['Haste']]]);
  });

  it('skips a post whose time is not a date', async () => {
    const broken = { ...post(weekly('EG500', 'Witch It!'), '2030-01-31T21:00:00Z'), createdAt: new Date(Number.NaN) };
    const posts = [broken, post(weekly('EG501', 'Sky Noon'), '2030-01-31T20:00:00Z')];
    const sessions = await sessionsSince(options(posts, '2030-01-26', '2030-02-03T00:00:00Z'));
    expect(sessions.map((s) => s.row.session)).toEqual(['EG501']);
    expect(await nextUp({ posts, schedule, timezone, now: new Date('2030-02-01T00:00:00Z'), knownGames: [] })).toMatchObject({
      session: 'EG501',
    });
  });

  it('gives a week off no session name, start or cost, whatever the post mentions', async () => {
    const posts = [post("@everyone\n**No EG502 this Saturday (2/2 @ 10:30am PT)!** Sky Noon is $4.99 if you want it for next time.", '2030-01-31T20:00:00Z')];
    const [session] = await sessionsSince(options(posts, '2030-01-26', '2030-02-03T00:00:00Z', ['Sky Noon']));
    expect(session).toStrictEqual({
      row: { date: '2030-02-02', status: 'No session', games: [], planned: [], announcedBy: 'Rowan', source: AUTO_SOURCE },
      newGames: [],
    });
  });

  it('leaves out a row with no label, cost or author rather than writing empty values', async () => {
    const posts = [post("This week we'll be playing: **Sky Noon**", '2030-01-31T20:00:00Z', '')];
    const [session] = await sessionsSince(options(posts, '2030-01-26', '2030-02-03T00:00:00Z', ['Sky Noon']));
    expect(session?.row).toStrictEqual({
      date: '2030-02-02',
      start: '10:30am',
      status: 'Played',
      games: ['Sky Noon'],
      planned: [],
      source: AUTO_SOURCE,
    });
  });

  describe('which sessions', () => {
    const announcement = post(weekly('EG501', 'Sky Noon'), '2030-01-31T20:00:00Z');

    it('returns only sessions on a later date than the last row', async () => {
      expect(await sessionsSince(options([announcement], '2030-02-02', '2030-02-03T00:00:00Z'))).toEqual([]);
      const sessions = await sessionsSince(options([announcement], '2030-02-01', '2030-02-03T00:00:00Z'));
      expect(sessions.map((s) => s.row.date)).toEqual(['2030-02-02']);
    });

    it('compares the local date, not the UTC one', async () => {
      // Saturday 6pm Pacific is already Sunday in UTC, but the record says Saturday.
      const evening = createSchedule('0 18 * * 6', timezone);
      const base = { posts: [announcement], schedule: evening, timezone, now: new Date('2030-02-04T00:00:00Z'), knownGames: [] };
      expect(await sessionsSince({ ...base, after: '2030-02-02' })).toEqual([]);
      const [session] = await sessionsSince({ ...base, after: '2030-02-01' });
      expect(session?.row).toMatchObject({ date: '2030-02-02', start: '6pm' });
    });

    it("doesn't miss a session whose local day starts long before the UTC day", async () => {
      // 00:30 on Saturday in UTC+14 is 10:30 on Friday in UTC.
      const kiritimati = 'Pacific/Kiritimati';
      const base = {
        posts: [announcement],
        schedule: createSchedule('30 0 * * 6', kiritimati),
        timezone: kiritimati,
        now: new Date('2030-02-04T00:00:00Z'),
        knownGames: [],
      };
      const [session] = await sessionsSince({ ...base, after: '2030-02-01' });
      expect(session?.row).toMatchObject({ date: '2030-02-02', start: '12:30am' });
      expect(await sessionsSince({ ...base, after: '2030-02-02' })).toEqual([]);
    });

    it("leaves out a session that hasn't started yet", async () => {
      expect(await sessionsSince(options([announcement], '2030-01-26', '2030-02-02T18:29:59Z'))).toEqual([]);
      expect(await sessionsSince(options([announcement], '2030-01-26', '2030-02-02T18:30:00Z'))).toHaveLength(1);
    });

    it('returns nothing when "now" is not a date', async () => {
      const base = options([announcement], '2030-01-26', '2030-02-03T00:00:00Z');
      expect(await sessionsSince({ ...base, now: new Date(Number.NaN) })).toEqual([]);
    });

    it('counts a post made at the very start for that session, and one a moment later for the next', async () => {
      const atStart = post(weekly('EG501', 'Sky Noon'), '2030-02-02T18:30:00.000Z');
      const justAfter = post(weekly('EG502', 'Witch It!'), '2030-02-02T18:30:00.400Z');
      for (const after of ['2030-01-26', '']) {
        const sessions = await sessionsSince(options([justAfter, atStart], after, '2030-02-10T00:00:00Z'));
        expect(sessions.map((s) => [s.row.date, s.row.session])).toEqual([
          ['2030-02-02', 'EG501'],
          ['2030-02-09', 'EG502'],
        ]);
      }
    });

    it('looks at 260 sessions at most, and carries on from there next time', async () => {
      const starts = schedule.nextRuns(261, new Date('2030-01-01T00:00:00Z'));
      const posts = starts.map((start, week) =>
        post(weekly(`EG${601 + week}`, 'Sky Noon'), new Date(start.getTime() - 24 * 3600_000).toISOString()),
      );
      const now = new Date((starts[260]?.getTime() ?? 0) + 3600_000);

      const first = await sessionsSince({ posts, schedule, timezone, after: '2030-01-01', now, knownGames: ['Sky Noon'] });
      expect(first).toHaveLength(260);
      expect([first[0]?.row.session, first.at(-1)?.row.session]).toEqual(['EG601', 'EG860']);

      const after = first.at(-1)?.row.date ?? '';
      const second = await sessionsSince({ posts, schedule, timezone, after, now, knownGames: ['Sky Noon'] });
      expect(second.map((s) => s.row.session)).toEqual(['EG861']);
    });

    it("doesn't spend the 260 on weeks nobody posted in", async () => {
      // Ten silent years between the channel's first post and the first announcement: if the
      // silence used up the cap, there would never be a row to carry on from.
      const welcome = post('Welcome! Please read the rules before posting.', '2020-01-06T20:00:00Z');
      const later = post(weekly('EG502', 'Witch It!'), '2035-06-07T20:00:00Z');
      for (const after of ['', '2019-01-05']) {
        const sessions = await sessionsSince(options([later, welcome, announcement], after, '2035-06-10T00:00:00Z'));
        expect(sessions.map((s) => [s.row.date, s.row.session])).toEqual([
          ['2030-02-02', 'EG501'],
          ['2035-06-09', 'EG502'],
        ]);
      }
    });

    it('keeps the local date of an evening session on New Year\'s Eve and on a leap day', async () => {
      // Tuesdays at 8pm Pacific, which is already the next day (and the next year) in UTC.
      const tuesdays = createSchedule('0 20 * * 2', timezone);
      const base = { schedule: tuesdays, timezone, knownGames: [] };

      const newYear = [post(weekly('EG548', 'Sky Noon'), '2030-12-30T20:00:00Z'), post(weekly('EG549', 'Sky Noon'), '2031-01-06T20:00:00Z')];
      const around = { ...base, posts: newYear, now: new Date('2031-01-09T00:00:00Z') };
      const sessions = await sessionsSince({ ...around, after: '2030-12-24' });
      expect(sessions.map((s) => [s.row.date, s.row.start, s.row.session])).toEqual([
        ['2030-12-31', '8pm', 'EG548'],
        ['2031-01-07', '8pm', 'EG549'],
      ]);
      expect((await sessionsSince({ ...around, after: '2030-12-31' })).map((s) => s.row.date)).toEqual(['2031-01-07']);

      const leap = [post(weekly('EG401', 'Sky Noon'), '2028-02-28T20:00:00Z'), post(weekly('EG402', 'Sky Noon'), '2028-03-06T20:00:00Z')];
      const leapYear = await sessionsSince({ ...base, posts: leap, now: new Date('2028-03-09T00:00:00Z'), after: '2028-02-22' });
      expect(leapYear.map((s) => s.row.date)).toEqual(['2028-02-29', '2028-03-07']);
    });

    it('starts at the oldest post when the record is far behind or empty', async () => {
      for (const after of ['2001-06-30', '']) {
        const sessions = await sessionsSince(options([announcement], after, '2030-02-03T00:00:00Z'));
        expect(sessions.map((s) => s.row.date)).toEqual(['2030-02-02']);
      }
    });

    it("returns nothing when the last row's date can't be read (it might add weeks twice)", async () => {
      for (const after of ['2/1/2030', 'last week', '2030-02']) {
        expect(await sessionsSince(options([announcement], after, '2030-02-03T00:00:00Z'))).toEqual([]);
      }
    });

    it('returns nothing without posts', async () => {
      expect(await sessionsSince(options([], '2030-01-26', '2030-03-03T00:00:00Z'))).toEqual([]);
    });
  });

  describe('across daylight-saving changes', () => {
    it('stays at 10:30 when the clocks go back in early November', async () => {
      const posts = [
        post(weekly('EG540', 'Sky Noon'), '2030-10-31T20:00:00Z'),
        // 9:45am Pacific standard time on the day: before the start, but after 10:30 daylight time.
        post(weekly('EG541', 'Witch It!'), '2030-11-09T17:45:00Z'),
      ];
      const sessions = await sessionsSince(options(posts, '2030-10-26', '2030-11-10T00:00:00Z'));
      expect(sessions.map((s) => [s.row.date, s.row.start, s.row.session])).toEqual([
        ['2030-11-02', '10:30am', 'EG540'],
        ['2030-11-09', '10:30am', 'EG541'],
      ]);
    });

    it('stays at 10:30 when the clocks go forward in mid March', async () => {
      const posts = [post(weekly('EG506', 'Sky Noon'), '2030-03-07T20:00:00Z'), post(weekly('EG507', 'Witch It!'), '2030-03-14T20:00:00Z')];
      // Exactly 10:30 daylight time on Mar 16: an hour before a hand-counted week would say.
      const sessions = await sessionsSince(options(posts, '2030-03-02', '2030-03-16T17:30:00Z'));
      expect(sessions.map((s) => [s.row.date, s.row.start, s.row.session])).toEqual([
        ['2030-03-09', '10:30am', 'EG506'],
        ['2030-03-16', '10:30am', 'EG507'],
      ]);
    });
  });

  it('lets the announcement decide when a reminder follows it in the same week', async () => {
    const posts = [
      post(weekly('EG501', 'Sky Noon', 'Sky Noon is $4.99 on Steam!'), '2030-01-31T20:00:00Z', 'Rowan'),
      post(
        "@everyone\nHeads up: **EG501 starts in one hour, 10:30am PT (1:30pm ET)!**\n\nWe'll be playing Sky Noon, and it's free this weekend!",
        '2030-02-02T17:30:00Z',
        'Mika',
      ),
    ];
    const sessions = await sessionsSince(options(posts, '2030-01-26', '2030-02-03T00:00:00Z'));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.row).toMatchObject({ session: 'EG501', games: ['Sky Noon'], cost: '$4.99', announcedBy: 'Rowan' });
  });

  describe('new games and links', () => {
    const now = '2030-02-10T00:00:00Z';
    const after = '2030-01-26';
    const haste = 'https://store.steampowered.com/app/4100200/Haste/';

    it('gives a new game its store link, without the name or tracking part', async () => {
      const posts = [post(weekly('EG501', 'Haste', `It's $9.99:\n${haste}?utm_source=discord`), '2030-01-31T20:00:00Z')];
      const [session] = await sessionsSince(options(posts, after, now, ['Sky Noon']));
      expect(session).toMatchObject({ row: { games: ['Haste'] }, link: 'https://store.steampowered.com/app/4100200/', newGames: ['Haste'] });
    });

    it('gives no link for a game the record already has', async () => {
      const posts = [post(weekly('EG501', 'haste', haste), '2030-01-31T20:00:00Z')];
      const [session] = await sessionsSince(options(posts, after, now, ['Haste']));
      expect(session).toMatchObject({ row: { games: ['Haste'] }, newGames: [] });
      expect(session).not.toHaveProperty('link');
    });

    it('gives no link for a week with two games', async () => {
      const posts = [post(weekly('EG501', 'Elevator and Frog Sqwad', haste), '2030-01-31T20:00:00Z')];
      const [session] = await sessionsSince(options(posts, after, now, ['Frog Sqwad', 'Elevator']));
      expect(session).toMatchObject({ row: { games: ['Elevator', 'Frog Sqwad'] }, newGames: [] });
      expect(session).not.toHaveProperty('link');
    });

    it("picks the game's own store page when the post links several", async () => {
      const rest = `If you liked https://store.steampowered.com/app/569530/Sky_Noon/ you'll like this:\n${haste}`;
      const [session] = await sessionsSince(options([post(weekly('EG501', 'Haste', rest), '2030-01-31T20:00:00Z')], after, now));
      expect(session?.link).toBe('https://store.steampowered.com/app/4100200/');
    });

    it('has no link when the post has none, or links other games', async () => {
      const others = 'https://store.steampowered.com/app/569530/Sky_Noon/ https://store.steampowered.com/app/360620/Spellsworn/';
      for (const rest of ['', others]) {
        const [session] = await sessionsSince(options([post(weekly('EG501', 'Haste', rest), '2030-01-31T20:00:00Z')], after, now));
        expect(session?.newGames).toEqual(['Haste']);
        expect(session).not.toHaveProperty('link');
      }
    });

    it('counts a game as new only the first time, and keeps its first spelling', async () => {
      const posts = [
        post(weekly('EG501', 'Haste', haste), '2030-01-31T20:00:00Z'),
        post(weekly('EG502', 'HASTE (again!)', haste), '2030-02-07T20:00:00Z'),
      ];
      const [first, second] = await sessionsSince(options(posts, after, now));
      expect(first).toMatchObject({ row: { games: ['Haste'] }, link: 'https://store.steampowered.com/app/4100200/', newGames: ['Haste'] });
      expect(second).toMatchObject({ row: { session: 'EG502', games: ['Haste'] }, newGames: [] });
      expect(second).not.toHaveProperty('link');
    });

    it('treats a name with no Latin letters as known only when it is written the same', async () => {
      const posts = [post(weekly('EG501', '原神'), '2030-01-31T20:00:00Z'), post(weekly('EG502', '原神'), '2030-02-07T20:00:00Z')];
      const sessions = await sessionsSince(options(posts, after, now, ['崩坏']));
      expect(sessions.map((s) => [s.row.games, s.newGames])).toEqual([
        [['原神'], ['原神']],
        [['原神'], []],
      ]);
    });

    it("doesn't change the list of known games it was given", async () => {
      const knownGames = ['Sky Noon'];
      await sessionsSince(options([post(weekly('EG501', 'Haste'), '2030-01-31T20:00:00Z')], after, now, knownGames));
      expect(knownGames).toEqual(['Sky Noon']);
    });
  });
});

describe('nextUp', () => {
  const now = '2030-01-31T22:00:00Z'; // Thursday; the next session is Saturday Feb 2
  const next = (posts: AnnouncementPost[], knownGames: string[] = []) => nextUp({ posts, schedule, timezone, now: new Date(now), knownGames });

  it('names the announced game in the spelling the record uses', async () => {
    const posts = [post(weekly('EG501', 'witch it'), '2030-01-31T20:00:00Z')];
    expect(await next(posts, ['Witch It!'])).toStrictEqual({
      date: '2030-02-02',
      start: '10:30am',
      status: 'announced',
      session: 'EG501',
      games: ['Witch It!'],
    });
  });

  it('drops the demo marker and splits a list of known games', async () => {
    expect(await next([post(weekly('EG501', 'Haste Demo'), '2030-01-31T20:00:00Z')])).toMatchObject({ games: ['Haste'] });
    const both = await next([post(weekly('EG501', 'Putt Party and Bobble League'), '2030-01-31T20:00:00Z')], ['Bobble League', 'Putt Party']);
    expect(both).toMatchObject({ status: 'announced', games: ['Putt Party', 'Bobble League'] });
  });

  it('says when the session is called off', async () => {
    const posts = [post(weekly('EG501', 'Sky Noon'), '2030-01-29T20:00:00Z'), post('Sorry, no game this week', '2030-01-31T20:00:00Z')];
    expect(await next(posts)).toStrictEqual({ date: '2030-02-02', start: '10:30am', status: 'cancelled', games: [] });
  });

  it("is unannounced until this week's post, whatever last week's said", async () => {
    const lastWeek = post(weekly('EG500', 'Sky Noon'), '2030-01-24T20:00:00Z');
    expect(await next([lastWeek])).toStrictEqual({ date: '2030-02-02', start: '10:30am', status: 'unannounced', games: [] });
    expect(await next([])).toMatchObject({ status: 'unannounced' });
  });

  it('looks past a session that has just started', async () => {
    const result = await nextUp({ posts: [], schedule, timezone, now: new Date('2030-02-02T18:30:00Z'), knownGames: [] });
    expect(result).toMatchObject({ date: '2030-02-09', start: '10:30am' });
  });

  it('stays at 10:30 local time on both sides of a daylight-saving change', async () => {
    // Pacific time, 2030: forward on Mar 10, back on Nov 3. The session after each is an hour off a hand-counted week.
    for (const [now, date] of [
      ['2030-03-09T18:30:00Z', '2030-03-16'],
      ['2030-03-16T17:29:59Z', '2030-03-16'],
      ['2030-11-02T17:30:00Z', '2030-11-09'],
      ['2030-11-09T18:29:59Z', '2030-11-09'],
    ] as const) {
      const result = await nextUp({ posts: [], schedule, timezone, now: new Date(now), knownGames: [] });
      expect(result).toMatchObject({ date, start: '10:30am' });
    }
  });

  it('is undefined when the schedule has no upcoming run', async () => {
    const ended = new Cron('30 10 * * 6', { timezone, paused: true, stopAt: '2029-12-31T00:00:00Z' });
    expect(await nextUp({ posts: [], schedule: ended, timezone, now: new Date(now), knownGames: [] })).toBeUndefined();
  });
});

describe('resolveGames', () => {
  it.each([
    ['Plucked Demo', 'Plucked'],
    ['DRAWCERY Demo', 'DRAWCERY'],
    ['Ultimate Sheep Raccoon (demo)', 'Ultimate Sheep Raccoon'],
    ["Burglin' Gnomes Demo", "Burglin' Gnomes"],
    ['Fishards - Demo', 'Fishards'],
    ['Haste: Demo', 'Haste'],
    ['Haste [DEMO]', 'Haste'],
    ['Haste Demo!', 'Haste'],
    ['Who\'s Your Daddy?! demos', "Who's Your Daddy?!"],
  ])('removes a trailing demo marker: %s', (announced, name) => {
    expect(resolveGames(announced, [])).toEqual({ games: [name], demo: true });
    expect(resolveGames(announced, ['Sky Noon', name])).toEqual({ games: [name], demo: true });
  });

  it.each(['Demo Derby Party', 'Demolition Derby', 'Tech Demo Tycoon', 'Demo'])('keeps "demo" elsewhere in a name: %s', (announced) => {
    expect(resolveGames(announced, [])).toEqual({ games: [announced], demo: false });
  });

  it.each([
    ['Witch It', 'Witch It!'],
    ['Meccha Chameleon', 'MECCHA CHAMELEON'],
    ['MECCHA CHAMELEON', 'MECCHA CHAMELEON'],
    ['Deceive Inc', 'Deceive Inc.'],
    ['power wash simulator', 'PowerWash Simulator'],
    ['  Sky Noon  ', 'Sky Noon'],
  ])('returns the known spelling: %s -> %s', (announced, known) => {
    expect(resolveGames(announced, ['Hades II', known])).toEqual({ games: [known], demo: false });
  });

  it('uses the first spelling when the record has a game twice, and ignores blank names', () => {
    expect(resolveGames('witch it', ['', '  ', 'Witch It!', 'Witch It', 'WITCH IT'])).toEqual({ games: ['Witch It!'], demo: false });
    expect(resolveGames('Haste', ['', '  '])).toEqual({ games: ['Haste'], demo: false });
  });

  it('matches names with quotes, commas and emoji in them', () => {
    const known = ["Who's Your Daddy?!", 'Rock, Paper, Scissors', '"Hello, World" Simulator', 'Elevator'];
    expect(resolveGames('Who’s your daddy', known)).toEqual({ games: ["Who's Your Daddy?!"], demo: false });
    expect(resolveGames('Rock Paper Scissors 🪨📄✂️', known)).toEqual({ games: ['Rock, Paper, Scissors'], demo: false });
    expect(resolveGames('Hello World Simulator', known)).toEqual({ games: ['"Hello, World" Simulator'], demo: false });
    // A known game with commas in its name is still one game in a list.
    expect(resolveGames('Rock, Paper, Scissors and Elevator', known)).toEqual({ games: ['Rock, Paper, Scissors', 'Elevator'], demo: false });
    // New names are kept as they were announced.
    expect(resolveGames('Papers, Please 🛂 "Deluxe"', known)).toEqual({ games: ['Papers, Please 🛂 "Deluxe"'], demo: false });
  });

  it('uses the known spelling of a demo too', () => {
    expect(resolveGames('drawcery demo', ['DRAWCERY'])).toEqual({ games: ['DRAWCERY'], demo: true });
  });

  it('tries again without a trailing parenthetical', () => {
    expect(resolveGames('ROUNDS (but now with more mods)', ['ROUNDS'])).toEqual({ games: ['ROUNDS'], demo: false });
    expect(resolveGames('Drawcery Demo (PC only)', ['DRAWCERY'])).toEqual({ games: ['DRAWCERY'], demo: true });
  });

  it('keeps the parenthetical of a game it has never seen', () => {
    expect(resolveGames('ROUNDS (but now with more mods)', ['Sky Noon'])).toEqual({
      games: ['ROUNDS (but now with more mods)'],
      demo: false,
    });
  });

  it.each([
    ['Elevator and Frog Sqwad', ['Elevator', 'Frog Sqwad']],
    ['Putt Party and Bobble League', ['Putt Party', 'Bobble League']],
    ['putt party & bobble league', ['Putt Party', 'Bobble League']],
    ['Frog Sqwad, Elevator, and Putt Party', ['Frog Sqwad', 'Elevator', 'Putt Party']],
    ['Elevator + Bobble League', ['Elevator', 'Bobble League']],
    ['Elevator (modded) and Frog Sqwad', ['Elevator', 'Frog Sqwad']],
  ])('splits a list when every part is a known game: %s', (announced, games) => {
    const known = ['Bobble League', 'Elevator', 'Frog Sqwad', 'Putt Party'];
    expect(resolveGames(announced, known)).toEqual({ games, demo: false });
  });

  it('reports a list of demos as demos', () => {
    const known = ['Elevator', 'Frog Sqwad'];
    expect(resolveGames('Elevator and Frog Sqwad Demos', known)).toEqual({ games: known, demo: true });
    expect(resolveGames('Elevator Demo and Frog Sqwad Demo', known)).toEqual({ games: known, demo: true });
  });

  it('lists a game once when it is named twice', () => {
    expect(resolveGames('Elevator and elevator', ['Elevator'])).toEqual({ games: ['Elevator'], demo: false });
  });

  it('takes a known game with a separator in its own name as one part of a list', () => {
    const known = ['Heal & Hurt', 'Prop and Seek', 'Elevator', 'Seek'];
    expect(resolveGames('Heal & Hurt and Elevator', known)).toEqual({ games: ['Heal & Hurt', 'Elevator'], demo: false });
    expect(resolveGames('Elevator + Prop and Seek', known)).toEqual({ games: ['Elevator', 'Prop and Seek'], demo: false });
    expect(resolveGames('Elevator, Prop and Seek Demo & Heal & Hurt (modded)', known)).toEqual({
      games: ['Elevator', 'Prop and Seek', 'Heal & Hurt'],
      demo: true,
    });
    // Still all or nothing: "Haste" is new, so nothing is cut off it.
    expect(resolveGames('Heal & Hurt and Haste', known)).toEqual({ games: ['Heal & Hurt and Haste'], demo: false });
  });

  it('reads "&" and "and" as the same word', () => {
    expect(resolveGames('Prop & Seek', ['Prop and Seek'])).toEqual({ games: ['Prop and Seek'], demo: false });
    expect(resolveGames('heal and hurt', ['Heal', 'Heal & Hurt'])).toEqual({ games: ['Heal & Hurt'], demo: false });
  });

  it('turns down a very long list without trying every way to cut it', () => {
    // With "a" and "a, a" both known there are billions of ways to group these.
    const announced = `${'a, '.repeat(60)}b`;
    expect(resolveGames(announced, ['a', 'a, a'])).toEqual({ games: [announced], demo: false });
    expect(resolveGames(`${'Sky Noon, '.repeat(400)}Sky Noon`, ['Sky Noon']).games).toHaveLength(1);
  });

  it("never returns a name with ';' in it, which is what separates games in the record", () => {
    expect(resolveGames('Elevator; Frog Sqwad', ['Frog Sqwad', 'Elevator'])).toEqual({ games: ['Elevator', 'Frog Sqwad'], demo: false });
    expect(resolveGames('STEINS;GATE', ['Sky Noon'])).toEqual({ games: ['STEINS,GATE'], demo: false });
    expect(resolveGames('steins;gate', ['STEINS,GATE'])).toEqual({ games: ['STEINS,GATE'], demo: false });
  });

  it("doesn't split when a part is unknown", () => {
    expect(resolveGames('Elevator and Haste', ['Elevator'])).toEqual({ games: ['Elevator and Haste'], demo: false });
    expect(resolveGames('Haste, Elevator', ['Elevator'])).toEqual({ games: ['Haste, Elevator'], demo: false });
  });

  it('keeps "Heal & Hurt" as one game, known or not', () => {
    expect(resolveGames('Heal & Hurt', ['Heal', 'Hurt', 'Heal & Hurt'])).toEqual({ games: ['Heal & Hurt'], demo: false });
    expect(resolveGames('Heal & Hurt', [])).toEqual({ games: ['Heal & Hurt'], demo: false });
    expect(resolveGames('Heal & Hurt', ['Heal'])).toEqual({ games: ['Heal & Hurt'], demo: false });
  });

  it('returns a new game as announced, without the demo marker', () => {
    expect(resolveGames('Haste', ['Sky Noon'])).toEqual({ games: ['Haste'], demo: false });
    expect(resolveGames(' Haste: Broken Worlds Demo ', ['Sky Noon'])).toEqual({ games: ['Haste: Broken Worlds'], demo: true });
  });

  it('has no games for an empty name', () => {
    expect(resolveGames('  ', ['Sky Noon'])).toEqual({ games: [], demo: false });
  });

  it('never matches a name with no Latin letters or digits', () => {
    // Both have an empty key, which must not make them the same game.
    expect(resolveGames('原神', ['崩坏'])).toEqual({ games: ['原神'], demo: false });
    expect(resolveGames('原神', ['原神'])).toEqual({ games: ['原神'], demo: false });
    expect(resolveGames('🎲🎲', ['🎲'])).toEqual({ games: ['🎲🎲'], demo: false });
  });

  it("doesn't match on the few Latin letters or digits of a name in another script", () => {
    // gameKey sees only the "2" of both.
    expect(resolveGames('原神 2', ['崩坏 2'])).toEqual({ games: ['原神 2'], demo: false });
    expect(resolveGames('Тетрис Online', ['Шахматы Online'])).toEqual({ games: ['Тетрис Online'], demo: false });
    // か and が are different letters, however Unicode spells them; so are и and й.
    expect(resolveGames('がんばれ 2', ['かんばれ 2'])).toEqual({ games: ['がんばれ 2'], demo: false });
    expect(resolveGames('Бой Online', ['Бои Online'])).toEqual({ games: ['Бой Online'], demo: false });
    expect(resolveGames('ｶﾞﾝﾊﾞﾚ 2', ['ガンバレ 2'])).toEqual({ games: ['ガンバレ 2'], demo: false });
    // The same name still matches, whatever its spacing, case or decoration.
    expect(resolveGames('原神2', ['崩坏 2', '原神 2'])).toEqual({ games: ['原神 2'], demo: false });
    expect(resolveGames('тетрис online!', ['Тетрис Online'])).toEqual({ games: ['Тетрис Online'], demo: false });
    expect(resolveGames('Among Us 🚀', ['Among Us'])).toEqual({ games: ['Among Us'], demo: false });
    expect(resolveGames('Pokemon Stadium', ['Pokémon Stadium'])).toEqual({ games: ['Pokémon Stadium'], demo: false });
  });
});

describe('costFromPost', () => {
  it.each([
    ['The demo is free on Steam!', 'Free (demo)'],
    ['Both demos are both free!', 'Free (demo)'],
    ['You can grab the demo for free.', 'Free (demo)'],
    ['Download the Next Fest demo for free on Steam!', 'Free (demo)'],
    ["It's free to keep if you grab it before Monday!", 'Free to keep (that week)'],
    ['Free-to-keep on Epic right now', 'Free to keep (that week)'],
    ['Haste is free for the weekend!', 'Free (that weekend)'],
    ["It's free this weekend on Steam", 'Free (that weekend)'],
    ["It's free-to-play until Monday", 'Free (that weekend)'],
    ['Currently free on Steam (sale ends Sunday)', 'Free (that weekend)'],
    ["Only the host needs it, thanks to the Friend's Pass ($19.99 otherwise)", "Free (Friend's Pass)"],
    ['Grab the friends pass', "Free (Friend's Pass)"],
    ['Everyone else can use the Free Pass', 'Free (Free Pass)'],
    ["I'll be screensharing it in voice", 'Free (screen-shared)'],
    ['We play by screen-sharing one copy ($14.99)', 'Free (screen-shared)'],
    ["It's free on Android and iOS, or $4.99 on Steam", 'Free on mobile, $4.99 on Steam'],
    ['Free on iOS!', 'Free on mobile'],
    ['Sky Noon is free on Steam (PC only)!', 'Free'],
    ['FREE!', 'Free'],
    ["It's $4.99 on Steam", '$4.99'],
    ['Just $5 this week', '$5'],
    ["It's $4.99 on Steam. Message me if you don't already own it!", '$4.99 (host had spare keys)'],
    ["It's $11.99, but I have extra copies", '$11.99 (host had spare keys)'],
    ['DM me for a key!', 'Host gave out keys'],
    ["Ping me if you don't already have it", 'Host gave out keys'],
    ["It's giftable, so ask around", 'Host gave out keys'],
    ['I have a few Steam keys to hand out', 'Host gave out keys'],
    ['I bought a 4-pack', 'Host gave out keys'],
  ])('%s -> %s', (content, cost) => {
    expect(costFromPost(content, false)).toBe(cost);
  });

  it('is a free demo whenever the game was announced as a demo', () => {
    expect(costFromPost('The full game is $9.99', true)).toBe('Free (demo)');
    expect(costFromPost('', true)).toBe('Free (demo)');
  });

  it("is undefined when the post doesn't say", () => {
    expect(costFromPost("For EG501 we'll be playing...\n**Sky Noon**!\nIt's a grappling-hook shooter.", false)).toBeUndefined();
    expect(costFromPost('', false)).toBeUndefined();
    expect(costFromPost(' \n\t ', false)).toBeUndefined();
  });

  it.each([
    ['Freedom Fighters is $3', '$3'],
    ['A carefree platformer', undefined],
    ['Costs $ nothing much', undefined],
    ['$4.99 on Steam, $2.99 on mobile', '$4.99'],
  ])('reads "free" as a word and the first price: %s', (content, cost) => {
    expect(costFromPost(content, false)).toBe(cost);
  });

  it.each([
    ["Feel free to hop in late! It's $2.99 on Steam", '$2.99'],
    ['feel free to bring a friend', undefined],
    ["You're free to join whenever", undefined],
    ['The non-free version is $7.99', '$7.99'],
    ['Non-free this week, sorry!', undefined],
  ])('is not fooled by "free" that isn\'t about the price: %s', (content, cost) => {
    expect(costFromPost(content, false)).toBe(cost);
  });

  it.each([
    ['~~$9.99~~ $4.99 on sale this week', '$4.99'],
    ["~~$9.99~~ and now it's free!", 'Free'],
    ['~~Free on Steam~~ it went up to $3.99', '$3.99'],
    ['~~$9.99~~', undefined],
  ])('ignores struck-through text: %s', (content, cost) => {
    expect(costFromPost(content, false)).toBe(cost);
  });
});

describe('localDate', () => {
  it('gives the calendar date in that timezone', () => {
    // A Saturday 10:30 Pacific session is already Sunday in UTC+14, but still Saturday where it's played.
    const start = new Date('2030-02-02T18:30:00Z');
    expect(localDate(start, 'America/Los_Angeles')).toBe('2030-02-02');
    expect(localDate(start, 'UTC')).toBe('2030-02-02');
    expect(localDate(start, 'Pacific/Kiritimati')).toBe('2030-02-03');
  });

  it('changes at local midnight', () => {
    expect(localDate(new Date('2030-03-02T07:59:59Z'), 'America/Los_Angeles')).toBe('2030-03-01');
    expect(localDate(new Date('2030-03-02T08:00:00Z'), 'America/Los_Angeles')).toBe('2030-03-02');
  });

  it('knows leap days and year ends', () => {
    expect(localDate(new Date('2028-03-01T07:59:59Z'), 'America/Los_Angeles')).toBe('2028-02-29');
    expect(localDate(new Date('2030-03-01T07:59:59Z'), 'America/Los_Angeles')).toBe('2030-02-28');
    expect(localDate(new Date('2031-01-01T07:59:59Z'), 'America/Los_Angeles')).toBe('2030-12-31');
    expect(localDate(new Date('2030-12-31T10:00:00Z'), 'Pacific/Kiritimati')).toBe('2031-01-01');
  });

  it('follows the clocks on a daylight-saving weekend', () => {
    // Pacific time, 2030: forward on Mar 10, back on Nov 3. Midnight is at 08:00 UTC, then 07:00.
    expect(localDate(new Date('2030-03-10T07:59:59Z'), 'America/Los_Angeles')).toBe('2030-03-09');
    expect(localDate(new Date('2030-03-11T06:59:59Z'), 'America/Los_Angeles')).toBe('2030-03-10');
    expect(localDate(new Date('2030-03-11T07:00:00Z'), 'America/Los_Angeles')).toBe('2030-03-11');
    expect(localDate(new Date('2030-11-04T07:59:59Z'), 'America/Los_Angeles')).toBe('2030-11-03');
    expect(localStart(new Date('2030-11-03T08:30:00Z'), 'America/Los_Angeles')).toBe('1:30am');
    expect(localStart(new Date('2030-11-03T09:30:00Z'), 'America/Los_Angeles')).toBe('1:30am');
  });
});

describe('localStart', () => {
  it.each([
    ['2030-02-02T10:30:00Z', '10:30am'],
    ['2030-02-02T11:00:00Z', '11am'],
    ['2030-02-02T12:00:00Z', '12pm'],
    ['2030-02-02T12:30:00Z', '12:30pm'],
    ['2030-02-02T18:00:00Z', '6pm'],
    ['2030-02-02T13:07:00Z', '1:07pm'],
    ['2030-02-02T23:59:00Z', '11:59pm'],
    ['2030-02-02T00:00:00Z', '12am'],
    ['2030-02-02T00:05:00Z', '12:05am'],
  ])('%s -> %s', (at, start) => {
    expect(localStart(new Date(at), 'UTC')).toBe(start);
  });

  it('is the time in that timezone', () => {
    const at = new Date('2030-02-02T18:30:00Z');
    expect(localStart(at, 'America/Los_Angeles')).toBe('10:30am');
    expect(localStart(at, 'America/New_York')).toBe('1:30pm');
    expect(localStart(at, 'Asia/Kolkata')).toBe('12am');
  });
});

describe('timezoneLabel', () => {
  const winter = new Date('2030-01-15T12:00:00Z');
  const summer = new Date('2030-07-15T12:00:00Z');

  it('uses the year-round abbreviation where there is one', () => {
    expect(timezoneLabel('America/Los_Angeles', winter)).toBe('PT');
    expect(timezoneLabel('America/Los_Angeles', summer)).toBe('PT');
    expect(timezoneLabel('America/New_York', winter)).toBe('ET');
  });

  it('falls back to the short name at that moment', () => {
    expect(timezoneLabel('UTC', winter)).toBe('UTC');
    expect(timezoneLabel('Europe/Berlin', winter)).toBe('GMT+1');
    expect(timezoneLabel('Europe/Berlin', summer)).toBe('GMT+2');
  });

  it("is undefined for a timezone Intl doesn't know", () => {
    expect(timezoneLabel('Mars/Olympus_Mons', winter)).toBeUndefined();
    expect(timezoneLabel('', winter)).toBeUndefined();
  });
});
