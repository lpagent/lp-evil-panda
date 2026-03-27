import { describe, it, expect } from "vitest";
import { computeExitSignals } from "../src/analyzer.js";
import type { OHLCV } from "../src/gecko-client.js";
import type { Config } from "../src/config.js";

const defaultConfig = {
  rsiPeriod: 2,
  rsiExitThreshold: 90,
  bbPeriod: 20,
  bbStdDev: 2,
} as Config;

function makeCandles(closes: number[], baseTimestamp = 1700000000): OHLCV[] {
  return closes.map((close, i) => ({
    timestamp: baseTimestamp + i * 900, // 15m intervals
    open: close * 0.999,
    high: close * 1.005,
    low: close * 0.995,
    close,
    volume: 10000,
  }));
}

describe("analyzer", () => {
  describe("computeExitSignals", () => {
    it("returns no signals with insufficient data", () => {
      const candles = makeCandles([1, 2, 3, 4, 5]); // Only 5 candles, need 25+
      const result = computeExitSignals(candles, defaultConfig);
      expect(result.shouldExit).toBe(false);
      expect(result.signalCount).toBe(0);
      expect(result.details).toContain("Insufficient data");
    });

    it("detects Bollinger Band upper break", () => {
      // Create stable prices then a sharp spike — pushes close above upper BB
      const stable = Array(25).fill(100);
      const spiked = [...stable.slice(0, -1), 120]; // Last candle spikes to 120
      const candles = makeCandles(spiked);
      const result = computeExitSignals(candles, defaultConfig);
      expect(result.bbUpperBreak).toBe(true);
    });

    it("detects RSI(2) overbought", () => {
      // RSI(2) > 90 needs very strong consecutive up candles
      // Drop then 3 massive up candles to push RSI well above 90
      const prices = Array(30).fill(100);
      prices[prices.length - 4] = 70;  // Sharp drop
      prices[prices.length - 3] = 110; // Big recovery
      prices[prices.length - 2] = 150; // Massive continuation
      prices[prices.length - 1] = 200; // Even more
      const candles = makeCandles(prices);
      const result = computeExitSignals(candles, defaultConfig);
      expect(result.rsiOverbought).toBe(true);
    });

    it("detects MACD first green histogram bar", () => {
      // Need 35+ candles. Long downtrend, then reversal at the very end
      // so the last MACD histogram crosses from negative to positive.
      const prices: number[] = [];
      for (let i = 0; i < 50; i++) {
        if (i < 49) prices.push(100 - i * 1.2); // Sustained downtrend
        else prices.push(80);                    // Sharp reversal in last bar only
      }
      const candles = makeCandles(prices);
      const result = computeExitSignals(candles, defaultConfig);
      expect(result.macdFirstGreen).toBe(true);
    });

    it("requires 2+ signals confluence for shouldExit", () => {
      // Create scenario with stable BB but high RSI only (1 signal = no exit)
      const prices = Array(30).fill(100);
      // Small up moves that trigger RSI(2) but not BB
      prices[prices.length - 2] = 101;
      prices[prices.length - 1] = 102;
      const candles = makeCandles(prices);
      const result = computeExitSignals(candles, defaultConfig);
      // Even if RSI triggers, should not exit with only 1 signal
      if (result.signalCount === 1) {
        expect(result.shouldExit).toBe(false);
      }
      // If 0 signals, also should not exit
      if (result.signalCount === 0) {
        expect(result.shouldExit).toBe(false);
      }
    });

    it("returns shouldExit=true when 2+ signals fire", () => {
      // Create scenario that triggers both BB and RSI: sharp spike after stability
      const prices = Array(30).fill(100);
      prices[prices.length - 3] = 95;
      prices[prices.length - 2] = 110;
      prices[prices.length - 1] = 125; // Massive spike
      const candles = makeCandles(prices);
      const result = computeExitSignals(candles, defaultConfig);
      expect(result.signalCount).toBeGreaterThanOrEqual(2);
      expect(result.shouldExit).toBe(true);
    });
  });
});
