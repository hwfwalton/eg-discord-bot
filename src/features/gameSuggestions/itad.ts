// IsThereAnyDeal (https://isthereanydeal.com) price lookups. Needs an API key; the OAuth client
// ID/secret from the same app page aren't needed for these public endpoints.

export interface Price {
  /** Formatted, e.g. "$12.74". */
  text: string;
  amount: number;
}

export interface ItadDeals {
  /** The game's page on IsThereAnyDeal. */
  url: string;
  /** The cheapest current offer, if any store sells it. */
  current?: { price: Price; regular: Price; cut: number; shop: string; url: string; voucher?: string };
  /** The all-time lowest price. */
  lowest?: { price: Price; cut: number; shop: string; date: Date };
}

export interface ItadClient {
  dealsForSteamApp(appId: number): Promise<ItadDeals | undefined>;
}

type Fetch = typeof fetch;

const API = 'https://api.isthereanydeal.com';
const COUNTRY = 'US';
const TIMEOUT_MS = 10_000;

export function createItadClient(apiKey: string, fetchFn: Fetch = fetch): ItadClient {
  async function call<T>(path: string, init?: { body: unknown }): Promise<T> {
    const url = new URL(path, API);
    url.searchParams.set('key', apiKey);
    const res = await fetchFn(url, {
      method: init ? 'POST' : 'GET',
      headers: init ? { 'Content-Type': 'application/json' } : undefined,
      body: init ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Don't include the URL in errors: it contains the API key.
    if (!res.ok) throw new Error(`IsThereAnyDeal ${url.pathname} failed: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    async dealsForSteamApp(appId) {
      const lookup = await call<LookupResponse>(`/games/lookup/v1?appid=${appId}`);
      if (!lookup.found || !lookup.game) return undefined;
      const overview = await call<OverviewResponse>(`/games/overview/v2?country=${COUNTRY}`, { body: [lookup.game.id] });
      return toDeals(lookup.game.slug, overview.prices?.find((p) => p.id === lookup.game?.id));
    },
  };
}

// Response shapes (only the fields we use), as returned by the live API.
interface LookupResponse {
  found: boolean;
  game?: { id: string; slug: string; title: string };
}

interface ApiPrice {
  amount: number;
  currency: string;
}

export interface OverviewPrice {
  id: string;
  current?: {
    shop: { name: string };
    price: ApiPrice;
    regular: ApiPrice;
    cut: number;
    voucher?: string | null;
    url: string;
  } | null;
  lowest?: { shop: { name: string }; price: ApiPrice; cut: number; timestamp: string } | null;
}

interface OverviewResponse {
  prices?: OverviewPrice[];
}

export function toDeals(slug: string, overview: OverviewPrice | undefined): ItadDeals {
  const deals: ItadDeals = { url: `https://isthereanydeal.com/game/${slug}/` };
  const c = overview?.current;
  if (c) {
    deals.current = {
      price: price(c.price),
      regular: price(c.regular),
      cut: c.cut,
      shop: c.shop.name,
      url: c.url,
      ...(c.voucher ? { voucher: c.voucher } : {}),
    };
  }
  const l = overview?.lowest;
  if (l) deals.lowest = { price: price(l.price), cut: l.cut, shop: l.shop.name, date: new Date(l.timestamp) };
  return deals;
}

function price({ amount, currency }: ApiPrice): Price {
  return { amount, text: new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount) };
}
