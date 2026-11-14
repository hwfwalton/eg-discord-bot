// The text the bot sends for game night. Kept separate from the Discord wiring so it's testable.
import type { Plan, Session } from './plan.ts';

/** Discord renders <t:…> in each reader's own timezone. */
function when(date: Date): string {
  const unix = Math.floor(date.getTime() / 1000);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
}

/** The @everyone post at session start, or null when nothing should be posted. */
export function startMessage(plan: Plan): string | null {
  if (plan.kind !== 'game') return null;
  return `@everyone 🎮 Game night is starting! This week we're playing **${plan.game}**.\n-# Details in [the announcement](${plan.source.url})`;
}

/** Describes what the bot will do at a session: used for the author DM and /gamenight. */
export function describePlan(plan: Plan, session: Session, startChannelId: string): string {
  switch (plan.kind) {
    case 'game':
      return [
        `✅ **${plan.game}**: on ${when(session.startsAt)} I'll tell @everyone in <#${startChannelId}> that game night is starting.`,
        `-# From [this announcement](${plan.source.url}).`,
      ].join('\n');
    case 'cancelled':
      return [
        `🚫 **No session** on ${when(session.startsAt)}, so I won't post anything.`,
        `-# I spotted “${plan.phrase}” in [this announcement](${plan.source.url}).`,
      ].join('\n');
    case 'none':
      return [
        `⚠️ I couldn't find a **bolded** game name or a “no session” phrase in any announcement since ${when(session.windowStart)}.`,
        `As things stand I **won't** post anything on ${when(session.startsAt)}.`,
        'To fix it, edit the announcement so the game name is in bold, e.g. `**Hades II**`.',
      ].join('\n');
  }
}
