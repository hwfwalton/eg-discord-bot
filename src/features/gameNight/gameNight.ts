// Discord wiring for the weekly game-night reminder:
// - at each scheduled start, read #announcements and post an @everyone message (unless cancelled)
// - when someone posts or edits an announcement, DM them what the bot understood
import { setTimeout as sleep } from 'node:timers/promises';
import { Cron } from 'croner';
import { Events, type Client, type Message, type PartialMessage, type TextBasedChannel } from 'discord.js';
import type { GameNightConfig } from '../../config.ts';
import { log } from '../../log.ts';
import { createGeminiReader, withGeminiFallback } from './geminiReader.ts';
import { describePlan, heldOffMessage, startMessage } from './messages.ts';
import {
  type Announcement,
  type Plan,
  type Session,
  createSchedule,
  decidePlan,
  latestSession,
  nextSession,
  planWithRetries,
  sessionStartingAt,
} from './plan.ts';

/** If the bot was offline at start time, still post when it comes back within this long. */
const CATCH_UP_MS = 30 * 60_000;
/** At game time, how long to wait between attempts when Gemini can't be reached (about 7 minutes in all). */
const GAME_TIME_RETRY_DELAYS_MS = [60_000, 120_000, 240_000];

export interface GameNight {
  /** What will happen at the next session (for /gamenight). */
  describeNext(): Promise<string>;
}

export function registerGameNight(client: Client, config: GameNightConfig): GameNight {
  const schedule = createSchedule(config.schedule, config.timezone);
  // Template parser first; Gemini (if configured) for announcements that don't follow the template.
  const read = withGeminiFallback(
    config.gemini ? createGeminiReader({ ...config.gemini, timezone: config.timezone }) : undefined,
  );
  log.info(`Game night: Gemini fallback ${config.gemini ? `on (${config.gemini.model})` : 'off (no GEMINI_API_KEY)'}`);

  async function fetchTextChannel(id: string): Promise<TextBasedChannel> {
    const channel = await client.channels.fetch(id);
    if (!channel?.isTextBased()) throw new Error(`Channel ${id} isn't a text channel the bot can see.`);
    return channel;
  }

  async function planFor(session: Session): Promise<Plan> {
    const channel = await fetchTextChannel(config.announcementsChannelId);
    // 50 is plenty for a week of announcements.
    const messages = await channel.messages.fetch({ limit: 50 });
    const announcements: Announcement[] = [...messages.values()]
      .filter((m) => !m.author.bot)
      .map((m) => ({ id: m.id, url: m.url, authorId: m.author.id, content: m.content, createdAt: m.createdAt }));
    return decidePlan(announcements, session, read);
  }

  async function alreadyPosted(session: Session): Promise<boolean> {
    const channel = await fetchTextChannel(config.startChannelId);
    const recent = await channel.messages.fetch({ limit: 50 });
    // Only this session's post counts: last week's was posted just after last week's start.
    const since = session.startsAt.getTime() - 60_000;
    return recent.some(
      (m) => m.author.id === client.user?.id && m.mentions.everyone && m.createdTimestamp >= since,
    );
  }

  async function runSession(session: Session): Promise<void> {
    const at = session.startsAt.toISOString();
    // If Gemini couldn't be reached, the start post can wait a few minutes for it to come back.
    const plan = await planWithRetries(() => planFor(session), GAME_TIME_RETRY_DELAYS_MS, sleep, (wait) =>
      log.warn(`Game night ${at}: couldn't read an announcement; trying again in ${wait / 1000}s`),
    );
    if (plan.kind === 'unsure') {
      log.warn(`Game night ${at}: not posting (unsure: ${plan.reason})`);
      await tellAuthorWeHeldOff(plan);
      return;
    }
    const content = startMessage(plan);
    if (!content) {
      log.info(`Game night ${session.startsAt.toISOString()}: not posting (${plan.kind})`);
      return;
    }
    if (await alreadyPosted(session)) {
      log.info(`Game night ${session.startsAt.toISOString()}: start message already posted`);
      return;
    }
    const channel = await fetchTextChannel(config.startChannelId);
    if (!channel.isSendable()) throw new Error(`Can't send messages in channel ${config.startChannelId}.`);
    await channel.send({ content, allowedMentions: { parse: ['everyone'] } });
    log.info(`Game night ${session.startsAt.toISOString()}: announced ${plan.kind === 'game' ? plan.game : ''}`);
  }

  /** At game time, if the bot didn't post because it was unsure, tell the announcement's author. */
  async function tellAuthorWeHeldOff(plan: Extract<Plan, { kind: 'unsure' }>): Promise<void> {
    try {
      const author = await client.users.fetch(plan.source.authorId);
      await author.send(heldOffMessage(plan));
    } catch (err) {
      log.warn(`Couldn't DM the author of announcement ${plan.source.id} that game night wasn't posted`, err);
    }
  }

  async function onAnnouncement(message: Message): Promise<void> {
    if (message.channelId !== config.announcementsChannelId || message.author.bot) return;
    const session = nextSession(schedule);
    const description = describePlan(await planFor(session), session, config.startChannelId);
    try {
      await message.author.send(`📣 I saw your announcement. Here's the plan for game night:\n\n${description}`);
    } catch (err) {
      log.warn(`Couldn't DM ${message.author.tag} about their announcement (DMs closed?)`, err);
    }
  }

  async function onAnnouncementEdit(before: Message | PartialMessage, after: Message | PartialMessage) {
    if (after.channelId !== config.announcementsChannelId) return;
    // Link previews loading also fire an update; only react to real edits.
    if (!after.editedTimestamp || before.editedTimestamp === after.editedTimestamp) return;
    await onAnnouncement(after.partial ? await after.fetch() : after);
  }

  client.once(Events.ClientReady, () => {
    new Cron(config.schedule, { timezone: config.timezone, protect: true }, (job: Cron) => {
      const startsAt = job.currentRun() ?? new Date();
      runSession(sessionStartingAt(schedule, startsAt)).catch((err) => log.error('Game night run failed', err));
    });
    log.info(`Game night scheduled; next session ${nextSession(schedule).startsAt.toISOString()}`);

    // Read this week's announcements now, so any Gemini readings are cached well before game time
    // (the cache is in memory, so a restart empties it).
    planFor(nextSession(schedule))
      .then((plan) => log.info(`Game night: plan for the next session is "${plan.kind}"`))
      .catch((err) => log.warn('Game night: reading this week’s announcements failed', err));

    // Catch up if we were offline at start time.
    const latest = latestSession(schedule);
    if (Date.now() - latest.startsAt.getTime() < CATCH_UP_MS) {
      log.info('Started shortly after a game night start time; checking whether to post');
      runSession(latest).catch((err) => log.error('Game night catch-up failed', err));
    }
  });

  client.on(Events.MessageCreate, (message) => {
    onAnnouncement(message).catch((err) => log.error('Handling announcement failed', err));
  });
  client.on(Events.MessageUpdate, (before, after) => {
    onAnnouncementEdit(before, after).catch((err) => log.error('Handling announcement edit failed', err));
  });

  return {
    async describeNext() {
      const session = nextSession(schedule);
      return describePlan(await planFor(session), session, config.startChannelId);
    },
  };
}
