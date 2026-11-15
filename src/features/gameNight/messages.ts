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
  const starting = plan.label ? `**${plan.label}** is starting now!` : 'Game night is starting now!';
  return [
    `@everyone 🎮 ${starting} We're playing **${plan.game}**.`,
    ...(plan.link ? [plan.link] : []),
    `-# Details in [the announcement](${plan.source.url})`,
  ].join('\n');
}

/** Describes what the bot will do at a session: used for the author DM and /gamenight. */
export function describePlan(plan: Plan, session: Session, startChannelId: string): string {
  switch (plan.kind) {
    case 'game':
      return [
        `✅ **${plan.label ? `${plan.label}: ` : ''}${plan.game}**. On ${when(session.startsAt)} I'll post this in <#${startChannelId}>:`,
        quote(startMessage(plan) ?? ''),
        ...(plan.via === 'gemini'
          ? [`-# [This announcement](${plan.source.url}) doesn't follow the usual template, so Gemini read it. Please double-check the game!`]
          : []),
      ].join('\n');
    case 'cancelled':
      return [
        `🚫 **No session** on ${when(session.startsAt)}, so I won't post anything.`,
        plan.via === 'gemini'
          ? `-# Gemini read [this announcement](${plan.source.url}) as a cancellation (“${plan.phrase}”).`
          : `-# I spotted “${plan.phrase}” in [this announcement](${plan.source.url}).`,
      ].join('\n');
    case 'unsure':
      return [
        `⚠️ I'm not sure what's happening on ${when(session.startsAt)}: [this post](${plan.source.url}) ${plan.reason}.`,
        `To be safe I **won't** post anything. If the session is on, post or edit an announcement using the usual template (\`we'll be playing...\` and the game in bold).`,
      ].join('\n');
    case 'none':
      return [
        `⚠️ I haven't found this week's game in any announcement since ${when(session.windowStart)}, so I **won't** post anything on ${when(session.startsAt)}.`,
        "I look for the usual template: `we'll be playing...` followed by the game in bold, e.g. `**Hades II**`.",
      ].join('\n');
  }
}

/** DM to an announcement's author when game time came but the bot held off because it was unsure. */
export function heldOffMessage(plan: Extract<Plan, { kind: 'unsure' }>): string {
  return [
    `⚠️ It's game time, but I didn't post the start message: [this post](${plan.source.url}) ${plan.reason}.`,
    "If the session is on, you may want to post the start message yourself.",
  ].join('\n');
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}
