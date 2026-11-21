// PCGamingWiki (https://www.pcgamingwiki.com) multiplayer data, via its keyless MediaWiki API:
// Steam App ID -> wiki page -> the page's {{Network/Multiplayer}} template (player counts, notes).
// The data is CC BY-NC-SA, so anything shown from it links back to the page.

const API = 'https://www.pcgamingwiki.com/w/api.php';
const USER_AGENT = 'EGDiscordBot/0.1 (small community Discord bot; game info lookups)';
const TIMEOUT_MS = 10_000;

export interface PcgwMultiplayer {
  page: string;
  url: string;
  onlinePlayers?: number;
  localPlayers?: number;
  lanPlayers?: number;
  /** The online/local/LAN notes as plain text, e.g. "Up to 16 players ... via Rounds With Friends mod." */
  notes: string;
}

type Fetch = typeof fetch;

async function query(params: Record<string, string>, fetchFn: Fetch): Promise<unknown> {
  const url = `${API}?${new URLSearchParams({ ...params, format: 'json' })}`;
  const res = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`PCGamingWiki request failed: HTTP ${res.status}`);
  return res.json();
}

/** Multiplayer facts for a Steam game, or undefined if PCGamingWiki has no page or no multiplayer data. */
export async function pcgwMultiplayer(appId: number, fetchFn: Fetch = fetch): Promise<PcgwMultiplayer | undefined> {
  const lookup = (await query({ action: 'idlookup', field: 'steamappid', value: String(appId) }, fetchFn)) as {
    idlookup?: { title?: string | Record<string, string> }[];
  };
  const title = lookup.idlookup?.[0]?.title;
  const page = typeof title === 'string' ? title : title ? Object.values(title)[0] : undefined;
  if (!page) return undefined;

  const parsed = (await query({ action: 'parse', prop: 'wikitext', page }, fetchFn)) as {
    parse?: { wikitext?: { '*'?: string } };
  };
  const fields = multiplayerFields(parsed.parse?.wikitext?.['*'] ?? '');
  const result: PcgwMultiplayer = {
    page,
    url: `https://www.pcgamingwiki.com/wiki/${encodeURIComponent(page.replace(/ /g, '_'))}`,
    onlinePlayers: count(fields['online play players']),
    localPlayers: count(fields['local play players']),
    lanPlayers: count(fields['lan play players']),
    notes: [...new Set(['online play notes', 'local play notes', 'lan play notes'].map((k) => wikiToText(fields[k] ?? '')))]
      .filter(Boolean)
      .join(' '),
  };
  const hasData = result.onlinePlayers || result.localPlayers || result.lanPlayers || result.notes;
  return hasData ? result : undefined;
}

/** The `|key = value` fields of a page's {{Network/Multiplayer ...}} template. */
export function multiplayerFields(wikitext: string): Record<string, string> {
  const start = wikitext.indexOf('{{Network/Multiplayer');
  if (start < 0) return {};
  let depth = 0;
  let end = wikitext.length;
  for (let i = start; i < wikitext.length - 1; i++) {
    if (wikitext.startsWith('{{', i)) {
      depth++;
      i++;
    } else if (wikitext.startsWith('}}', i)) {
      depth--;
      i++;
      if (depth === 0) {
        end = i - 1;
        break;
      }
    }
  }
  const fields: Record<string, string> = {};
  for (const part of wikitext.slice(start + 2, end).split(/\n\s*\|/).slice(1)) {
    const eq = part.indexOf('=');
    if (eq > 0) fields[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  return fields;
}

/** Wiki markup to plain text: drops refs and templates, keeps link text with its URL. */
export function wikiToText(markup: string): string {
  return markup
    .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[(https?:\/\/\S+) ([^\]]+)\]/g, '$2 ($1)')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/'''?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function count(value: string | undefined): number | undefined {
  const n = Number(value?.trim());
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
