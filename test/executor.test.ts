import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executeZapIn, executeZapOut } from "../src/executor.js";
import type { Config } from "../src/config.js";
import type { PoolInfo, OpenPosition } from "../src/lp-agent-client.js";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const defaultConfig = {
  strategyType: "Spot",
  rangePercentLow: 80,
  slippageBps: 100,
} as Config;

const mockPoolInfo: PoolInfo = {
  type: "meteora",
  tokenInfo: [
    { data: { id: "t0", symbol: "MEME", name: "Meme", decimals: 9, usdPrice: 0.001 } },
    { data: { id: "t1", symbol: "SOL", name: "SOL", decimals: 9, usdPrice: 150 } },
  ],
  amountX: 1000,
  amountY: 500,
  feeInfo: { baseFeeRatePercentage: 0.25, maxFeeRatePercentage: 1 },
  liquidityViz: {
    activeBin: { binId: 1000, price: 0.001, pricePerToken: 0.001 },
    bins: Array.from({ length: 100 }, (_, i) => ({
      binId: 950 + i,
      xAmount: 10,
      yAmount: 5,
      price: 0.001 + i * 0.00001,
    })),
  },
};

describe("executor", () => {
  it("retries zap-in on failure then succeeds", async () => {
    let attempts = 0;
    const mockLpAgent = {
      createZapInTx: vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts === 1) throw new Error("Timeout");
        return {
          lastValidBlockHeight: 100,
          swapTxsWithJito: ["tx1"],
          addLiquidityTxsWithJito: ["tx2"],
          meta: { positionPubKey: "newPos123" },
        };
      }),
      submitZapIn: vi.fn().mockResolvedValue({ signature: "sig123" }),
    } as any;

    const mockSigner = {
      publicKey: "wallet123",
      signTransaction: vi.fn().mockResolvedValue("signedTx"),
    };

    const promise = executeZapIn(mockLpAgent, mockSigner, defaultConfig, "pool123", mockPoolInfo, 1.0);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).not.toBeNull();
    expect(result!.positionPubKey).toBe("newPos123");
    expect(attempts).toBe(2); // First attempt failed, second succeeded
  });

  it("returns null after all retries fail for zap-in", async () => {
    const mockLpAgent = {
      createZapInTx: vi.fn().mockRejectedValue(new Error("Always fails")),
    } as any;

    const mockSigner = {
      publicKey: "wallet123",
      signTransaction: vi.fn().mockResolvedValue("signedTx"),
    };

    const promise = executeZapIn(mockLpAgent, mockSigner, defaultConfig, "pool123", mockPoolInfo, 1.0);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeNull();
    expect(mockLpAgent.createZapInTx).toHaveBeenCalledTimes(3);
  });

  it("stops retrying zap-in on 4xx non-rate-limit errors", async () => {
    const mockLpAgent = {
      createZapInTx: vi.fn().mockRejectedValue(new Error("LP Agent API error 400: bad request")),
    } as any;

    const mockSigner = {
      publicKey: "wallet123",
      signTransaction: vi.fn().mockResolvedValue("signedTx"),
    };

    const promise = executeZapIn(mockLpAgent, mockSigner, defaultConfig, "pool123", mockPoolInfo, 1.0);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeNull();
    expect(mockLpAgent.createZapInTx).toHaveBeenCalledTimes(1);
  });

  it("retries zap-in on 429 with backoff", async () => {
    const mockLpAgent = {
      createZapInTx: vi
        .fn()
        .mockRejectedValueOnce(new Error("LP Agent API error 429: too many requests"))
        .mockResolvedValue({
          lastValidBlockHeight: 100,
          swapTxsWithJito: ["tx1"],
          addLiquidityTxsWithJito: ["tx2"],
          meta: { positionPubKey: "newPos429" },
        }),
      submitZapIn: vi.fn().mockResolvedValue({ signature: "sig429" }),
    } as any;

    const mockSigner = {
      publicKey: "wallet123",
      signTransaction: vi.fn().mockResolvedValue("signedTx"),
    };

    const promise = executeZapIn(mockLpAgent, mockSigner, defaultConfig, "pool123", mockPoolInfo, 1.0);
    await vi.advanceTimersByTimeAsync(6000);
    const result = await promise;

    expect(result).not.toBeNull();
    expect(result!.positionPubKey).toBe("newPos429");
    expect(mockLpAgent.createZapInTx).toHaveBeenCalledTimes(2);
  });

  it("verifies wallet state after failed zap-out", async () => {
    const mockLpAgent = {
      createZapOutTx: vi.fn().mockRejectedValue(new Error("Always fails")),
      getTokenBalances: vi.fn().mockResolvedValue([
        { symbol: "SOL", balance: 5.0 },
      ]),
    } as any;

    const mockSigner = {
      publicKey: "wallet123",
      signTransaction: vi.fn().mockResolvedValue("signedTx"),
    };

    const pos = {
      tokenId: "pos123",
      pairName: "MEME/SOL",
    } as OpenPosition;

    const promise = executeZapOut(mockLpAgent, mockSigner, defaultConfig, pos);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeNull();
    // Should have checked balance after failure
    expect(mockLpAgent.getTokenBalances).toHaveBeenCalledWith("wallet123");
  });
});
