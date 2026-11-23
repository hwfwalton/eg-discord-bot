// Suggesting a game: creates a post for it in the game ideas forum, or points at the existing post.
// Used by both `/suggest` and "@EGBot <game>".
//
// The bot puts the game's info card in the new post's opening message itself instead of leaving it
// to the forum's "new post" handler: discord.js can report a post the bot just created without its
// "newly created" flag (so the handler would skip it), and the forum's guidelines want a short
// description at the top of each post anyway.
//
// "@EGBot ..." only creates a post for an exact Steam match, since chat like "@EGBot thanks!" also
// starts with a mention. `/suggest` is the deliberate route and accepts any name.
import {
  DiscordAPIError,
  RESTJSONErrorCodes,
  type ApplicationCommandOptionChoiceData,
  type ForumChannel,
  type GuildForumThreadMessageCreateOptions,
  type MessageCreateOptions,
  type ThreadChannel,
} from 'discord.js';
import { cleanGameName, displayGameName, gameKey } from '../../gameName.ts';
import { log } from '../../log.ts';
import {
  type GameLookup,
  type LookupDeps,
  gameInfoEmbed,
  lookUpGame,
  lookUpSteamApp,
  notFoundText,
  withResearch,
} from './gameInfo.ts';
import { type SteamSearchItem, isUnwantedExtra, steamAppIdFromLink } from './steam.ts';
import { chooseTags, tagIdsFor } from './tags.ts';

/** Discord's limit for post (thread) names. */
export const MAX_TITLE_LENGTH = 100;
export const MAX_NOTE_LENGTH = 1000;
/** Discord's limit for a message's text. */
const MAX_CONTENT_LENGTH = 2000;
/** Archived posts are listed 100 at a time; check at most this many pages for duplicates. */
const MAX_ARCHIVE_PAGES = 10;
/** Discord's limit for autocomplete choices. */
const MAX_CHOICES = 25;

export const USAGE =
  'Tell me which game, e.g. `@EGBot Hades II` (a Steam store link works too), or use `/suggest` to pick from Steam as you type.';
const HELP = /^(?:help|\?+|how|usage|commands?)$/i;
const ANY_LINK = /https?:\/\/\S+/i;

export interface SuggestionRequest {
  game: string;
  /** Optional extra text for the post, e.g. why it'd be fun. */
  note?: string;
}

export interface SuggestOptions {
  userId: string;
  userTag: string;
  guildId: string;
  /** Only create a post when Steam has an exact match (for "@EGBot", where chat can look like a name). */
  requireExactMatch?: boolean;
}

/** The parts of a forum post (thread) the replies need. */
export interface PostRef {
  id: string;
  name: string;
  url: string;
}

export type SuggestResult =
  | { kind: 'created'; post: PostRef }
  | { kind: 'exists'; post: PostRef }
  /** Steam's best guess for the name already has a post. */
  | { kind: 'maybeExists'; post: PostRef }
  /** requireExactMatch was set and Steam had no exact match, so nothing was created. */
  | { kind: 'unsure'; query: string; guess?: string; steamDown?: boolean }
  | { kind: 'invalid'; reason: string };

/**
 * Reads "@EGBot <game>" (or "@EGBot suggest <game>"). The first line after the mention is the game;
 * any further lines are a note. Returns null when the message doesn't start by mentioning the bot,
 * either as a user or via its own role (Discord offers both when you type "@EGBot").
 */
export function parseMention(content: string, bot: { userId: string; roleId?: string }): SuggestionRequest | null {
  const mention = content.match(/^\s*<@([!&]?)(\d+)>/);
  if (!mention) return null;
  const [whole, kind, id] = mention;
  const forBot = kind === '&' ? bot.roleId !== undefined && id === bot.roleId : id === bot.userId;
  if (!forBot) return null;

  const lines = content
    .slice(whole.length)
    .replace(/^[\s,:]*(?:suggest|add)\b[\s:]*/i, '')
    .split('\n');
  const gameLine = lines.findIndex((line) => line.trim() !== '');
  if (gameLine === -1) return { game: '' };
  const note = lines
    .slice(gameLine + 1)
    .join('\n')
    .trim();
  // Raw first line: suggest() cleans it, after checking it for a Steam link.
  return { game: (lines[gameLine] ?? '').trim(), ...(note && { note }) };
}

/** The post title: Steam's spelling when it's an exact match ("hades 2" -> "Hades II"), else as typed. */
export function postTitle(query: string, lookup: GameLookup | undefined): string {
  const name = lookup?.match?.exact && lookup.game ? displayGameName(lookup.game.name) : query;
  return name.slice(0, MAX_TITLE_LENGTH).trim() || query;
}

/** An existing post whose title is the same game as any of the names (see gameKey). */
export function findExistingPost<T extends { name: string }>(posts: Iterable<T>, names: string[]): T | undefined {
  const wanted = new Set(names.map(gameKey).filter(Boolean));
  for (const post of posts) {
    if (wanted.has(gameKey(post.name))) return post;
  }
  return undefined;
}

/**
 * The new post's opening message: the game's info card, or a line saying why there isn't one.
 * `lookup` is undefined when Steam couldn't be reached.
 */
export function starterMessage(query: string, lookup: GameLookup | undefined): GuildForumThreadMessageCreateOptions {
  const embed = lookup ? gameInfoEmbed(lookup) : undefined;
  if (embed) return { embeds: [embed], allowedMentions: { parse: [] } };
  // A forum post's opening message can't be empty.
  const content = lookup ? notFoundText(query) : `⚠️ I couldn't reach Steam to look up **${query}**.`;
  return { content, allowedMentions: { parse: [] } };
}

/**
 * The first reply in a new post: who suggested it, and their note. A reply rather than part of the
 * opening message, so the post counts as active in Discord's channel list (posts with no replies don't).
 */
export function creditMessage(suggestedById: string, note?: string): MessageCreateOptions {
  const header = `💡 Suggested by <@${suggestedById}>`;
  const lines = [header];
  const trimmedNote = note?.trim();
  if (trimmedNote) {
    // Quoting adds "> " per line, so cap the result too, not just the note.
    lines.push(truncate(quote(truncate(trimmedNote, MAX_NOTE_LENGTH)), MAX_CONTENT_LENGTH - header.length - 1));
  }
  // No pings: not the suggester, and not anything their note mentions.
  return { content: lines.join('\n'), allowedMentions: { parse: [] } };
}

export function resultText(result: SuggestResult): string {
  switch (result.kind) {
    case 'created':
      return `✅ Added <#${result.post.id}> to the game ideas. Thanks for the suggestion!`;
    case 'exists':
      return `💡 ${postLink(result.post)} has already been suggested. Add your thoughts there!`;
    case 'maybeExists':
      return `💡 Did you mean ${postLink(result.post)}? It's already been suggested, so add your thoughts there! If you meant a different game, try its full name.`;
    case 'unsure': {
      const typed = result.query.replace(/`/g, "'");
      const asIs = `To add it as written, use \`/suggest game: ${typed}\`.`;
      if (result.guess) {
        return `🤔 I'm not sure which game “${typed}” is. Did you mean **${result.guess}**? If so, mention me with that name. ${asIs}`;
      }
      return result.steamDown
        ? `⚠️ I couldn't reach Steam to check **${typed}**. ${asIs}`
        : `🔍 I couldn't find **${typed}** on Steam. ${asIs}`;
    }
    case 'invalid':
      return result.reason;
  }
}

/**
 * `/suggest` autocomplete: Steam's matches for what's been typed so far, minus soundtracks/demos.
 * The game matching what was typed goes first, so Enter picks it ("hades" -> Hades, not Hades II);
 * if Steam doesn't list it, the typed text itself goes first, so non-Steam games still work.
 */
export function autocompleteChoices(typed: string, items: SteamSearchItem[]): ApplicationCommandOptionChoiceData<string>[] {
  const query = typed.trim().slice(0, MAX_TITLE_LENGTH);
  if (!query) return [];
  const names: string[] = [];
  for (const item of items) {
    const name = displayGameName(item.name);
    if (!name || name.length > MAX_TITLE_LENGTH || isUnwantedExtra(name, query) || names.includes(name)) continue;
    names.push(name);
  }
  const key = gameKey(query);
  const exact = key ? names.findIndex((name) => gameKey(name) === key) : -1;
  const ordered = exact >= 0 ? [names[exact]!, ...names.filter((_, i) => i !== exact)] : [query, ...names];
  return ordered.slice(0, MAX_CHOICES).map((name) => ({ name, value: name }));
}

export interface Suggester {
  suggest(request: SuggestionRequest & SuggestOptions): Promise<SuggestResult>;
}

export function createSuggester(getForum: () => Promise<ForumChannel>, deps: LookupDeps = {}): Suggester {
  /** Suggestions being created, by gameKey of the post title. */
  const inProgress = new Map<string, Promise<SuggestResult>>();

  return {
    async suggest({ game, note, userId, userTag, guildId, requireExactMatch = false }) {
      const appId = steamAppIdFromLink(game);
      const query = appId ? '' : cleanGameName(game);
      if (!appId) {
        if (ANY_LINK.test(game)) {
          return { kind: 'invalid', reason: "I can only look up Steam store links. Tell me the game's name instead." };
        }
        if (!query || HELP.test(query)) return { kind: 'invalid', reason: USAGE };
        if (query.length > MAX_TITLE_LENGTH) {
          return { kind: 'invalid', reason: `That name is too long for a post title (max ${MAX_TITLE_LENGTH} characters).` };
        }
      }

      const forum = await getForum();
      if (forum.guildId !== guildId) {
        return { kind: 'invalid', reason: "This server doesn't have a game ideas forum set up for me." };
      }

      let lookup: GameLookup | undefined;
      try {
        // Research (slow) waits until we know a post will be created; see below.
        const quick = { ...deps, researcher: undefined };
        lookup = appId ? await lookUpSteamApp(appId, quick) : await lookUpGame(query, quick);
      } catch (err) {
        log.warn(`Steam lookup failed for suggestion "${appId ?? query}"`, err);
      }
      if (appId && !lookup) {
        return { kind: 'invalid', reason: "I couldn't look up that Steam link. Check it, or tell me the game's name instead." };
      }
      // For a link, the game's name comes from Steam.
      const name = appId && lookup ? lookup.query : query;
      const title = postTitle(name, lookup);

      // Research takes a few seconds, so a repeated "@EGBot <game>" (or two people suggesting the same
      // game) can arrive before the first post exists. It waits for that one instead of duplicating it.
      const key = gameKey(title) || title.toLowerCase();
      for (let earlier = inProgress.get(key); earlier; earlier = inProgress.get(key)) {
        const result = await earlier.catch(() => undefined);
        if (result?.kind === 'created') return { kind: 'exists', post: result.post };
      }
      const run = createUnlessPosted();
      inProgress.set(key, run);
      // Registered before anyone waits on `run`, so the entry is gone by the time they check again.
      run.finally(() => inProgress.delete(key)).catch(() => {});
      return run;

      async function createUnlessPosted(): Promise<SuggestResult> {
        const posts = await listPosts(forum);
        const existing = findExistingPost(posts, [title, name]);
        if (existing) return { kind: 'exists', post: existing };

        // "deep rock" isn't an exact match, but Steam's guess (Deep Rock Galactic) may already have a post.
        const guess = lookup?.match && !lookup.match.exact && lookup.game ? displayGameName(lookup.game.name) : undefined;
        const guessedPost = guess ? findExistingPost(posts, [guess]) : undefined;
        if (guessedPost) return { kind: 'maybeExists', post: guessedPost };

        if (requireExactMatch && !lookup?.match?.exact) {
          return { kind: 'unsure', query: name, ...(guess && { guess }), ...(!lookup && { steamDown: true }) };
        }

        if (lookup) lookup = await withResearch(lookup, deps.researcher);
        const message = starterMessage(name, lookup);
        const appliedTags = lookup ? tagIdsFor(chooseTags(lookup), forum.availableTags ?? []) : [];
        const reason = `Game suggestion from ${userTag}`;
        let post;
        try {
          post = await forum.threads.create({ name: title, message, appliedTags, reason });
        } catch (err) {
          // A tag the bot isn't allowed to set (e.g. a moderated one) shouldn't cost the whole post.
          if (!(err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.MissingPermissions && appliedTags.length)) throw err;
          log.warn(`Creating "${title}" with tags was refused; creating it without tags`, err);
          post = await forum.threads.create({ name: title, message, appliedTags: [], reason });
        }
        log.info(`Created game suggestion post "${title}" for ${userTag}`);
        try {
          await post.send(creditMessage(userId, note));
        } catch (err) {
          // The post exists, so this is still a success for the suggester.
          log.warn(`Crediting ${userTag} in "${title}" failed`, err);
        }
        return { kind: 'created', post };
      }
    },
  };
}

/** Every post in the forum: the open ones, then archived ones (most posts end up archived). */
async function listPosts(forum: ForumChannel): Promise<ThreadChannel[]> {
  const posts: ThreadChannel[] = [...(await forum.threads.fetchActive()).threads.values()];
  let before: Date | undefined;
  for (let page = 0; page < MAX_ARCHIVE_PAGES; page++) {
    const { threads, hasMore } = await forum.threads.fetchArchived({ type: 'public', before, limit: 100 });
    posts.push(...threads.values());
    // Pages come newest-archived first; the next page starts before this page's oldest post.
    const oldest = threads.last()?.archivedAt;
    if (!hasMore || !oldest) return posts;
    before = oldest;
  }
  log.warn(`Checked only the newest ${MAX_ARCHIVE_PAGES * 100} archived posts for duplicates`);
  return posts;
}

/**
 * A named link to an existing post. Not a <#id> mention: Discord shows those as "#unknown" for posts
 * the reader's app hasn't loaded, which includes most archived forum posts.
 */
function postLink(post: PostRef): string {
  return `[${post.name.replace(/[[\]]/g, '')}](${post.url})`;
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/** Shortens text to at most `max` UTF-16 units, ending with "…", without splitting an emoji. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, Math.max(0, max - 1));
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut}…`;
}
