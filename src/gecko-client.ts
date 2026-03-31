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
  private verboseApiLogs: boolean;

  constructor(verboseApiLogs = false) {
    this.verboseApiLogs = verboseApiLogs;
  }

  private verboseLog(message: string, extra?: unknown): void {
    if (!this.verboseApiLogs) return;
    if (extra === undefined) {
      console.log(`[verbose][gecko] ${message}`);
      return;
    }
    console.log(`[verbose][gecko] ${message}`, extra);
  }

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
      const startedAt = Date.now();
      this.verboseLog("GET ohlcv request", { pool: poolAddress, aggregate: agg, limit, currency });
      const res = await fetch(url);
      const elapsedMs = Date.now() - startedAt;
      if (!res.ok) {
        this.verboseLog("GET ohlcv failed", { status: res.status, elapsedMs, pool: poolAddress });
        console.warn(`[gecko] OHLCV fetch failed ${res.status} for pool ${poolAddress.slice(0, 8)}`);
        return [];
      }
      const json = await res.json() as {
        data: { attributes: { ohlcv_list: number[][] } };
      };
      const list = json.data?.attributes?.ohlcv_list;
      if (!Array.isArray(list)) {
        this.verboseLog("GET ohlcv invalid payload", { status: res.status, elapsedMs, pool: poolAddress });
        return [];
      }

      this.verboseLog("GET ohlcv success", { status: res.status, elapsedMs, pool: poolAddress, candles: list.length });
      return list.map((c) => ({
        timestamp: c[0],
        open: c[1],
        high: c[2],
        low: c[3],
        close: c[4],
        volume: c[5],
      }));
    } catch (err) {
      this.verboseLog("GET ohlcv error", { pool: poolAddress, error: String(err) });
      console.warn(`[gecko] OHLCV error for pool ${poolAddress.slice(0, 8)}:`, err);
      return [];
    }
  }
}
