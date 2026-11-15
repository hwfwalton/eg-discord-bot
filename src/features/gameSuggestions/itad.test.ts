import { describe, expect, it } from 'vitest';
import { createItadClient, toDeals } from './itad.ts';

// Trimmed from a real /games/overview/v2 response for Sky Noon.
const overview = {
  id: 'abc',
  current: {
    shop: { id: 6, name: 'Fanatical' },
    price: { amount: 12.74, amountInt: 1274, currency: 'USD' },
    regular: { amount: 14.99, amountInt: 1499, currency: 'USD' },
    cut: 15,
    voucher: 'FANATICAL15',
    url: 'https://itad.link/xyz/',
  },
  lowest: {
    shop: { id: 61, name: 'Steam' },
    price: { amount: 2.99, amountInt: 299, currency: 'USD' },
    regular: { amount: 14.99, amountInt: 1499, currency: 'USD' },
    cut: 80,
    timestamp: '2021-06-25T00:11:39+02:00',
  },
};

describe('toDeals', () => {
  it('summarises the current best deal and historical low', () => {
    expect(toDeals('sky-noon', overview)).toEqual({
      url: 'https://isthereanydeal.com/game/sky-noon/',
      current: {
        price: { amount: 12.74, text: '$12.74' },
        regular: { amount: 14.99, text: '$14.99' },
        cut: 15,
        shop: 'Fanatical',
        url: 'https://itad.link/xyz/',
        voucher: 'FANATICAL15',
      },
      lowest: { price: { amount: 2.99, text: '$2.99' }, cut: 80, shop: 'Steam', date: new Date('2021-06-24T22:11:39Z') },
    });
  });

  it('copes with no current offers', () => {
    expect(toDeals('x', { id: 'abc', current: null, lowest: null })).toEqual({ url: 'https://isthereanydeal.com/game/x/' });
  });
});

describe('createItadClient', () => {
  it('looks up by Steam app ID, then fetches the overview, passing the key', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
      const body = url.includes('/lookup/')
        ? { found: true, game: { id: 'abc', slug: 'sky-noon', title: 'Sky Noon' } }
        : { prices: [overview] };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;

    const deals = await createItadClient('KEY', fakeFetch).dealsForSteamApp(569530);
    expect(deals?.current?.shop).toBe('Fanatical');
    expect(calls).toEqual([
      { url: 'https://api.isthereanydeal.com/games/lookup/v1?appid=569530&key=KEY', method: 'GET', body: undefined },
      { url: 'https://api.isthereanydeal.com/games/overview/v2?country=US&key=KEY', method: 'POST', body: '["abc"]' },
    ]);
  });

  it('returns undefined for games ITAD does not know', async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ found: false }))) as unknown as typeof fetch;
    expect(await createItadClient('KEY', fakeFetch).dealsForSteamApp(1)).toBeUndefined();
  });

  it('keeps the API key out of error messages', async () => {
    const fakeFetch = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
    await expect(createItadClient('SECRET', fakeFetch).dealsForSteamApp(1)).rejects.toThrow(/^(?!.*SECRET).*HTTP 500/);
  });
});
