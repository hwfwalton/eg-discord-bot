import { describe, expect, it } from 'vitest';
import { describePlan, heldOffMessage, startMessage } from './messages.ts';
import type { Plan, Session } from './plan.ts';

const source = { id: '1', url: 'https://discord.com/channels/1/2/3', authorId: '9', content: '', createdAt: new Date() };
const session: Session = { startsAt: new Date('2026-11-21T18:30:00Z'), windowStart: new Date('2026-11-14T18:30:00Z') };

describe('startMessage', () => {
  it('names the session and game, and includes the Steam link', () => {
    const plan: Plan = { kind: 'game', game: 'Plucked Demo', label: 'EG288', link: 'https://store.steampowered.com/app/5367360/', source };
    expect(startMessage(plan)).toBe(
      "@everyone 🎮 **EG288** is starting now! We're playing **Plucked Demo**.\n" +
        'https://store.steampowered.com/app/5367360/\n' +
        '-# Details in [the announcement](https://discord.com/channels/1/2/3)',
    );
  });

  it('falls back to a generic line without a label or link', () => {
    expect(startMessage({ kind: 'game', game: 'Sky Noon', source })).toBe(
      "@everyone 🎮 Game night is starting now! We're playing **Sky Noon**.\n-# Details in [the announcement](https://discord.com/channels/1/2/3)",
    );
  });

  it('posts nothing when cancelled or unknown', () => {
    expect(startMessage({ kind: 'cancelled', phrase: 'cancel', source })).toBeNull();
    expect(startMessage({ kind: 'none' })).toBeNull();
  });
});

describe('describePlan', () => {
  it('previews the exact start post, quoted', () => {
    const text = describePlan({ kind: 'game', game: 'Sky Noon', label: 'EG289', source }, session, '42');
    expect(text).toContain('**EG289: Sky Noon**');
    expect(text).toContain('<#42>');
    expect(text).toContain('<t:1795285800:F>');
    expect(text).toContain("> @everyone 🎮 **EG289** is starting now! We're playing **Sky Noon**.");
  });

  it('explains a cancellation and what triggered it', () => {
    expect(describePlan({ kind: 'cancelled', phrase: 'No official EG', source }, session, '42')).toContain('“No official EG”');
  });

  it('says when Claude read the announcement', () => {
    const game = describePlan({ kind: 'game', game: 'Sky Noon', via: 'claude', source }, session, '42');
    expect(game).toContain("doesn't follow the usual template, so Claude read it");
    const cancelled = describePlan({ kind: 'cancelled', phrase: 'Rain check this week', via: 'claude', source }, session, '42');
    expect(cancelled).toContain('Claude read [this announcement]');
    expect(cancelled).toContain('“Rain check this week”');
    expect(describePlan({ kind: 'game', game: 'Sky Noon', source }, session, '42')).not.toContain('Claude');
  });

  it("explains when it's unsure, and posts nothing", () => {
    const plan = { kind: 'unsure' as const, reason: "couldn't be read because Claude didn't answer", retryable: true, source };
    expect(startMessage(plan)).toBeNull();
    const text = describePlan(plan, session, '42');
    expect(text).toContain("I'm not sure what's happening");
    expect(text).toContain("[this post](https://discord.com/channels/1/2/3) couldn't be read because Claude didn't answer.");
    expect(text).toContain("**won't** post anything");
    expect(heldOffMessage(plan)).toContain("didn't post the start message");
  });
});
