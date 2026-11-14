// Discord wiring for the weekly game-night reminder:
// - at each scheduled start, read #announcements and post an @everyone message (unless cancelled)
// - when someone posts or edits an announcement, DM them what the bot understood
import { Cron } from 'croner';
import { Events, type Client, type Message, type PartialMessage, type TextBasedChannel } from 'discord.js';
import type { GameNightConfig } from '../../config.ts';
import { log } from '../../log.ts';
import { describePlan, startMessage } from './messages.ts';
import {
  type Announcement,
  type Plan,
  type Session,
  createSchedule,
  decidePlan,
  latestSession,
  nextSession,
  sessionStartingAt,
} from './plan.ts';

/** If the bot was offline at start time, still post when it comes back within this long. */
const CATCH_UP_MS = 30 * 60_000;

export interface GameNight {
  /** What will happen at the next session (for /gamenight). */
  describeNext(): Promise<string>;
}

export function registerGameNight(client: Client, config: GameNightConfig): GameNight {
  const schedule = createSchedule(config.schedule, config.timezone);

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
    return decidePlan(announcements, session);
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
    const plan = await planFor(session);
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
