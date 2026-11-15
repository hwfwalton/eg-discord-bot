import { Collection, type ForumChannel } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  USAGE,
  autocompleteChoices,
  createSuggester,
  findExistingPost,
  parseMention,
  postTitle,
  resultText,
  starterMessage,
} from './suggest.ts';

const BOT = '345678901234567890';
const ROLE = '1571295999999999999';

describe('parseMention', () => {
  it.each([
    [`<@${BOT}> Hades II`, { game: 'Hades II' }],
    [`<@!${BOT}> hades 2`, { game: 'hades 2' }],
    [`<@&${ROLE}> Hades II`, { game: 'Hades II' }],
    // The game text is returned as typed; suggest() cleans it (after checking for a Steam link).
    [`  <@${BOT}> suggest: **Hades II**`, { game: '**Hades II**' }],
    [`<@${BOT}> add "Overcooked! 2"`, { game: '"Overcooked! 2"' }],
    [`<@${BOT}> Adding Up`, { game: 'Adding Up' }],
    [`<@${BOT}>\nSky Noon`, { game: 'Sky Noon' }],
    [`<@${BOT}> https://store.steampowered.com/app/569530/Sky_Noon/`, { game: 'https://store.steampowered.com/app/569530/Sky_Noon/' }],
    [`<@${BOT}>`, { game: '' }],
  ])('%j -> %j', (content, expected) => {
    expect(parseMention(content, { userId: BOT, roleId: ROLE })).toEqual(expected);
  });

  it('treats further lines as a note', () => {
    expect(parseMention(`<@${BOT}> Sky Noon\nGrappling hooks!\nhttps://example.com`, { userId: BOT })).toEqual({
      game: 'Sky Noon',
      note: 'Grappling hooks!\nhttps://example.com',
    });
  });

  it.each([
    ['someone else', '<@123456789012345678> Hades II'],
    ['the bot mentioned mid-message', `hey <@${BOT}> Hades II`],
    ['@everyone', '@everyone we are playing **Hades II**'],
    ['a plain message', 'Hades II'],
  ])('ignores %s', (_label, content) => {
    expect(parseMention(content, { userId: BOT, roleId: ROLE })).toBeNull();
  });

  it('ignores role mentions when the bot has no role', () => {
    expect(parseMention(`<@&${ROLE}> Hades II`, { userId: BOT })).toBeNull();
  });
});

describe('postTitle', () => {
  const lookup = (name: string, exact: boolean) => ({
    query: 'q',
    match: { item: { id: 1, name }, exact, others: [] },
    game: { id: 1, name, url: '', description: '', isFree: true, comingSoon: false, multiplayer: [] },
  });

  it("uses Steam's spelling for an exact match, without trademark symbols", () => {
    expect(postTitle('hades 2', lookup('Hades II', true))).toBe('Hades II');
    expect(postTitle('apex legends', lookup('Apex Legends™', true))).toBe('Apex Legends');
  });

  it("keeps the typed name when Steam's match is only a guess, or there's no lookup", () => {
    expect(postTitle('deep rock', lookup('Deep Rock Galactic: Rogue Core', false))).toBe('deep rock');
    expect(postTitle('Skribbl.io', undefined)).toBe('Skribbl.io');
  });
});

describe('findExistingPost', () => {
  const posts = [{ name: 'Deceive Inc.' }, { name: '8-Player SpiderHeck' }, { name: 'Hades II' }, { name: 'Power Wash Simulator' }];

  it('matches ignoring case, punctuation, spacing and II vs 2', () => {
    expect(findExistingPost(posts, ['deceive inc'])).toBe(posts[0]);
    expect(findExistingPost(posts, ['8 player spiderheck'])).toBe(posts[1]);
    expect(findExistingPost(posts, ['Something', 'hades 2'])).toBe(posts[2]);
    expect(findExistingPost(posts, ['PowerWash Simulator'])).toBe(posts[3]);
  });

  it('returns undefined when nothing matches, or the name has no comparable letters', () => {
    expect(findExistingPost(posts, ['Sky Noon'])).toBeUndefined();
    expect(findExistingPost(posts, [''])).toBeUndefined();
    expect(findExistingPost([{ name: '原神' }], ['原神'])).toBeUndefined();
  });
});

describe('starterMessage', () => {
  it('credits the suggester, quotes the note, and pings nobody', () => {
    const message = starterMessage('Sky Noon', undefined, '42', 'So fun\n@everyone join');
    expect(message.content).toBe('💡 Suggested by <@42>\n> So fun\n> @everyone join');
    expect(message.allowedMentions).toEqual({ parse: [] });
    expect(message.embeds).toEqual([]);
  });

  it("says when the game isn't on Steam", () => {
    expect(starterMessage('Skribbl.io', { query: 'Skribbl.io' }, '42').content).toContain(
      "couldn't find **Skribbl.io** on Steam",
    );
  });

  it("stays within Discord's 2000-character limit even for a note with many short lines", () => {
    const note = Array.from({ length: 500 }, () => 'a').join('\n');
    const content = starterMessage('Skribbl.io', { query: 'Skribbl.io' }, '42', note).content ?? '';
    expect(content.length).toBeLessThanOrEqual(2000);
    expect(content).toContain('…');
    expect(content).toContain("couldn't find **Skribbl.io** on Steam");
  });
});

describe('resultText', () => {
  const post = { id: '7', name: 'Spellsworn', url: 'https://discord.com/channels/1/7' };

  it('links the post: a mention for a new post, a named link for an existing (possibly archived) one', () => {
    expect(resultText({ kind: 'created', post })).toContain('<#7>');
    expect(resultText({ kind: 'exists', post })).toContain('[Spellsworn](https://discord.com/channels/1/7) has already been suggested');
    expect(resultText({ kind: 'maybeExists', post })).toContain('Did you mean [Spellsworn](https://discord.com/channels/1/7)?');
    expect(resultText({ kind: 'invalid', reason: 'nope' })).toBe('nope');
  });

  it('explains an unsure match and how to add it anyway', () => {
    expect(resultText({ kind: 'unsure', query: 'deep rock', guess: 'Deep Rock Galactic' })).toContain(
      'Did you mean **Deep Rock Galactic**?',
    );
    const notFound = resultText({ kind: 'unsure', query: 'Skribbl.io' });
    expect(notFound).toContain("couldn't find **Skribbl.io** on Steam");
    expect(notFound).toContain('`/suggest game: Skribbl.io`');
    expect(resultText({ kind: 'unsure', query: 'Sky Noon', steamDown: true })).toContain("couldn't reach Steam");
  });
});

describe('autocompleteChoices', () => {
  const items = (...names: string[]) => names.map((name, i) => ({ id: i, name }));

  it("lists Steam's matches with the typed game first, without soundtracks or trademark symbols", () => {
    expect(autocompleteChoices('hades', items('Hades II', 'Hades II Original Soundtrack', 'Hades', 'Apex Legends™'))).toEqual(
      ['Hades', 'Hades II', 'Apex Legends'].map((name) => ({ name, value: name })),
    );
  });

  it('offers the typed text first when Steam does not list it', () => {
    expect(autocompleteChoices('skribbl.io', items('Skribblenauts')).map((c) => c.value)).toEqual(['skribbl.io', 'Skribblenauts']);
    expect(autocompleteChoices('board game night', [])).toEqual([{ name: 'board game night', value: 'board game night' }]);
  });

  it("stays within Discord's limits", () => {
    const many = items(...Array.from({ length: 40 }, (_, i) => `Game ${i}`), 'x'.repeat(101));
    const choices = autocompleteChoices('game', many);
    expect(choices).toHaveLength(25);
    expect(choices.every((c) => c.name.length <= 100)).toBe(true);
    expect(autocompleteChoices('   ', many)).toEqual([]);
  });
});

describe('createSuggester', () => {
  type Created = { name: string; message: { content: string; embeds: unknown[] } };
  type Post = { id: string; name: string; url: string; archivedAt: Date | null };

  /**
   * A forum whose archived posts are listed newest-archived first, `pageSize` at a time, honouring
   * `before` the way Discord does (so a wrong paging cursor would miss or repeat posts).
   */
  function fakeForum({ active = [] as string[], archived = [] as string[], pageSize = 2, guildId = 'G' } = {}) {
    const created: Created[] = [];
    const archivedCalls: { before?: Date }[] = [];
    const post = (name: string, archivedAt: Date | null): Post => ({ id: `post:${name}`, name, url: `https://discord.com/channels/G/post:${name}`, archivedAt });
    const archivedPosts = archived.map((name, i) => post(name, new Date(Date.UTC(2026, 0, 28 - i))));
    const forum = {
      guildId,
      threads: {
        fetchActive: async () => ({ threads: new Collection(active.map((name) => [name, post(name, null)])) }),
        fetchArchived: async (options: { before?: Date }) => {
          archivedCalls.push(options);
          const older = archivedPosts.filter((p) => !options.before || p.archivedAt! < options.before);
          const page = older.slice(0, pageSize);
          return { threads: new Collection(page.map((p) => [p.id, p])), hasMore: older.length > pageSize };
        },
        create: async (options: Created) => {
          created.push(options);
          return { id: 'new-post', name: options.name, url: 'https://discord.com/channels/G/new-post' };
        },
      },
    };
    return { forum: forum as unknown as ForumChannel, created, archivedCalls, archivedPosts };
  }

  /** Steam's search + app details for a set of (free) games. */
  function steam(games: { id: number; name: string }[]): typeof fetch {
    return (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.includes('storesearch')) {
        return new Response(JSON.stringify({ items: games.map((g) => ({ ...g, type: 'app' })) }));
      }
      const id = url.searchParams.get('appids') ?? '';
      const game = games.find((g) => String(g.id) === id);
      const body = game ? { success: true, data: { name: game.name, is_free: true, short_description: 'Fun.' } } : { success: false };
      return new Response(JSON.stringify({ [id]: body }));
    }) as typeof fetch;
  }

  const steamDown = (async () => {
    throw new Error('network down');
  }) as unknown as typeof fetch;

  const request = { userId: 'U1', userTag: 'player', guildId: 'G' };
  const HADES = { id: 1145350, name: 'Hades II' };
  const DRG = { id: 548430, name: 'Deep Rock Galactic' };

  it("creates a post titled with Steam's spelling, with the info card in its opening message", async () => {
    const { forum, created } = fakeForum({ active: ['Sky Noon'] });
    const suggester = createSuggester(async () => forum, { fetchFn: steam([HADES]) });

    const result = await suggester.suggest({ ...request, game: 'hades 2', note: 'Sequel!' });

    expect(result).toEqual({ kind: 'created', post: expect.objectContaining({ id: 'new-post' }) });
    expect(created).toHaveLength(1);
    expect(created[0]?.name).toBe('Hades II');
    expect(created[0]?.message.content).toBe('💡 Suggested by <@U1>\n> Sequel!');
    expect(created[0]?.message.embeds).toHaveLength(1);
  });

  it('cleans up the typed name', async () => {
    const { forum, created } = fakeForum();
    const suggester = createSuggester(async () => forum, { fetchFn: steam([]) });
    await suggester.suggest({ ...request, game: "**'Skribbl.io'**" });
    expect(created[0]?.name).toBe('Skribbl.io');
  });

  it('links an existing post instead of creating a duplicate, paging through all archived posts', async () => {
    const { forum, created, archivedCalls, archivedPosts } = fakeForum({
      archived: ['Sky Noon', 'Spellsworn', 'Prop Sumo', 'Hades II'],
    });
    const suggester = createSuggester(async () => forum, { fetchFn: steam([HADES]) });

    const result = await suggester.suggest({ ...request, game: 'Hades 2' });

    expect(result).toEqual({ kind: 'exists', post: expect.objectContaining({ id: 'post:Hades II' }) });
    expect(created).toHaveLength(0);
    // Two pages of two; the second starts before the first page's oldest post.
    expect(archivedCalls.map((c) => c.before)).toEqual([undefined, archivedPosts[1]?.archivedAt]);
  });

  it("points at Steam's guess when that game already has a post, instead of duplicating it", async () => {
    const { forum, created } = fakeForum({ archived: ['Deep Rock Galactic'] });
    const suggester = createSuggester(async () => forum, { fetchFn: steam([DRG]) });

    const result = await suggester.suggest({ ...request, game: 'deep rock' });

    expect(result).toEqual({ kind: 'maybeExists', post: expect.objectContaining({ id: 'post:Deep Rock Galactic' }) });
    expect(created).toHaveLength(0);
  });

  it("keeps the typed name and says so when the game isn't on Steam", async () => {
    const { forum, created } = fakeForum();
    const suggester = createSuggester(async () => forum, { fetchFn: steam([]) });

    await suggester.suggest({ ...request, game: 'Skribbl.io' });

    expect(created[0]?.name).toBe('Skribbl.io');
    expect(created[0]?.message.content).toContain("couldn't find **Skribbl.io** on Steam");
  });

  it('still creates the post when Steam is unreachable', async () => {
    const { forum, created } = fakeForum();
    const suggester = createSuggester(async () => forum, { fetchFn: steamDown });

    const result = await suggester.suggest({ ...request, game: 'Sky Noon' });

    expect(result.kind).toBe('created');
    expect(created[0]?.name).toBe('Sky Noon');
    expect(created[0]?.message).toMatchObject({ content: '💡 Suggested by <@U1>', embeds: [] });
  });

  it('looks up a pasted Steam store link by its app ID', async () => {
    const { forum, created } = fakeForum();
    const suggester = createSuggester(async () => forum, { fetchFn: steam([HADES]) });

    const result = await suggester.suggest({
      ...request,
      game: '<https://store.steampowered.com/app/1145350/Hades_II/>',
      requireExactMatch: true,
    });

    expect(result.kind).toBe('created');
    expect(created[0]?.name).toBe('Hades II');
    expect(created[0]?.message.embeds).toHaveLength(1);
  });

  it('finds the existing post for a pasted Steam link', async () => {
    const { forum, created } = fakeForum({ active: ['Hades II'] });
    const suggester = createSuggester(async () => forum, { fetchFn: steam([HADES]) });
    const result = await suggester.suggest({ ...request, game: 'https://store.steampowered.com/app/1145350/' });
    expect(result.kind).toBe('exists');
    expect(created).toHaveLength(0);
  });

  describe('with requireExactMatch (the @EGBot route)', () => {
    it('creates a post for an exact Steam match', async () => {
      const { forum, created } = fakeForum();
      const suggester = createSuggester(async () => forum, { fetchFn: steam([HADES]) });
      expect((await suggester.suggest({ ...request, game: 'hades 2', requireExactMatch: true })).kind).toBe('created');
      expect(created).toHaveLength(1);
    });

    it.each([
      ['a best guess', 'deep rock', steam([DRG]), { kind: 'unsure', query: 'deep rock', guess: 'Deep Rock Galactic' }],
      ['chat that matches nothing', 'thanks!', steam([]), { kind: 'unsure', query: 'thanks!' }],
      ['Steam being down', 'Sky Noon', steamDown, { kind: 'unsure', query: 'Sky Noon', steamDown: true }],
    ])("doesn't create a post for %s", async (_label, game, fetchFn, expected) => {
      const { forum, created } = fakeForum();
      const suggester = createSuggester(async () => forum, { fetchFn });
      expect(await suggester.suggest({ ...request, game, requireExactMatch: true })).toEqual(expected);
      expect(created).toHaveLength(0);
    });
  });

  it('answers help, empty, overlong and link-only input without creating anything', async () => {
    const { forum, created } = fakeForum();
    const suggester = createSuggester(async () => forum, { fetchFn: steam([]) });

    expect(await suggester.suggest({ ...request, game: '  ** ' })).toEqual({ kind: 'invalid', reason: USAGE });
    expect(await suggester.suggest({ ...request, game: 'help' })).toEqual({ kind: 'invalid', reason: USAGE });
    expect(await suggester.suggest({ ...request, game: '?' })).toEqual({ kind: 'invalid', reason: USAGE });
    expect((await suggester.suggest({ ...request, game: 'x'.repeat(101) })).kind).toBe('invalid');
    expect(await suggester.suggest({ ...request, game: 'https://skribbl.io' })).toMatchObject({
      kind: 'invalid',
      reason: expect.stringContaining('Steam store links'),
    });
    expect(created).toHaveLength(0);
  });

  it('refuses servers other than the forum’s', async () => {
    const { forum, created } = fakeForum();
    const suggester = createSuggester(async () => forum, { fetchFn: steam([HADES]) });
    expect((await suggester.suggest({ ...request, game: 'Hades II', guildId: 'OTHER' })).kind).toBe('invalid');
    expect(created).toHaveLength(0);
  });
});
