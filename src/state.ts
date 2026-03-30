import { readFileSync, writeFileSync, existsSync } from "fs";

export interface TrackedPosition {
  positionId: string;
  poolId: string;
  tokenMint: string;
  entryTime: number;
  entryPrice: number;
  strategy: string;
}

export interface CircuitBreakerState {
  state: "closed" | "open" | "half_open";
  consecutiveFailures: number;
  openedAt: number | null;
}

export interface AppState {
  positions: TrackedPosition[];
  seenCoins: Record<string, number>; // tokenMint -> pump count
  circuitBreaker: CircuitBreakerState;
}

const STATE_FILE = "state.json";

const EMPTY_STATE: AppState = {
  positions: [],
  seenCoins: {},
  circuitBreaker: { state: "closed", consecutiveFailures: 0, openedAt: null },
};

export function loadState(): AppState {
  if (!existsSync(STATE_FILE)) return { ...EMPTY_STATE, positions: [], seenCoins: {} };
  try {
    const raw = readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const breaker = parsed.circuitBreaker && typeof parsed.circuitBreaker === "object"
      ? parsed.circuitBreaker
      : {};
    return {
      positions: Array.isArray(parsed.positions) ? parsed.positions : [],
      seenCoins: parsed.seenCoins && typeof parsed.seenCoins === "object" ? parsed.seenCoins : {},
      circuitBreaker: {
        state: breaker.state === "open" || breaker.state === "half_open" ? breaker.state : "closed",
        consecutiveFailures: typeof breaker.consecutiveFailures === "number" ? breaker.consecutiveFailures : 0,
        openedAt: typeof breaker.openedAt === "number" ? breaker.openedAt : null,
      },
    };
  } catch {
    console.warn("[state] Corrupt state file — starting fresh");
    return { ...EMPTY_STATE, positions: [], seenCoins: {} };
  }
}

export function saveState(state: AppState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function addPosition(state: AppState, pos: TrackedPosition): void {
  state.positions.push(pos);
  saveState(state);
}

export function removePosition(state: AppState, positionId: string): void {
  state.positions = state.positions.filter((p) => p.positionId !== positionId);
  saveState(state);
}

export function recordPump(state: AppState, tokenMint: string): void {
  state.seenCoins[tokenMint] = (state.seenCoins[tokenMint] || 0) + 1;
  saveState(state);
}

export function getPumpCount(state: AppState, tokenMint: string): number {
  return state.seenCoins[tokenMint] || 0;
}
