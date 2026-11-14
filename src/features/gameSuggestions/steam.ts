// Steam store lookups via the public (keyless) store API.

export interface SteamSearchItem {
  id: number;
  name: string;
}

export interface SteamGame {
  id: number;
  name: string;
  url: string;
  description: string;
  headerImage?: string;
  isFree: boolean;
  /** e.g. "$29.99", or "$19.99 (-33%)" when discounted. Undefined if free or unreleased. */
  price?: string;
  releaseDate?: string;
  comingSoon: boolean;
  /** Multiplayer modes, e.g. ["Online Co-op", "Online PvP"]. Empty if single-player only. */
  multiplayer: string[];
}

export interface SteamMatch {
  item: SteamSearchItem;
  /** True when the name matches the query exactly (ignoring case, punctuation, II vs 2). */
  exact: boolean;
  others: SteamSearchItem[];
}

type Fetch = typeof fetch;

const API = 'https://store.steampowered.com/api';
const TIMEOUT_MS = 10_000;

export async function searchSteam(term: string, fetchFn: Fetch = fetch): Promise<SteamSearchItem[]> {
  const url = `${API}/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Steam search failed: HTTP ${res.status}`);
  const body = (await res.json()) as { items?: { id: number; name: string; type: string }[] };
  return (body.items ?? []).filter((i) => i.type === 'app').map(({ id, name }) => ({ id, name }));
}

export async function getSteamGame(appId: number, fetchFn: Fetch = fetch): Promise<SteamGame | undefined> {
  const url = `${API}/appdetails?appids=${appId}&cc=US&l=english`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Steam app details failed: HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, { success: boolean; data?: AppDetails }>;
  const data = body[String(appId)]?.data;
  return data ? toSteamGame(appId, data) : undefined;
}

interface AppDetails {
  name: string;
  is_free: boolean;
  short_description?: string;
  header_image?: string;
  price_overview?: { final_formatted: string; discount_percent: number };
  release_date?: { coming_soon: boolean; date: string };
  categories?: { id: number; description: string }[];
}

// Steam category IDs for multiplayer modes, in display order.
const MULTIPLAYER_CATEGORIES: [id: number, label: string][] = [
  [38, 'Online Co-op'],
  [36, 'Online PvP'],
  [39, 'Split-screen Co-op'],
  [37, 'Split-screen PvP'],
  [24, 'Split-screen'],
  [48, 'LAN Co-op'],
  [47, 'LAN PvP'],
  [27, 'Cross-platform'],
];
const GENERIC_MULTIPLAYER = 1;

export function toSteamGame(id: number, data: AppDetails): SteamGame {
  const categoryIds = new Set((data.categories ?? []).map((c) => c.id));
  const multiplayer = MULTIPLAYER_CATEGORIES.filter(([catId]) => categoryIds.has(catId)).map(([, label]) => label);
  if (multiplayer.length === 0 && categoryIds.has(GENERIC_MULTIPLAYER)) multiplayer.push('Multi-player');

  const p = data.price_overview;
  return {
    id,
    name: data.name,
    url: `https://store.steampowered.com/app/${id}/`,
    description: decodeEntities(data.short_description ?? ''),
    headerImage: data.header_image,
    isFree: data.is_free,
    price: p ? (p.discount_percent > 0 ? `${p.final_formatted} (-${p.discount_percent}%)` : p.final_formatted) : undefined,
    releaseDate: data.release_date?.date || undefined,
    comingSoon: data.release_date?.coming_soon ?? false,
    multiplayer,
  };
}

// Soundtracks, demos, etc. show up in search; skip them unless the query asks for one.
const EXTRAS = /\b(?:soundtrack|ost|demo|playtest|artbook|dlc|season pass|expansion|bundle|dedicated server)\b/i;

/** Picks the most likely game for a query from Steam's search results. */
export function pickMatch(query: string, items: SteamSearchItem[]): SteamMatch | undefined {
  const wantsExtras = EXTRAS.test(query);
  const candidates = wantsExtras ? items : items.filter((i) => !EXTRAS.test(i.name));
  if (candidates.length === 0) return undefined;

  const q = normalize(query);
  const exact = candidates.find((i) => normalize(i.name) === q);
  // Otherwise: the shortest name containing every word of the query ("deep rock" -> "Deep Rock Galactic").
  const words = q.split(' ').filter(Boolean);
  const containing = candidates
    .filter((i) => {
      const nameWords = new Set(normalize(i.name).split(' '));
      return words.every((w) => nameWords.has(w));
    })
    .sort((a, b) => a.name.length - b.name.length);
  const item = exact ?? containing[0] ?? candidates[0]!;

  return { item, exact: Boolean(exact), others: candidates.filter((i) => i !== item).slice(0, 3) };
}

const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };

/** Lowercase words with punctuation and ™/® removed, and roman numerals as digits. */
export function normalize(name: string): string {
  return name
    .replace(/[™®©]/g, '') // before NFKD, which would turn ™ into "TM"
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // accents
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => ROMAN[w] ?? w)
    .join(' ');
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return named[code.toLowerCase()] ?? whole;
  });
}
