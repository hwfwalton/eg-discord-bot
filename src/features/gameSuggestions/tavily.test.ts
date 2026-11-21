import { describe, expect, it } from 'vitest';
import { TavilyError, createTavilySearch } from './tavily.ts';

function tavily(response: object | number) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return typeof response === 'number' ? new Response('{}', { status: response }) : new Response(JSON.stringify(response));
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe('createTavilySearch', () => {
  it('sends a basic search with the key as a Bearer token', async () => {
    const { fetchFn, calls } = tavily({ results: [] });
    await createTavilySearch('tvly-SECRET', { fetchFn })('"ROUNDS" mod more players');
    expect(calls[0]?.url).toBe('https://api.tavily.com/search');
    expect(calls[0]?.init.method).toBe('POST');
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tvly-SECRET');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      query: '"ROUNDS" mod more players',
      search_depth: 'basic',
      max_results: 5,
      chunks_per_source: 3,
    });
  });

  it('returns titles, URLs and trimmed snippets, skipping results without a web URL', async () => {
    const { fetchFn } = tavily({
      results: [
        { title: 'Rounds With Friends', url: 'https://thunderstore.io/c/rounds/p/olavim/RoundsWithFriends/', content: 'Up to   16\nplayers', score: 0.9 },
        { title: 'Bad', url: 'javascript:alert(1)', content: 'x' },
        { url: 'https://example.com/long', content: 'y'.repeat(2000) },
      ],
    });
    const results = await createTavilySearch('k', { fetchFn })('q');
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ title: 'Rounds With Friends', url: 'https://thunderstore.io/c/rounds/p/olavim/RoundsWithFriends/', content: 'Up to 16 players' });
    expect(results[1]?.title).toBe('https://example.com/long');
    expect(results[1]?.content).toHaveLength(800);
  });

  it('reports HTTP errors without the key', async () => {
    const error = await createTavilySearch('tvly-SECRET', { fetchFn: tavily(401).fetchFn })('q').catch((e) => e);
    expect(error).toBeInstanceOf(TavilyError);
    expect(error.message).toBe('Tavily search failed: HTTP 401 (bad API key)');
    expect(error.message).not.toContain('SECRET');
    await expect(createTavilySearch('k', { fetchFn: tavily(432).fetchFn })('q')).rejects.toThrow('plan limit reached');
  });
});
