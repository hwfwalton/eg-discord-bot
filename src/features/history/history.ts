// Discord wiring for the session record: gives the recorder (recorder.ts) the announcements channel
// as its source of newer sessions, and decides when it runs. The history site (a separate repo)
// reads the same folder; the bot serves no page.
import { Events, type Client, type Message, type PartialMessage } from 'discord.js';
import type { GameNightConfig, HistoryConfig } from '../../config.ts';
import { log } from '../../log.ts';
import { createSchedule } from '../gameNight/plan.ts';
import type { AnnouncementPost } from './live.ts';
import { createRecorder, type LiveSource } from './recorder.ts';

/** Fetched announcements are reused for this long (unless one is posted, edited or deleted). */
const POSTS_MAX_AGE_MS = 5 * 60_000;
/** 100 posts a page: far more than the weeks since the record's last row should ever need. */
const MAX_POST_PAGES = 5;
/** How often the bot checks whether a run is due. Most checks only look at the folder, not Discord. */
const CHECK_EVERY_MS = 3600_000;
/** An announcement edited a few times in a row gives one run. */
const DEBOUNCE_MS = 5_000;

/**
 * Keeps the record in config.dir up to date from the announcements channel game night reads. The
 * timers are unref'd and do nothing once the client is destroyed, so shutdown needs no extra step.
 */
export function registerSessionRecord(client: Client, config: HistoryConfig, gameNight: GameNightConfig): void {
  const announcements = announcementsSource(client, gameNight);
  const recorder = createRecorder({ dir: config.dir, timezone: gameNight.timezone, live: announcements.source });

  let running = false;
  /** Asked for again while a run was going: one more run follows it. */
  let again = false;
  async function run(): Promise<void> {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await recorder.run();
      } while (again);
    } catch (err) {
      log.warn('Session record: updating the record failed', err);
    } finally {
      running = false;
    }
  }

  client.once(Events.ClientReady, () => {
    log.info(`Session record: keeping ${config.dir} up to date`);
    void run();
  });

  const timer = setInterval(() => {
    if (running || !client.isReady()) return;
    recorder.due().then(
      (due) => {
        if (due) void run();
      },
      (err: unknown) => log.warn(`Session record: could not read ${config.dir}`, err),
    );
  }, CHECK_EVERY_MS);
  // Never keeps the process alive on its own.
  timer.unref();

  // A new, edited or deleted announcement can change the latest sessions and next.json.
  let debounce: NodeJS.Timeout | undefined;
  const changed = (message: Message | PartialMessage) => {
    // Channel IDs are unique across servers, so this also keeps to this instance's own server.
    if (message.channelId !== gameNight.announcementsChannelId) return;
    announcements.forget();
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (client.isReady()) void run();
    }, DEBOUNCE_MS);
    debounce.unref();
  };
  client.on(Events.MessageCreate, changed);
  client.on(Events.MessageUpdate, (_before, after) => changed(after));
  client.on(Events.MessageDelete, changed);
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
