// Web search through Tavily (https://tavily.com). The free plan has 1,000 credits a month; a basic
// search costs 1 credit. The bot uses it to find player counts and mods that Steam and
// PCGamingWiki don't cover. Results are web text: treat them as untrusted data.

const ENDPOINT = 'https://api.tavily.com/search';
const TIMEOUT_MS = 15_000;
/** Longest snippet kept per result, to keep Claude's input small. */
const MAX_SNIPPET = 800;

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export type WebSearch = (query: string) => Promise<SearchResult[]>;

export class TavilyError extends Error {
  readonly status: number;
  constructor(status: number) {
    // Never include the key or request in the message.
    super(`Tavily search failed: HTTP ${status}${status === 401 ? ' (bad API key)' : status === 432 ? ' (plan limit reached)' : ''}`);
    this.status = status;
  }
}

export function createTavilySearch(apiKey: string, { fetchFn = fetch, maxResults = 5 } = {}): WebSearch {
  return async (query) => {
    const res = await fetchFn(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, search_depth: 'basic', max_results: maxResults, chunks_per_source: 3 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new TavilyError(res.status);
    const body = (await res.json()) as { results?: { title?: unknown; url?: unknown; content?: unknown }[] };
    return (body.results ?? [])
      .filter((r) => typeof r.url === 'string' && /^https?:\/\//.test(r.url))
      .map((r) => ({
        title: typeof r.title === 'string' ? r.title.slice(0, 200) : String(r.url),
        url: r.url as string,
        content: typeof r.content === 'string' ? r.content.replace(/\s+/g, ' ').trim().slice(0, MAX_SNIPPET) : '',
      }));
  };
}
