// Helpers for game names typed into Discord or returned by store APIs. Shared by the features.

/** Openers that may wrap a whole name, and their closers: "Hades II", (Codenames), «Hades», … */
const WRAPPERS: Record<string, string> = {
  '"': '"',
  '“': '”',
  "'": "'",
  '‘': '’',
  '`': '`',
  _: '_',
  '(': ')',
  '[': ']',
  '{': '}',
  '«': '»',
  '「': '」',
};
/** Leading emoji, bullets and punctuation, but not a wrapping quote or bracket (WRAPPERS, done in pairs). */
const LEADING_DECORATION = /^[^\p{L}\p{N}"“'‘`_(\[{«「]+/u;
/** Sentence punctuation after a name. Quotes and brackets are only removed in pairs (see unwrap). */
const TRAILING_SEPARATORS = /[\s:;,.\-–—|]+$/u;

/** Strips Discord markup and decoration from user-written text, leaving just the game's name. */
export function cleanGameName(raw: string): string {
  const unmarked = raw
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) -> text
    .replace(/<a?:\w+:\d+>/g, '') // custom emoji
    .replace(/<(?:@[!&]?|#)\d+>/g, '') // user/role/channel mentions
    .replace(/<t:\d+(?::[a-zA-Z])?>/g, '') // timestamps
    .replace(/@(?:everyone|here)/g, '')
    .replace(/(?:\*|__|~~)/g, '') // bold/italic/underline/strikethrough markers
    .replace(/\s+/g, ' ')
    .replace(LEADING_DECORATION, '')
    .replace(TRAILING_SEPARATORS, '');
  return (
    unwrap(unmarked)
      // Anything left over at the start (e.g. an unmatched opening quote), and separators exposed
      // by unwrapping ("'Hades II.'"). A trailing ! or ? stays: some names have one.
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .replace(TRAILING_SEPARATORS, '')
      .trim()
  );
}

/** Removes quotes/brackets that wrap the whole text: "'Hades II'" -> "Hades II". Inner ones stay. */
function unwrap(text: string): string {
  let result = text.trim();
  for (;;) {
    const closer = WRAPPERS[result[0] ?? ''];
    if (!closer || result.length < 2 || !result.endsWith(closer)) return result;
    result = result.slice(1, -closer.length).trim();
  }
}

/** A store name without trademark symbols, for display and post titles: "Apex Legends™" -> "Apex Legends". */
export function displayGameName(name: string): string {
  return name.replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
}

const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };

/**
 * A key for comparing names: lowercase words with punctuation, accents and ™/® removed, and roman
 * numerals as digits. "Baldur’s Gate™ III" and "baldurs gate 3" give the same key. Names with no
 * Latin letters or digits (e.g. "原神") give "".
 */
export function normalizeGameName(name: string): string {
  return name
    .replace(/[™®©]/g, '') // before NFKD, which would turn ™ into "TM"
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // accents
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => ROMAN[w] ?? w)
    .join(' ');
}

/**
 * Like normalizeGameName but also ignoring spaces, for deciding whether two names are the same game:
 * "PowerWash Simulator" = "Power Wash Simulator", "Skribbl.io" = "skribblio". "" when there's no key.
 */
export function gameKey(name: string): string {
  return normalizeGameName(name).replace(/ /g, '');
}
