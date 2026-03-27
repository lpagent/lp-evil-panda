export interface OHLCV {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class GeckoClient {
  private baseUrl = "https://api.geckoterminal.com/api/v2";
  private lastCallTime = 0;
  private minIntervalMs = 6500; // ~10 calls/min rate limit

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCallTime;
    if (elapsed < this.minIntervalMs) {
      await new Promise((r) => setTimeout(r, this.minIntervalMs - elapsed));
    }
    this.lastCallTime = Date.now();
  }

  async getOHLCV(poolAddress: string, options?: {
    aggregate?: number;
    limit?: number;
    currency?: string;
  }): Promise<OHLCV[]> {
    await this.rateLimit();
    const agg = options?.aggregate ?? 15;
    const limit = options?.limit ?? 100;
    const currency = options?.currency ?? "usd";

    const url = `${this.baseUrl}/networks/solana/pools/${poolAddress}/ohlcv/minute?aggregate=${agg}&limit=${limit}&currency=${currency}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[gecko] OHLCV fetch failed ${res.status} for pool ${poolAddress.slice(0, 8)}`);
        return [];
      }
      const json = await res.json() as {
        data: { attributes: { ohlcv_list: number[][] } };
      };
      const list = json.data?.attributes?.ohlcv_list;
      if (!Array.isArray(list)) return [];

      return list.map((c) => ({
        timestamp: c[0],
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        volume: c[5],
      }));
    } catch (err) {
      console.warn(`[gecko] OHLCV error for pool ${poolAddress.slice(0, 8)}:`, err);
      return [];
    }
  }
}
