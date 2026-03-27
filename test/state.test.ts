import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadState, saveState, addPosition, removePosition, recordPump, getPumpCount, type AppState } from "../src/state.js";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";

const TEST_STATE_FILE = "state.json";

describe("state", () => {
  afterEach(() => {
    try {
      if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
    } catch { /* ignore */ }
  });

  it("returns empty state when no file exists", () => {
    try { unlinkSync(TEST_STATE_FILE); } catch { /* ignore */ }
    const state = loadState();
    expect(state.positions).toEqual([]);
    expect(state.seenCoins).toEqual({});
  });

  it("handles corrupt state file gracefully", () => {
    writeFileSync(TEST_STATE_FILE, "not valid json{{{");
    const state = loadState();
    expect(state.positions).toEqual([]);
    expect(state.seenCoins).toEqual({});
  });

  it("tracks pump counts correctly", () => {
    const state: AppState = { positions: [], seenCoins: {} };
    expect(getPumpCount(state, "token1")).toBe(0);

    recordPump(state, "token1");
    expect(getPumpCount(state, "token1")).toBe(1);

    recordPump(state, "token1");
    expect(getPumpCount(state, "token1")).toBe(2);

    recordPump(state, "token2");
    expect(getPumpCount(state, "token1")).toBe(2);
    expect(getPumpCount(state, "token2")).toBe(1);
  });

  it("adds and removes positions", () => {
    const state: AppState = { positions: [], seenCoins: {} };

    addPosition(state, {
      positionId: "pos1",
      poolId: "pool1",
      tokenMint: "mint1",
      entryTime: Date.now(),
      entryPrice: 0.001,
      strategy: "Spot",
    });

    expect(state.positions.length).toBe(1);
    expect(state.positions[0].positionId).toBe("pos1");

    removePosition(state, "pos1");
    expect(state.positions.length).toBe(0);
  });
});
