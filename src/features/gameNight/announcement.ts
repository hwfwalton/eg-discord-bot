// Reads a weekly #announcements post: the game is the first **bolded** text, and certain
// phrases mean there's no session this week. Pure functions so they're easy to test.

export type Reading =
  | { kind: 'game'; game: string }
  | { kind: 'cancelled'; phrase: string }
  | { kind: 'unclear' };

// Phrases that mean "no session this week". A cancellation wins over a bolded name, because a
// wrong @everyone ping is worse than a missed one (and the DM confirmation catches misreads).
const CANCEL_PATTERNS: RegExp[] = [
  /\bno (?:game ?night|games?|gaming|sessions?|events?|meet ?ups?|meeting)\b/i,
  /\bnot (?:meeting|playing|gaming)\b/i,
  /\bcancel(?:l)?(?:ed|ing)\b/i,
  /\bskipping\b/i,
  /\bskip (?:this|next) (?:week|saturday)\b/i,
  /\b(?:week|saturday) off\b/i,
  /\boff this (?:week|saturday)\b/i,
  /\btaking a (?:break|week off)\b/i,
];

const BOLD = /\*\*(?!\s)(.+?)(?<!\s)\*\*/g;

export function readAnnouncement(content: string): Reading {
  for (const pattern of CANCEL_PATTERNS) {
    const match = content.match(pattern);
    if (match) return { kind: 'cancelled', phrase: match[0] };
  }

  for (const [, inner] of content.matchAll(BOLD)) {
    const game = cleanGameName(inner ?? '');
    if (game) return { kind: 'game', game };
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
