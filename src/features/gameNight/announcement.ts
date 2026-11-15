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
import { cleanGameName, gameKey } from '../../gameName.ts';

export type Reading =
  | {
      kind: 'game';
      game: string;
      /** The session's name, e.g. "EG288", if the post gives one. */
      label?: string;
      /** The game's Steam store link, if the post includes one. */
      link?: string;
      /** Set when Gemini read the post because it didn't follow the template (see geminiReader.ts). */
      via?: 'gemini';
    }
  | { kind: 'cancelled'; phrase: string; via?: 'gemini' }
  /** Neither names a game nor cancels (reminders, surveys, news). */
  | { kind: 'unclear' }
  /** Gemini was asked but couldn't give a usable answer, so what the post says is unknown. */
  | { kind: 'unreadable'; reason: string; retryable: boolean };

// "playing" then optional "..."/":"/"!" and line breaks, then **Game**. The bold can't span lines.
const PLAYING = /\bplaying\b[.…:!\s]*\*\*(?!\s)(.+?)(?<!\s)\*\*/i;
const LABEL = /\bEG ?\d+\b/i;
const STEAM_LINK = /https:\/\/store\.steampowered\.com\/app\/\d+[^\s)>]*/;
const STEAM_LINKS = /https:\/\/store\.steampowered\.com\/app\/(\d+)(?:\/([^\s/)>]*))?[^\s)>]*/g;

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
    const link = steamLinkIn(content);
    return { kind: 'game', game, ...(label && { label }), ...(link && { link }) };
  }

  for (const pattern of CANCEL_PATTERNS) {
    const match = content.match(pattern);
    if (match) return { kind: 'cancelled', phrase: match[0] };
  }

  return { kind: 'unclear' };
}

/** The first Steam store link in a post, if any. */
export function steamLinkIn(content: string): string | undefined {
  return content.match(STEAM_LINK)?.[0];
}

/**
 * The post's Steam store link for a particular game: the one whose URL name matches it
 * (".../app/569530/Sky_Noon/" for "Sky Noon"), or the post's only store link. Undefined when
 * a post links several games and none matches, so a ping never shows another game's store page.
 */
export function steamLinkFor(content: string, game: string): string | undefined {
  const links = [...content.matchAll(STEAM_LINKS)].map((m) => ({ url: m[0], appId: m[1], slug: m[2] ?? '' }));
  const key = gameKey(game);
  const named = links.find((link) => {
    const slugKey = gameKey(link.slug);
    return slugKey !== '' && key !== '' && (slugKey.includes(key) || key.includes(slugKey));
  });
  if (named) return named.url;
  return new Set(links.map((link) => link.appId)).size === 1 ? links[0]?.url : undefined;
}

/** The session names ("EG289") a post mentions, normalized without spaces. */
export function sessionLabelsIn(content: string): Set<string> {
  return new Set([...content.matchAll(new RegExp(LABEL.source, 'gi'))].map((m) => m[0].replace(/\s/g, '').toUpperCase()));
}
