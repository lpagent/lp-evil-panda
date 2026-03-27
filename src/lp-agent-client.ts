import type { Config } from "./config.js";

export interface PoolDiscoveryItem {
  pool: string;
  tvl: number;
  fee: number;
  protocol: string;
  token0: string;
  token1: string;
  vol_24h: number;
  vol_1h: number;
  base_price: number;
  mcap: number;
  organic_score: number;
  top_holder: number;
  mint_freeze: boolean;
  price_1h_change: number;
  price_24h_change: number;
  bin_step: number;
  created_at: string;
  token0_symbol: string;
  token1_symbol: string;
  token0_decimals: number;
  token1_decimals: number;
  liquidity_token0: number;
  liquidity_token1: number;
}

export interface PoolInfo {
  type: "meteora" | "meteora_damm_v2";
  tokenInfo: Array<{ data: { id: string; symbol: string; name: string; decimals: number; usdPrice: number } }>;
  amountX: number;
  amountY: number;
  feeInfo: { baseFeeRatePercentage: number; maxFeeRatePercentage: number };
  liquidityViz?: {
    activeBin: { binId: number; price: number; pricePerToken: number };
    bins: Array<{ binId: number; xAmount: number; yAmount: number; price: number }>;
  };
}

export interface OpenPosition {
  tokenId: string;
  pairName: string;
  pool: string;
  status: string;
  strategyType: string;
  currentValue: number;
  inputValue: number;
  collectedFee: number;
  collectedFeeNative: number;
  uncollectedFee: number;
  uncollectedFeeNative: number;
  inRange: boolean;
  createdAt: string;
  ageHour: number;
  pnl: { value: number; percent: number; valueNative: number; percentNative: number };
  token0: string;
  token1: string;
  token0Info?: { symbol: string };
  token1Info?: { symbol: string };
}

export interface ZapInResponse {
  lastValidBlockHeight: number;
  swapTxsWithJito: string[];
  addLiquidityTxsWithJito: string[];
  meta: { positionPubKey: string };
}

export interface ZapOutResponse {
  lastValidBlockHeight: number;
  closeTxsWithJito: string[];
  swapTxsWithJito: string[];
}

export interface TokenBalance {
  tokenAddress: string;
  balance: number;
  symbol: string;
  decimals: number;
  balanceInUsd: number;
  price: number;
}

export class LpAgentClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: Config) {
    this.baseUrl = config.lpAgentBaseUrl;
    this.apiKey = config.lpAgentApiKey;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`LP Agent API error ${res.status}: ${body}`);
    }
    const json = await res.json();
    return (json as { data: T }).data ?? (json as T);
  }

  async discoverPools(params: {
    sortBy?: string;
    sortOrder?: string;
    pageSize?: number;
    minMcap?: number;
    maxMcap?: number;
    minVol24h?: number;
    minLiquidity?: number;
    minOrganicScore?: number;
    minAgeHr?: number;
    maxAgeHr?: number;
  }): Promise<PoolDiscoveryItem[]> {
    const qs = new URLSearchParams();
    qs.set("chain", "SOL");
    if (params.sortBy) qs.set("sortBy", params.sortBy);
    if (params.sortOrder) qs.set("sortOrder", params.sortOrder);
    if (params.pageSize) qs.set("pageSize", String(params.pageSize));
    if (params.minMcap) qs.set("min_market_cap", String(params.minMcap));
    if (params.maxMcap) qs.set("max_market_cap", String(params.maxMcap));
    if (params.minVol24h) qs.set("min_24h_vol", String(params.minVol24h));
    if (params.minLiquidity) qs.set("min_liquidity", String(params.minLiquidity));
    if (params.minOrganicScore) qs.set("min_organic_score", String(params.minOrganicScore));
    if (params.minAgeHr) qs.set("min_age_hr", String(params.minAgeHr));
    if (params.maxAgeHr) qs.set("max_age_hr", String(params.maxAgeHr));
    return this.request<PoolDiscoveryItem[]>(`/pools/discover?${qs.toString()}`);
  }

  async getPoolInfo(poolId: string): Promise<PoolInfo> {
    return this.request<PoolInfo>(`/pools/${poolId}/info`);
  }

  async getOpenPositions(owner: string): Promise<OpenPosition[]> {
    return this.request<OpenPosition[]>(`/lp-positions/opening?owner=${owner}`);
  }

  async getTokenBalances(owner: string): Promise<TokenBalance[]> {
    return this.request<TokenBalance[]>(`/token/balance?owner=${owner}`);
  }

  async createZapInTx(poolId: string, body: {
    stratergy: string;
    inputSOL: number;
    percentX: number;
    fromBinId: number;
    toBinId: number;
    owner: string;
    slippage_bps: number;
    mode: string;
  }): Promise<ZapInResponse> {
    return this.request<ZapInResponse>(`/pools/${poolId}/add-tx`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async submitZapIn(body: {
    lastValidBlockHeight: number;
    swapTxsWithJito: string[];
    addLiquidityTxsWithJito: string[];
    meta: { positionPubKey: string };
  }): Promise<{ signature: string }> {
    return this.request<{ signature: string }>("/pools/landing-add-tx", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async createZapOutTx(body: {
    position_id: string;
    bps: number;
    owner: string;
    slippage_bps: number;
    output: string;
    provider: string;
  }): Promise<ZapOutResponse> {
    return this.request<ZapOutResponse>("/position/decrease-tx", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async submitZapOut(body: {
    lastValidBlockHeight: number;
    closeTxsWithJito: string[];
    swapTxsWithJito: string[];
  }): Promise<{ signature: string }> {
    return this.request<{ signature: string }>("/position/landing-decrease-tx", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}
