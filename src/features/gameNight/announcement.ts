// Reads a weekly #announcements post. Pure functions so they're easy to test.
//
// Weekly posts follow a template:
//
//   @everyone
//   For EG288 (11/14 @ 10:30am PT/1:30pm ET) we'll be playing...
//   **Plucked Demo**!
//
// The game is the bolded text right after "playing". Posts without that template (reminders,
// surveys, other news) only matter if they cancel, e.g. "**No official EG this weekend!**".

export type Reading =
  | {
      kind: 'game';
      game: string;
      /** The session's name, e.g. "EG288", if the post gives one. */
      label?: string;
      /** The game's Steam store link, if the post includes one. */
      link?: string;
    }
  | { kind: 'cancelled'; phrase: string }
  | { kind: 'unclear' };

// "playing" then optional "..."/":"/"!" and line breaks, then **Game**. The bold can't span lines.
const PLAYING = /\bplaying\b[.…:!\s]*\*\*(?!\s)(.+?)(?<!\s)\*\*/i;
const LABEL = /\bEG ?\d+\b/i;
const STEAM_LINK = /https:\/\/store\.steampowered\.com\/app\/\d+[^\s)>]*/;

// Phrases that mean "no session this week", checked only when a post doesn't use the template.
const CANCEL_PATTERNS: RegExp[] = [
  /\bno (?:official )?(?:EG(?: ?\d+)?|game ?night|games?|gaming|sessions?|events?|meet ?ups?|meeting)\b/i,
  /\bcancel(?:l?(?:ed|ing)|lation)?\b/i,
  /\bnot (?:meeting|playing|gaming)\b/i,
  /\bskipping\b/i,
  /\bskip (?:this|next) (?:week|weekend|saturday)\b/i,
  /\b(?:week|weekend|saturday) off\b/i,
  /\boff this (?:week|weekend|saturday)\b/i,
  /\btaking a (?:break|week off)\b/i,
];

export function readAnnouncement(content: string): Reading {
  // The template is a deliberate signal, so it wins over stray words like "cancel" in the blurb.
  const playing = content.match(PLAYING);
  const game = playing ? cleanGameName(playing[1] ?? '') : '';
  if (playing && game) {
    const label = content.slice(0, playing.index).match(LABEL)?.[0].replace(' ', '').toUpperCase();
    const link = content.match(STEAM_LINK)?.[0];
    return { kind: 'game', game, ...(label && { label }), ...(link && { link }) };
  }

  for (const pattern of CANCEL_PATTERNS) {
    const match = content.match(pattern);
    if (match) return { kind: 'cancelled', phrase: match[0] };
  }

  return { kind: 'unclear' };
}

/** Strips Discord markup and decoration from a bolded span, leaving just the name. */
export function cleanGameName(raw: string): string {
  return (
    raw
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) -> text
      .replace(/<a?:\w+:\d+>/g, '') // custom emoji
      .replace(/<(?:@[!&]?|#)\d+>/g, '') // user/role/channel mentions
      .replace(/<t:\d+(?::[a-zA-Z])?>/g, '') // timestamps
      .replace(/@(?:everyone|here)/g, '')
      .replace(/(?:\*|__|~~)/g, '') // leftover italic/underline/strikethrough markers
      .replace(/\s+/g, ' ')
      // Trim emoji/punctuation from the start, and separators from the end (keep a trailing ! or ?).
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .replace(/[\s:;,.\-–—|]+$/u, '')
      .trim()
  );
}
