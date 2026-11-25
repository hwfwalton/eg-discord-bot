import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSchedule } from '../gameNight/plan.ts';
import type { AnnouncementPost } from './live.ts';
import {
  GAMES_FILE,
  NEXT_FILE,
  NEXT_MAX_AGE_MS,
  SESSIONS_FILE,
  createRecorder,
  isDue,
  type DueState,
  type LiveSource,
  type RecorderOptions,
} from './recorder.ts';
import { AUTO_SOURCE } from './types.ts';

const TIMEZONE = 'America/Los_Angeles';
// Saturdays at 10:30am Pacific. In January 2031 those are the 4th, 11th, 18th and 25th.
const schedule = createSchedule('30 10 * * 6', TIMEZONE);
const quiet = { info: () => {}, warn: () => {} };

const HEADER = 'Session,Date,Start,Status,Games,Planned,Cost,Announced by,Source,Notes';
const RECORD = `${HEADER}
EG1,2031-01-04,10:30am,Played,Duck Game,,Free,Robin,#announcements,
EG2,2031-01-11,10:30am,Played,Duck Game,,Free,Robin,#announcements,
`;
const GAMES = `Game,Style,Mode,Where,Link,Tags,Developer
Duck Game,2D platform fighter,Competitive,Steam,https://store.steampowered.com/app/312530/,"Multiplayer, Funny",Landon Podbielski
`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'history-recorder-'));
});
afterEach(() => {
  chmodSync(dir, 0o755);
  rmSync(dir, { recursive: true, force: true });
});

function post(id: string, at: string, content: string, authorName = 'Robin'): AnnouncementPost {
  return { id, url: `https://discord.test/${id}`, authorId: '1', authorName, content, createdAt: new Date(at) };
}

const announcement = (label: string, when: string, game: string) =>
  `@everyone\nFor ${label} (${when} @ 10:30am PT/1:30pm ET) we'll be playing...\n**${game}**!\n**${game} is free on Steam!**\nhttps://store.steampowered.com/app/4242/Some_Game/`;

function live(posts: AnnouncementPost[] | undefined, calls: Date[] = []): LiveSource {
  return {
    schedule,
    fetchPosts: async (since) => {
      calls.push(since);
      return posts;
    },
  };
}

function recorder(options: Partial<RecorderOptions> & { at: string }) {
  const { at, ...rest } = options;
  return createRecorder({ dir, timezone: TIMEZONE, live: live([]), now: () => new Date(at), log: quiet, ...rest });
}

function logged() {
  const warnings: string[] = [];
  return { warnings, log: { info: () => {}, warn: (message: string) => void warnings.push(message) } };
}

const read = (file: string) => readFileSync(join(dir, file), 'utf8');
const readNext = () => JSON.parse(read(NEXT_FILE)) as unknown;

const posts = [
  post('p3', '2031-01-17T18:00:00Z', announcement('EG3', '1/18', 'Sky Noon'), '=Sam'),
  post('p4', '2031-01-24T18:00:00Z', '@everyone\n**No official game night this weekend (1/25)!**'),
  post('p5', '2031-01-31T18:00:00Z', announcement('EG4', '2/1', 'Duck Game')),
];

describe('recording', () => {
  it('adds the weeks since the last row to sessions.csv, new games to games.csv, and writes next.json', async () => {
    writeFileSync(join(dir, SESSIONS_FILE), RECORD);
    writeFileSync(join(dir, GAMES_FILE), GAMES);
    const calls: Date[] = [];
    // Monday after the 25th: EG3 and the week off have happened, EG4 (Feb 1) hasn't.
    const result = await recorder({ at: '2031-01-27T20:00:00Z', live: live(posts, calls) }).run();

    expect(result.checked).toBe(true);
    expect(result.added.map((s) => [s.date, s.status, s.session])).toEqual([
      ['2031-01-18', 'Played', 'EG3'],
      ['2031-01-25', 'No session', undefined],
    ]);
    expect(result.addedGames.map((g) => g.name)).toEqual(['Sky Noon']);
    expect(result.unsaved).toEqual([]);

    // The existing text is untouched; the new rows follow it. "=Sam" loses its formula sign.
    const file = read(SESSIONS_FILE);
    expect(file.startsWith(RECORD)).toBe(true);
    expect(file.slice(RECORD.length)).toBe(
      `EG3,2031-01-18,10:30am,Played,Sky Noon,,Free,Sam,${AUTO_SOURCE},\n,2031-01-25,,No session,,,,Robin,${AUTO_SOURCE},\n`,
    );
    expect(read(GAMES_FILE)).toBe(`${GAMES}Sky Noon,,,Steam,https://store.steampowered.com/app/4242/,,\n`);

    // Posts were asked for from a little before the record's last row.
    expect(calls[0]?.toISOString()).toBe('2031-01-03T00:00:00.000Z');
    // The session after "now" is the next one up.
    const next = {
      updatedAt: '2031-01-27T20:00:00.000Z',
      date: '2031-02-01',
      start: '10:30am',
      status: 'announced',
      session: 'EG4',
      games: ['Duck Game'],
    };
    expect(result.next).toEqual(next);
    expect(readNext()).toEqual(next);
    // Written through a temp file, which is gone.
    expect(readdirSync(dir).sort()).toEqual([GAMES_FILE, NEXT_FILE, SESSIONS_FILE]);
  });

  it('adds each week once, however often it runs', async () => {
    writeFileSync(join(dir, SESSIONS_FILE), RECORD);
    let at = Date.parse('2031-01-27T20:00:00Z');
    const r = createRecorder({ dir, timezone: TIMEZONE, now: () => new Date(at), log: quiet, live: live(posts) });
    await Promise.all([r.run(), r.run()]);
    const afterFirst = read(SESSIONS_FILE);
    expect(afterFirst.match(/2031-01-18/g)).toHaveLength(1);
    at += 60_000;
    const again = await r.run();
    expect(again.added).toEqual([]);
    expect(read(SESSIONS_FILE)).toBe(afterFirst);
    expect(readNext()).toMatchObject({ updatedAt: new Date(at).toISOString(), session: 'EG4' });

    // A week later EG4 has been played: only that row is added, and next.json moves on.
    at = Date.parse('2031-02-03T20:00:00Z');
    expect((await r.run()).added).toMatchObject([{ session: 'EG4', date: '2031-02-01', games: ['Duck Game'] }]);
    expect(read(SESSIONS_FILE).slice(afterFirst.length)).toBe(`EG4,2031-02-01,10:30am,Played,Duck Game,,Free,Robin,${AUTO_SOURCE},\n`);
    expect(readNext()).toEqual({ updatedAt: '2031-02-03T20:00:00.000Z', date: '2031-02-08', start: '10:30am', status: 'unannounced', games: [] });
  });

  it('never adds a week twice when runs overlap', async () => {
    writeFileSync(join(dir, SESSIONS_FILE), RECORD);
    const slow: LiveSource = {
      schedule,
      fetchPosts: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return posts;
      },
    };
    const r = recorder({ at: '2031-01-27T20:00:00Z', live: slow });
    const [a, b] = await Promise.all([r.run(), r.run()]);
    expect(a.added).toHaveLength(2);
    expect(b.added).toEqual([]);
    expect(b.unsaved).toEqual([]);
    expect(read(SESSIONS_FILE).match(/2031-01-18/g)).toHaveLength(1);
  });

  it("isn't held back by a row dated in the future, but doesn't add to the file until it is fixed", async () => {
    const withFuture = `${RECORD}EG9,2062-01-18,10:30am,Played,Duck Game,,,,,\n`;
    writeFileSync(join(dir, SESSIONS_FILE), withFuture);
    const { warnings, log } = logged();
    const r = recorder({ at: '2031-01-27T20:00:00Z', live: live(posts), log });
    const result = await r.run();
    expect(result.unsaved.map((x) => x.date)).toEqual(['2031-01-18', '2031-01-25']);
    expect(read(SESSIONS_FILE)).toBe(withFuture);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/dated after today \(2062-01-18\)/);
    // next.json still follows the announcements.
    expect(readNext()).toMatchObject({ session: 'EG4' });
    // Said once while the file stays the same.
    await r.run();
    expect(warnings).toHaveLength(1);
  });

  it('"today" follows the timezone, not UTC', async () => {
    // 03:00 UTC on the 21st is still the evening of the 20th in California, so a row for the 21st is in the future.
    writeFileSync(join(dir, SESSIONS_FILE), `${RECORD}EG3,2031-01-21,10:30am,Played,Duck Game,,,,,\n`);
    const { warnings, log } = logged();
    await recorder({ at: '2031-01-21T03:00:00Z', live: live(posts), log }).run();
    expect(warnings[0]).toMatch(/dated after today \(2031-01-21\)/);
  });

  it("doesn't add to a file that has rows it couldn't read, and names them", async () => {
    const withTypo = `${RECORD}EG3,18/01/2031,10:30am,Played,Sky Noon,,,,,\n`;
    writeFileSync(join(dir, SESSIONS_FILE), withTypo);
    const { warnings, log } = logged();
    const result = await recorder({ at: '2031-01-27T20:00:00Z', live: live(posts), log }).run();
    expect(result.unsaved).toHaveLength(2);
    expect(read(SESSIONS_FILE)).toBe(withTypo);
    expect(warnings.join(' ')).toContain('18/01/2031');
  });

  it("doesn't add rows to a file they couldn't be read back from", async () => {
    const noDate = 'Session,Games\nEG1,Duck Game\n';
    writeFileSync(join(dir, SESSIONS_FILE), noDate);
    const { warnings, log } = logged();
    await recorder({ at: '2031-01-27T20:00:00Z', live: live(posts), log }).run();
    expect(read(SESSIONS_FILE)).toBe(noDate);
    expect(warnings.join(' ')).toMatch(/no "Date" column/);
  });

  it('skips the last recorded session if it turns up again under a new schedule', async () => {
    // The record already has EG3 on Friday the 17th; the Saturday schedule finds its announcement again.
    const withEg3 = `${RECORD}EG3,2031-01-17,7pm,Played,Sky Noon,,,,,\n`;
    writeFileSync(join(dir, SESSIONS_FILE), withEg3);
    const result = await recorder({ at: '2031-01-20T20:00:00Z', live: live(posts) }).run();
    expect(result.added).toEqual([]);
    expect(read(SESSIONS_FILE)).toBe(withEg3);
  });

  it('keeps a row the owner corrected by hand', async () => {
    writeFileSync(join(dir, SESSIONS_FILE), RECORD);
    const r = recorder({ at: '2031-01-27T20:00:00Z', live: live(posts) });
    await r.run();
    const corrected = read(SESSIONS_FILE).replace('Sky Noon', 'ROUNDS');
    writeFileSync(join(dir, SESSIONS_FILE), corrected);
    expect((await r.run()).added).toEqual([]);
    expect(read(SESSIONS_FILE)).toBe(corrected);
  });

  it('only appends to the file as it was read: an edit made during the run stops it', async () => {
    writeFileSync(join(dir, SESSIONS_FILE), RECORD);
    const edited = `${RECORD}EG3,2031-01-18,10:30am,Played,ROUNDS,,,,,\n`;
    let editing = true;
    const editsMeanwhile: LiveSource = {
      schedule,
      fetchPosts: async () => {
        // The owner saves the file from a spreadsheet while the bot waits on Discord.
        if (editing) writeFileSync(join(dir, SESSIONS_FILE), edited);
        editing = false;
        return posts;
      },
    };
    const r = recorder({ at: '2031-01-27T20:00:00Z', live: editsMeanwhile });
    expect((await r.run()).unsaved).toHaveLength(2);
    expect(read(SESSIONS_FILE)).toBe(edited);

    // The next run starts from the edited file: only the week off is still missing.
    expect((await r.run()).added.map((x) => x.date)).toEqual(['2031-01-25']);
    expect(read(SESSIONS_FILE)).toBe(`${edited},2031-01-25,,No session,,,,Robin,${AUTO_SOURCE},\n`);
  });

  it('starts a record from the recent announcements when there is none', async () => {
    const result = await recorder({ at: '2031-01-27T20:00:00Z', live: live(posts) }).run();
    expect(result.added.map((s) => s.date)).toEqual(['2031-01-18', '2031-01-25']);
    expect(read(SESSIONS_FILE)).toBe(
      `${HEADER}\nEG3,2031-01-18,10:30am,Played,Sky Noon,,Free,Sam,${AUTO_SOURCE},\n,2031-01-25,,No session,,,,Robin,${AUTO_SOURCE},\n`,
    );
  });

  it('keeps the new sessions when games.csv cannot be written', async () => {
    writeFileSync(join(dir, SESSIONS_FILE), RECORD);
    writeFileSync(join(dir, GAMES_FILE), GAMES);
    chmodSync(join(dir, GAMES_FILE), 0o444);
    const { warnings, log } = logged();
    const result = await recorder({ at: '2031-01-27T20:00:00Z', live: live(posts), log }).run();
    expect(result.added).toHaveLength(2);
    expect(result.addedGames).toEqual([]);
    expect(read(SESSIONS_FILE)).toContain('Sky Noon');
    expect(read(GAMES_FILE)).toBe(GAMES);
    expect(warnings).toEqual([`Session record: could not add Sky Noon to ${GAMES_FILE}`]);
  });

  it('carries on when the folder is read-only, and logs each problem once', async () => {
    writeFileSync(join(dir, SESSIONS_FILE), RECORD);
    chmodSync(join(dir, SESSIONS_FILE), 0o444);
    chmodSync(dir, 0o555);
    const { warnings, log } = logged();
    const r = recorder({ at: '2031-01-27T20:00:00Z', live: live(posts), log });
    const result = await r.run();

    expect(result.checked).toBe(true);
    expect(result.unsaved).toHaveLength(2);
    expect(result.next).toBeUndefined();
    expect(read(SESSIONS_FILE)).toBe(RECORD);
    expect(existsSync(join(dir, NEXT_FILE))).toBe(false);
    expect(warnings.map((w) => w.split(' (')[0])).toEqual([
      `Session record: could not save new sessions to ${join(dir, SESSIONS_FILE)}`,
      `Session record: could not write ${join(dir, NEXT_FILE)}`,
    ]);
    // Logged once, not on every run.
    await r.run();
    expect(warnings).toHaveLength(2);
  });

  it('changes nothing when Discord is not connected yet, or fails', async () => {
    writeFileSync(join(dir, SESSIONS_FILE), RECORD);
    writeFileSync(join(dir, GAMES_FILE), GAMES);
    const waiting = await recorder({ at: '2031-01-27T20:00:00Z', live: live(undefined) }).run();
    expect(waiting).toEqual({ checked: false, added: [], addedGames: [], unsaved: [] });

    const failing: LiveSource = { schedule, fetchPosts: () => Promise.reject(new Error('Missing Access')) };
    const { warnings, log } = logged();
    const failed = await recorder({ at: '2031-01-27T20:00:00Z', live: failing, log }).run();
    expect(failed.checked).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(read(SESSIONS_FILE)).toBe(RECORD);
    expect(existsSync(join(dir, NEXT_FILE))).toBe(false);
  });
});

describe('due', () => {
  // Tuesday the 21st: EG3 (Saturday the 18th) has started; EG4 (the 25th) hasn't.
  const base: DueState = {
    now: new Date('2031-01-21T20:00:00Z'),
    schedule,
    timezone: TIMEZONE,
    lastDate: '2031-01-18',
    stamp: 'a',
    lastCheck: { at: new Date('2031-01-21T19:00:00Z'), stamp: 'a' },
    nextWrittenAt: new Date('2031-01-21T19:00:00Z'),
  };

  it('is not due while the record and next.json are up to date', () => {
    expect(isDue(base)).toBe(false);
  });

  it('is due once a session starts that the record has no row for', () => {
    expect(isDue({ ...base, lastDate: '2031-01-11' })).toBe(false); // already looked since EG3 started
    expect(isDue({ ...base, lastDate: '2031-01-11', lastCheck: { at: new Date('2031-01-18T18:00:00Z'), stamp: 'a' } })).toBe(true);
    expect(isDue({ ...base, lastDate: '2031-01-11', lastCheck: undefined })).toBe(true);
    expect(isDue({ ...base, lastDate: '' , lastCheck: undefined })).toBe(true);
    // Saturday, 10:30am Pacific: EG4 has just started.
    expect(isDue({ ...base, now: new Date('2031-01-25T18:31:00Z'), nextWrittenAt: new Date('2031-01-25T18:00:00Z') })).toBe(true);
  });

  it('looks again for a missing week when sessions.csv was edited since the last look', () => {
    expect(isDue({ ...base, lastDate: '2031-01-11', stamp: 'b' })).toBe(true);
    // An edit alone, with no missing week, needs no Discord call.
    expect(isDue({ ...base, stamp: 'b' })).toBe(false);
  });

  it('is due when next.json is missing or old', () => {
    expect(isDue({ ...base, nextWrittenAt: undefined })).toBe(true);
    expect(isDue({ ...base, nextWrittenAt: new Date(base.now.getTime() - NEXT_MAX_AGE_MS) })).toBe(true);
    expect(isDue({ ...base, nextWrittenAt: new Date(base.now.getTime() - NEXT_MAX_AGE_MS + 60_000) })).toBe(false);
  });

  it('reads the folder: due before the first run, not after it', async () => {
    // The clock is real here, since next.json's age is its modification time; the posts are all in 2031.
    const r = createRecorder({ dir, timezone: TIMEZONE, now: () => new Date(), log: quiet, live: live(posts) });
    // Without next.json it is always due.
    expect(await r.due()).toBe(true);
    await r.run();
    expect(existsSync(join(dir, NEXT_FILE))).toBe(true);
    expect(await r.due()).toBe(false);
  });
});
