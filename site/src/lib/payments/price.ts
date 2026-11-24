// BTC/USD from mempool.space (public, no key). Cached briefly per server instance.
let cache: { usd: number; at: number } | null = null;

export async function btcUsdPrice(): Promise<number> {
  if (cache && Date.now() - cache.at < 60_000) return cache.usd;
  const res = await fetch("https://mempool.space/api/v1/prices", { cache: "no-store" });
  if (!res.ok) throw new Error(`price lookup failed (${res.status})`);
  const json = (await res.json()) as { USD: number };
  if (!json.USD) throw new Error("price lookup returned no USD");
  cache = { usd: json.USD, at: Date.now() };
  return json.USD;
}

export function usdCentsToSats(cents: number, btcUsd: number): number {
  return Math.ceil(((cents / 100) / btcUsd) * 1e8);
}
