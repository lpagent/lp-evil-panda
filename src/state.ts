import { readFileSync, writeFileSync, existsSync } from "fs";

export interface TrackedPosition {
  positionId: string;
  poolId: string;
  tokenMint: string;
  entryTime: number;
  entryPrice: number;
  strategy: string;
}

export interface AppState {
  positions: TrackedPosition[];
  seenCoins: Record<string, number>; // tokenMint -> pump count
}

const STATE_FILE = "state.json";

const EMPTY_STATE: AppState = { positions: [], seenCoins: {} };

export function loadState(): AppState {
  if (!existsSync(STATE_FILE)) return { ...EMPTY_STATE, positions: [], seenCoins: {} };
  try {
    const raw = readFileSync(STATE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      positions: Array.isArray(parsed.positions) ? parsed.positions : [],
      seenCoins: parsed.seenCoins && typeof parsed.seenCoins === "object" ? parsed.seenCoins : {},
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
