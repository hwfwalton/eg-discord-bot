// Discord wiring for the session history page: serves the page (server.ts) and gives the record
// (store.ts) the announcements channel as its source of newer sessions.
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { Events, type Client, type Message, type PartialMessage } from 'discord.js';
import type { GameNightConfig, HistoryConfig } from '../../config.ts';
import { log } from '../../log.ts';
import { createSchedule } from '../gameNight/plan.ts';
import type { AnnouncementPost } from './live.ts';
import { formatCsv } from './record.ts';
import { createHistoryHandler } from './server.ts';
import { gamesExport, sessionsExport } from './stats.ts';
import { GAMES_FILE, SESSIONS_FILE, createHistoryStore, type HistoryStore, type LiveSource } from './store.ts';

/** The page itself: index.html, styles.css and its TypeScript modules. */
const CLIENT_DIR = join(import.meta.dirname, 'client');
/** The announcements are re-read at most this often (and whenever one is posted, edited or deleted). */
const POSTS_MAX_AGE_MS = 5 * 60_000;
/** 100 posts a page: far more than the weeks since the record's last row should ever need. */
const MAX_POST_PAGES = 5;

export interface History {
  close(): void;
}

/**
 * Starts the history page. With game night configured, the weeks since the record's last row come
 * from the announcements channel; without it the page shows the files as they are.
 */
export function registerHistory(client: Client, config: HistoryConfig, gameNight?: GameNightConfig): History | undefined {
  const announcements = gameNight ? announcementsSource(client, gameNight) : undefined;
  const store = createHistoryStore({
    dir: config.dir,
    title: config.title,
    timezone: config.timezone,
    ...(announcements && { live: announcements.source }),
  });
  if (!gameNight) log.info('History page: game night is off, so new sessions are not added to the record automatically');

  if (gameNight && announcements) {
    // A new, edited or deleted announcement can change the latest sessions: look again on the next load.
    const changed = (message: Message | PartialMessage) => {
      if (message.channelId !== gameNight.announcementsChannelId) return;
      announcements.forget();
      store.invalidate();
    };
    client.on(Events.MessageCreate, changed);
    client.on(Events.MessageUpdate, (_before, after) => changed(after));
    client.on(Events.MessageDelete, changed);
  }

  try {
    const server = startHistoryServer(config, store);
    return { close: () => void server.close() };
  } catch (err) {
    // A broken page must not take the bot down with it.
    log.error('History page: could not start', err);
    return undefined;
  }
}

/** Serves the page for a record. Also used on its own by `npm run history` (no Discord). */
export function startHistoryServer(config: HistoryConfig, store: HistoryStore): Server {
  const handler = createHistoryHandler({
    clientDir: CLIENT_DIR,
    getData: () => store.getData(),
    downloads: {
      [SESSIONS_FILE]: (data) => formatCsv(sessionsExport(data)),
      [GAMES_FILE]: (data) => formatCsv(gamesExport(data)),
    },
    // While developing, pick up edits to the page without restarting.
    reload: process.env.HISTORY_RELOAD === '1',
    allowedHosts: config.allowedHosts,
    log,
  });
  const server = createServer(handler);
  // The page only ever answers small GET requests, so slow or stuck clients are dropped early.
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.timeout = 30_000;
  server.maxConnections = 64;
  server.on('error', (err) => log.error(`History page: could not listen on ${config.host}:${config.port}`, err));
  server.listen(config.port, config.host, () => {
    const shownHost = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
    log.info(`History page: http://${shownHost}:${config.port}/ (record in ${config.dir})`);
  });
  return server;
}

function announcementsSource(client: Client, gameNight: GameNightConfig): { source: LiveSource; forget(): void } {
  let cache: { posts: AnnouncementPost[]; since: number; at: number } | undefined;
  /** Goes up whenever an announcement changes, so a fetch that began before the change isn't kept. */
  let version = 0;
  return {
    forget() {
      cache = undefined;
      version++;
    },
    source: {
      schedule: createSchedule(gameNight.schedule, gameNight.timezone),
      async fetchPosts(since) {
        if (!client.isReady()) return undefined;
        if (cache && cache.since <= since.getTime() && Date.now() - cache.at < POSTS_MAX_AGE_MS) return cache.posts;

        const channel = await client.channels.fetch(gameNight.announcementsChannelId);
        if (!channel?.isTextBased()) throw new Error(`Channel ${gameNight.announcementsChannelId} isn't a text channel the bot can see.`);
        const posts: AnnouncementPost[] = [];
        const startedAt = version;
        let reached = false;
        let before: string | undefined;
        for (let page = 0; page < MAX_POST_PAGES; page++) {
          const messages = await channel.messages.fetch({ limit: 100, ...(before && { before }) });
          if (messages.size === 0) {
            reached = true;
            break;
          }
          let oldest: Message | undefined;
          for (const message of messages.values()) {
            if (!oldest || message.createdTimestamp < oldest.createdTimestamp) oldest = message;
            if (message.author.bot) continue;
            posts.push({
              id: message.id,
              url: message.url,
              authorId: message.author.id,
              authorName: message.author.displayName,
              content: message.content,
              createdAt: message.createdAt,
            });
          }
          if (!oldest || oldest.createdTimestamp < since.getTime()) {
            reached = true;
            break;
          }
          before = oldest.id;
        }
        // Stopping short would record the newest weeks and skip the ones in between for good.
        if (!reached && before) throw new Error(`More than ${MAX_POST_PAGES * 100} announcements since the record's last row.`);
        if (startedAt === version) cache = { posts, since: since.getTime(), at: Date.now() };
        return posts;
      },
    },
  };
}
