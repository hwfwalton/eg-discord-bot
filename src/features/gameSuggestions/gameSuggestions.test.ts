// Tests the "@EGBot <game>" wiring with a fake Discord client: which messages get an answer.
import { EventEmitter } from 'node:events';
import { ChannelType, type Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { registerGameSuggestions } from './gameSuggestions.ts';
import { USAGE } from './suggest.ts';

const BOT = '345678901234567890';
const FORUM_GUILD = 'G';

function setup() {
  const forum = { type: ChannelType.GuildForum, guildId: FORUM_GUILD };
  const client = Object.assign(new EventEmitter(), {
    user: { id: BOT },
    channels: { fetch: vi.fn(async () => forum) },
  });
  registerGameSuggestions(client as unknown as Client, { forumChannelId: 'F', itadApiKey: 'unused' });
  return client;
}

function message({ content, guildId = FORUM_GUILD, bot = false }: { content: string; guildId?: string; bot?: boolean }) {
  return {
    content,
    guildId,
    author: { id: 'U1', tag: 'player', bot },
    inGuild: () => true,
    guild: { members: { me: { roles: { botRole: { id: 'ROLE' } } } } },
    channel: { sendTyping: vi.fn(async () => undefined) },
    reply: vi.fn(async () => undefined),
  };
}

/** Lets the async message handler run to completion. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('@EGBot mentions', () => {
  it('answers in the server whose forum this instance manages', async () => {
    const client = setup();
    const msg = message({ content: `<@${BOT}> help` });
    client.emit('messageCreate', msg);
    await settle();
    expect(msg.reply).toHaveBeenCalledWith(expect.objectContaining({ content: USAGE }));
  });

  it("stays silent in another server (dev and prod share one bot account)", async () => {
    const client = setup();
    const msg = message({ content: `<@${BOT}> help`, guildId: 'OTHER' });
    client.emit('messageCreate', msg);
    await settle();
    expect(msg.reply).not.toHaveBeenCalled();
    expect(msg.channel.sendTyping).not.toHaveBeenCalled();
  });

  it.each([
    ['messages that do not start with a mention of the bot', message({ content: 'Hades II' })],
    ["other bots' messages", message({ content: `<@${BOT}> help`, bot: true })],
  ])('ignores %s', async (_label, msg) => {
    const client = setup();
    client.emit('messageCreate', msg);
    await settle();
    expect(msg.reply).not.toHaveBeenCalled();
  });
});
