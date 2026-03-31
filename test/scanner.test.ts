import { describe, expect, it, vi } from "vitest";
import { scanForCandidates } from "../src/scanner.js";
import type { Config } from "../src/config.js";
import type { AppState } from "../src/state.js";
import type { PoolDiscoveryItem } from "../src/lp-agent-client.js";

const config = {
  minMcap: 30_000,
  maxMcap: 1_000_000,
  minVol24h: 10_000,
  minLiquidity: 3_000,
  minOrganicScore: 0,
  minAgeHr: 1,
  maxAgeHr: 720,
  minPriceChange1h: 0,
} as Config;

const state: AppState = {
  positions: [],
  seenCoins: {},
  circuitBreaker: { state: "closed", consecutiveFailures: 0, openedAt: null },
};

function makePool(overrides: Partial<PoolDiscoveryItem> = {}): PoolDiscoveryItem {
  return {
    pool: "pool1",
    tvl: 5_000,
    fee: 0.3,
    protocol: "meteora",
    token0: "mint1",
    token1: "usdc",
    vol_24h: 50_000,
    vol_1h: 1_000,
    base_price: 0.01,
    mcap: 100_000,
    organic_score: 50,
    top_holder: 10,
    mint_freeze: false,
    price_1h_change: 12,
    price_24h_change: 20,
    bin_step: 25,
    created_at: new Date(Date.now() - 24 * 3_600_000).toISOString(),
    token0_symbol: "MEME",
    token1_symbol: "USDC",
    token0_decimals: 9,
    token1_decimals: 6,
    liquidity_token0: 1000,
    liquidity_token1: 1000,
    ...overrides,
  };
}

describe("scanner", () => {
  it("filters out pools above max market cap even if discovery returns them", async () => {
    const lpAgent = {
      discoverPools: vi.fn().mockResolvedValue([
        makePool({ token0_symbol: "SOL", token0: "So11111111111111111111111111111111111111112", mcap: 49_638_076_389.415 }),
      ]),
    } as any;

    const jupiter = {
      getTokenSafety: vi.fn().mockResolvedValue({ hasFreeze: false, hasMint: false }),
    } as any;

    const candidates = await scanForCandidates(lpAgent, jupiter, config, state);
    expect(candidates).toEqual([]);
    expect(jupiter.getTokenSafety).not.toHaveBeenCalled();
  });

  it("filters out SOL base pools locally", async () => {
    const lpAgent = {
      discoverPools: vi.fn().mockResolvedValue([
        makePool({ token0_symbol: "SOL", token0: "So11111111111111111111111111111111111111112" }),
      ]),
    } as any;

    const jupiter = {
      getTokenSafety: vi.fn().mockResolvedValue({ hasFreeze: false, hasMint: false }),
    } as any;

    const candidates = await scanForCandidates(lpAgent, jupiter, config, state);
    expect(candidates).toEqual([]);
    expect(jupiter.getTokenSafety).not.toHaveBeenCalled();
  });
});
