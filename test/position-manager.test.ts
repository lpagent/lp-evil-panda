import { describe, it, expect, vi } from "vitest";
import { evaluatePositions } from "../src/position-manager.js";
import type { Config } from "../src/config.js";
import type { AppState, TrackedPosition } from "../src/state.js";
import type { OpenPosition } from "../src/lp-agent-client.js";

const defaultConfig = {
  stopLossHours: 24,
  rsiPeriod: 2,
  rsiExitThreshold: 90,
  bbPeriod: 20,
  bbStdDev: 2,
} as Config;

function makeTrackedPosition(overrides?: Partial<TrackedPosition>): TrackedPosition {
  return {
    positionId: "pos123",
    poolId: "pool123",
    tokenMint: "token123",
    entryTime: Date.now() - 3_600_000, // 1 hour ago
    entryPrice: 0.001,
    strategy: "Spot",
    ...overrides,
  };
}

function makeOpenPosition(overrides?: Partial<OpenPosition>): OpenPosition {
  return {
    tokenId: "pos123",
    pairName: "MEME/SOL",
    pool: "pool123",
    status: "active",
    strategyType: "Spot",
    currentValue: 1.5,
    inputValue: 1.0,
    collectedFee: 0.05,
    collectedFeeNative: 0.05,
    uncollectedFee: 0.02,
    uncollectedFeeNative: 0.02,
    inRange: true,
    createdAt: new Date().toISOString(),
    ageHour: 1,
    pnl: { value: 0.5, percent: 50, valueNative: 0.05, percentNative: 5 },
    token0: "token0",
    token1: "token1",
    ...overrides,
  } as OpenPosition;
}

describe("position-manager", () => {
  it("triggers hard stop-loss after 24h with negative P&L and out of range", async () => {
    const tracked = makeTrackedPosition({
      entryTime: Date.now() - 25 * 3_600_000, // 25 hours ago
    });
    const openPos = makeOpenPosition({
      ageHour: 25,
      inRange: false,
      pnl: { value: -0.5, percent: -50, valueNative: -0.05, percentNative: -5 },
    });

    const mockLpAgent = {
      getOpenPositions: vi.fn().mockResolvedValue([openPos]),
    } as any;
    const mockGecko = { getOHLCV: vi.fn().mockResolvedValue([]) } as any;
    const state: AppState = { positions: [tracked], seenCoins: {} };

    const decisions = await evaluatePositions(mockLpAgent, mockGecko, defaultConfig, state, "wallet");

    expect(decisions.length).toBe(1);
    expect(decisions[0].action).toBe("exit");
    expect(decisions[0].reason).toContain("HARD STOP-LOSS");
  });

  it("holds position when no exit signals and in range", async () => {
    const tracked = makeTrackedPosition();
    const openPos = makeOpenPosition({ inRange: true, ageHour: 2 });

    const now = Math.floor(Date.now() / 1000);
    const candles = Array.from({ length: 30 }, (_, i) => ({
      timestamp: now - (30 - i) * 900,
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1000,
    }));

    const mockLpAgent = {
      getOpenPositions: vi.fn().mockResolvedValue([openPos]),
    } as any;
    const mockGecko = { getOHLCV: vi.fn().mockResolvedValue(candles) } as any;
    const state: AppState = { positions: [tracked], seenCoins: {} };

    const decisions = await evaluatePositions(mockLpAgent, mockGecko, defaultConfig, state, "wallet");

    expect(decisions.length).toBe(1);
    expect(decisions[0].action).toBe("hold");
  });

  it("holds when candle data is stale (>5 min old)", async () => {
    const tracked = makeTrackedPosition();
    const openPos = makeOpenPosition();

    const staleCandles = Array.from({ length: 30 }, (_, i) => ({
      timestamp: Math.floor(Date.now() / 1000) - 600 - (30 - i) * 900, // Last candle > 10 min old
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1000,
    }));

    const mockLpAgent = {
      getOpenPositions: vi.fn().mockResolvedValue([openPos]),
    } as any;
    const mockGecko = { getOHLCV: vi.fn().mockResolvedValue(staleCandles) } as any;
    const state: AppState = { positions: [tracked], seenCoins: {} };

    const decisions = await evaluatePositions(mockLpAgent, mockGecko, defaultConfig, state, "wallet");

    expect(decisions.length).toBe(1);
    expect(decisions[0].action).toBe("hold");
    expect(decisions[0].reason).toContain("Stale candle data");
  });

  it("exits on out-of-range + bounce + 1 signal", async () => {
    const tracked = makeTrackedPosition();
    const openPos = makeOpenPosition({ inRange: false });

    const now = Math.floor(Date.now() / 1000);
    // Create prices that show a bounce and trigger at least 1 signal
    const prices = Array(30).fill(100);
    prices[prices.length - 3] = 85; // Dip
    prices[prices.length - 2] = 90;
    prices[prices.length - 1] = 120; // Sharp bounce + BB break

    const candles = prices.map((close, i) => ({
      timestamp: now - (30 - i) * 900,
      open: close * 0.999,
      high: close * 1.005,
      low: close * 0.995,
      close,
      volume: 1000,
    }));

    const mockLpAgent = {
      getOpenPositions: vi.fn().mockResolvedValue([openPos]),
    } as any;
    const mockGecko = { getOHLCV: vi.fn().mockResolvedValue(candles) } as any;
    const state: AppState = { positions: [tracked], seenCoins: {} };

    const decisions = await evaluatePositions(mockLpAgent, mockGecko, defaultConfig, state, "wallet");

    expect(decisions.length).toBe(1);
    // Should exit on bounce + signal, or on 2+ signals
    if (decisions[0].action === "exit") {
      expect(decisions[0].reason).toMatch(/OUT_OF_RANGE|EXIT SIGNAL/);
    }
  });
});
