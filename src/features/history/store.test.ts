import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSchedule } from '../gameNight/plan.ts';
import type { AnnouncementPost } from './live.ts';
import { GAMES_FILE, SESSIONS_FILE, createHistoryStore, type HistoryStoreOptions, type LiveSource } from './store.ts';
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
  dir = mkdtempSync(join(tmpdir(), 'history-store-'));
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

function store(options: Partial<HistoryStoreOptions> & { at: string }) {
  const { at, ...rest } = options;
  return createHistoryStore({ dir, title: 'Card Club', timezone: TIMEZONE, now: () => new Date(at), log: quiet, ...rest });
}

const read = (file: string) => readFileSync(join(dir, file), 'utf8');

describe('the record alone', () => {
  it('shows the files as they are', async () => {
    writeFileSync(join(dir, SESSIONS_FILE), RECORD);
    writeFileSync(join(dir, GAMES_FILE), GAMES);
    const data = await store({ at: '2031-01-20T20:00:00Z' }).getData();

    expect(data.title).toBe('Card Club');
    expect(data.today).toBe('2031-01-20');
    expect(data.timezone).toBe('PT');
    expect(data.sessions.map((s) => s.session)).toEqual(['EG1', 'EG2']);
    expect(data.games[0]).toMatchObject({ name: 'Duck Game', plays: 2, style: '2D platform fighter' });
    expect(data.next).toBeUndefined();
    expect(data.notes).toEqual([]);
  });

  it('says so when there is no sessions.csv yet, and passes on problems in the files', async () => {
    const empty = await store({ at: '2031-01-20T20:00:00Z' }).getData();
    expect(empty.sessions).toEqual([]);
    expect(empty.notes).toEqual([{ kind: 'info', text: 'There is no sessions.csv in the history folder yet.' }]);

    writeFileSync(join(dir, SESSIONS_FILE), `${HEADER}\nEG1,13/45/2031,,Played,Duck Game,,,,,\n`);
    const bad = await store({ at: '2031-01-20T20:00:00Z' }).getData();
    expect(bad.notes.map((n) => n.text).join(' ')).toContain('13/45/2031');
  });

  it('"today" follows the timezone, not UTC', async () => {
    writeFileSync(join(dir, SESSIONS_FILE), RECORD);
    // 03:00 UTC on the 21st is still the evening of the 20th in California.
    expect((await store({ at: '2031-01-21T03:00:00Z' }).getData()).today).toBe('2031-01-20');
  });

  it('reuses what it computed for a while, then reads the files again', async () => {
    writeFileSync(join(dir, SESSIONS_FILE), RECORD);
    let at = Date.parse('2031-01-20T20:00:00Z');
    const s = createHistoryStore({ dir, title: 'Card Club', timezone: TIMEZONE, now: () => new Date(at), log: quiet, maxAgeMs: 30_000 });
    expect((await s.getData()).sessions).toHaveLength(2);

    writeFileSync(join(dir, SESSIONS_FILE), `${RECORD}EG3,2031-01-18,10:30am,Played,Duck Game,,,,,\n`);
    at += 10_000;
    expect((await s.getData()).sessions).toHaveLength(2);
    at += 30_000;
    expect((await s.getData()).sessions).toHaveLength(3);
  });

  it('reads the files again right away after invalidate()', async () => {
    writeFileSync(join(dir, SESSIONS_FILE), RECORD);
    const s = store({ at: '2031-01-20T20:00:00Z' });
    await s.getData();
    writeFileSync(join(dir, SESSIONS_FILE), `${RECORD}EG3,2031-01-18,10:30am,Played,Duck Game,,,,,\n`);
    s.invalidate();
    expect((await s.getData()).sessions).toHaveLength(3);
  });
});

describe('with the announcements', () => {
  const posts = [
    post('p3', '2031-01-17T18:00:00Z', announcement('EG3', '1/18', 'Sky Noon'), '=Sam'),
    post('p4', '2031-01-24T18:00:00Z', '@everyone\n**No official game night this weekend (1/25)!**'),
    post('p5', '2031-01-31T18:00:00Z', announcement('EG4', '2/1', 'Duck Game')),
  ];

  it('adds the weeks since the last row to sessions.csv, and new games to games.csv', async () => {
    writeFileSync(join(dir, SESSIONS_FILE), RECORD);
    writeFileSync(join(dir, GAMES_FILE), GAMES);
    const calls: Date[] = [];
    // Monday after the 25th: EG3 and the week off have happened, EG4 (Feb 1) hasn't.
    const data = await store({ at: '2031-01-27T20:00:00Z', live: live(posts, calls) }).getData();

    expect(data.sessions.map((s) => [s.date, s.status, s.session, s.auto])).toEqual([
      ['2031-01-04', 'Played', 'EG1', false],
      ['2031-01-11', 'Played', 'EG2', false],
      ['2031-01-18', 'Played', 'EG3', true],
      ['2031-01-25', 'No session', undefined, true],
    ]);
    expect(data.notes).toEqual([{ kind: 'info', text: 'No style set for: Sky Noon. Add it to games.csv.' }]);

    // The existing text is untouched; the new rows follow it.
    const file = read(SESSIONS_FILE);
    expect(file.startsWith(RECORD)).toBe(true);
    expect(file.slice(RECORD.length)).toBe(
      `EG3,2031-01-18,10:30am,Played,Sky Noon,,Free,Sam,${AUTO_SOURCE},\n,2031-01-25,,No session,,,,Robin,${AUTO_SOURCE},\n`,
    );
    expect(read(GAMES_FILE)).toBe(`${GAMES}Sky Noon,,,Steam,https://store.steampowered.com/app/4242/,,\n`);

    // Posts were asked for from a little before the record's last row.
    expect(calls[0]?.toISOString()).toBe('2031-01-03T00:00:00.000Z');
    // The session after "now" is the next one up.
    expect(data.next).toEqual({ date: '2031-02-01', start: '10:30am', status: 'announced', session: 'EG4', games: ['Duck Game'] });
  });

  it('adds each week once, however often the page is loaded', async () => {
    writeFileSync(join(dir, SESSIONS_FILE), RECORD);
    let at = Date.parse('2031-01-27T20:00:00Z');
    const s = createHistoryStore({ dir, title: 'Card Club', timezone: TIMEZONE, now: () => new Date(at), log: quiet, live: live(posts) });
    await Promise.all([s.getData(), s.getData()]);
    const afterFirst = read(SESSIONS_FILE);
    at += 60_000;
    expect((await s.getData()).sessions).toHaveLength(4);
    expect(read(SESSIONS_FILE)).toBe(afterFirst);

    // A week later EG4 has been played: only that row is added.
    at = Date.parse('2031-02-03T20:00:00Z');
    expect((await s.getData()).sessions.at(-1)).toMatchObject({ session: 'EG4', date: '2031-02-01', games: [{ name: 'Duck Game', play: 3 }] });
    expect(read(SESSIONS_FILE).slice(afterFirst.length)).toBe(`EG4,2031-02-01,10:30am,Played,Duck Game,,Free,Robin,${AUTO_SOURCE},\n`);
  });

  it('never adds a week twice when loads overlap', async () => {
    writeFileSync(join(dir, SESSIONS_FILE), RECORD);
    const slow: LiveSource = {
      schedule,
      fetchPosts: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return posts;
      },
    };
    const s = store({ at: '2031-01-27T20:00:00Z', live: slow });
    const first = s.getData();
    s.invalidate(); // an announcement was posted while the first load was waiting on Discord
    const [a, b] = await Promise.all([first, s.getData()]);
    expect(a.sessions).toHaveLength(4);
    expect(b.sessions).toHaveLength(4);
    expect(b.notes.filter((n) => n.kind === 'warning')).toEqual([]);
    expect(read(SESSIONS_FILE).match(/2031-01-18/g)).toHaveLength(1);
  });

  it("isn't held back by a row dated in the future, and says so", async () => {
    writeFileSync(join(dir, SESSIONS_FILE), `${RECORD}EG9,2062-01-18,10:30am,Played,Duck Game,,,,,\n`);
    const data = await store({ at: '2031-01-27T20:00:00Z', live: live(posts) }).getData();
    expect(data.sessions.map((x) => x.date)).toEqual(['2031-01-04', '2031-01-11', '2031-01-18', '2031-01-25', '2062-01-18']);
    expect(data.notes[0]?.text).toMatch(/dated after today \(2062-01-18\)/);
    // Shown, but not written until the owner has fixed the row.
    expect(read(SESSIONS_FILE)).not.toContain('2031-01-18');
  });

  it("doesn't add to a file that has rows it couldn't read", async () => {
    const withTypo = `${RECORD}EG3,18/01/2031,10:30am,Played,Sky Noon,,,,,\n`;
    writeFileSync(join(dir, SESSIONS_FILE), withTypo);
    const data = await store({ at: '2031-01-27T20:00:00Z', live: live(posts) }).getData();
    expect(data.sessions).toHaveLength(4);
    expect(read(SESSIONS_FILE)).toBe(withTypo);
    expect(data.notes.map((n) => n.text).join(' ')).toMatch(/Fix the rows listed here first/);
  });

  it('skips the last recorded session if it turns up again under a new schedule', async () => {
    // The record already has EG3 on Friday the 17th; the Saturday schedule finds its announcement again.
    writeFileSync(join(dir, SESSIONS_FILE), `${RECORD}EG3,2031-01-17,7pm,Played,Sky Noon,,,,,\n`);
    const data = await store({ at: '2031-01-20T20:00:00Z', live: live(posts) }).getData();
    expect(data.sessions.map((x) => x.session)).toEqual(['EG1', 'EG2', 'EG3']);
  });

  it('keeps a row the owner corrected by hand', async () => {
    writeFileSync(join(dir, SESSIONS_FILE), RECORD);
    const s = store({ at: '2031-01-27T20:00:00Z', live: live(posts) });
    await s.getData();
    const corrected = read(SESSIONS_FILE).replace('Sky Noon', 'ROUNDS');
    writeFileSync(join(dir, SESSIONS_FILE), corrected);
    s.invalidate();

    const data = await s.getData();
    expect(data.sessions.find((x) => x.session === 'EG3')?.games[0]?.name).toBe('ROUNDS');
    expect(read(SESSIONS_FILE)).toBe(corrected);
  });

  it('starts a record from the recent announcements when there is none', async () => {
    const data = await store({ at: '2031-01-27T20:00:00Z', live: live(posts) }).getData();
    expect(data.sessions.map((s) => s.date)).toEqual(['2031-01-18', '2031-01-25']);
    expect(read(SESSIONS_FILE)).toBe(
      `${HEADER}\nEG3,2031-01-18,10:30am,Played,Sky Noon,,Free,Sam,${AUTO_SOURCE},\n,2031-01-25,,No session,,,,Robin,${AUTO_SOURCE},\n`,
    );
  });

  it('still shows new weeks when the folder is read-only, with a warning', async () => {
    writeFileSync(join(dir, SESSIONS_FILE), RECORD);
    chmodSync(join(dir, SESSIONS_FILE), 0o444);
    chmodSync(dir, 0o555);
    const warnings: string[] = [];
    const s = store({ at: '2031-01-27T20:00:00Z', live: live(posts), log: { info: () => {}, warn: (m) => void warnings.push(m) } });
    const data = await s.getData();

    expect(data.sessions).toHaveLength(4);
    expect(data.notes[0]).toEqual({
      kind: 'warning',
      text: '2 new sessions are shown from the announcements but could not be saved to sessions.csv. Check that the history folder and the files in it are writable.',
    });
    expect(read(SESSIONS_FILE)).toBe(RECORD);
    // Logged once, not on every load.
    s.invalidate();
    await s.getData();
    expect(warnings).toHaveLength(1);
  });

  it("doesn't add rows to a file they couldn't be read back from", async () => {
    const noDate = 'Session,Games\nEG1,Duck Game\n';
    writeFileSync(join(dir, SESSIONS_FILE), noDate);
    const data = await store({ at: '2031-01-27T20:00:00Z', live: live(posts) }).getData();
    expect(read(SESSIONS_FILE)).toBe(noDate);
    expect(data.notes.map((n) => n.text).join(' ')).toMatch(/no "Date" column/);
  });

  it('shows the record when Discord is not connected yet, or fails', async () => {
    writeFileSync(join(dir, SESSIONS_FILE), RECORD);
    writeFileSync(join(dir, GAMES_FILE), GAMES);
    const waiting = await store({ at: '2031-01-27T20:00:00Z', live: live(undefined) }).getData();
    expect(waiting.sessions).toHaveLength(2);
    expect(waiting.notes).toEqual([{ kind: 'info', text: 'Not connected to Discord yet, so newer sessions have not been checked.' }]);

    const failing: LiveSource = { schedule, fetchPosts: () => Promise.reject(new Error('Missing Access')) };
    const failed = await store({ at: '2031-01-27T20:00:00Z', live: failing }).getData();
    expect(failed.sessions).toHaveLength(2);
    expect(failed.notes).toEqual([{ kind: 'warning', text: 'Newer sessions could not be checked on Discord just now.' }]);
    expect(read(SESSIONS_FILE)).toBe(RECORD);
  });
});
