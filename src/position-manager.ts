import type { Config } from "./config.js";
import type { LpAgentClient, OpenPosition } from "./lp-agent-client.js";
import type { GeckoClient } from "./gecko-client.js";
import type { AppState, TrackedPosition } from "./state.js";
import { computeExitSignals, type ExitSignals } from "./analyzer.js";

export interface PositionDecision {
  position: OpenPosition;
  tracked: TrackedPosition;
  action: "hold" | "exit";
  reason: string;
  signals?: ExitSignals;
}

export async function evaluatePositions(
  lpAgent: LpAgentClient,
  gecko: GeckoClient,
  config: Config,
  state: AppState,
  walletAddress: string,
): Promise<PositionDecision[]> {
  // Fetch current positions from LP Agent API
  let openPositions: OpenPosition[];
  try {
    openPositions = await lpAgent.getOpenPositions(walletAddress);
  } catch (err) {
    console.error("[position-manager] Failed to fetch positions:", err);
    return [];
  }

  if (!Array.isArray(openPositions) || openPositions.length === 0) {
    return [];
  }

  const decisions: PositionDecision[] = [];

  for (const pos of openPositions) {
    // Find matching tracked position in state
    const tracked = state.positions.find(
      (t) => t.positionId === pos.tokenId || t.poolId === pos.pool,
    );

    if (!tracked) {
      // Position exists on-chain but not tracked — skip (might be manually created)
      continue;
    }

    // Check 24h hard stop-loss
    const ageHours = pos.ageHour || (Date.now() - tracked.entryTime) / 3_600_000;
    if (ageHours > config.stopLossHours) {
      const isHardBleeding = pos.pnl.valueNative < 0 && !pos.inRange;
      if (isHardBleeding) {
        decisions.push({
          position: pos,
          tracked,
          action: "exit",
          reason: `HARD STOP-LOSS: ${ageHours.toFixed(1)}h old, out of range, negative P&L`,
        });
        continue;
      }
    }

    // Fetch 15m candles from GeckoTerminal for exit signal analysis
    let candles: Awaited<ReturnType<typeof gecko.getOHLCV>>;
    try {
      candles = await gecko.getOHLCV(pos.pool, { aggregate: 15, limit: 100 });
    } catch (err) {
      console.error(`[position-manager] Failed to fetch candles for ${pos.pairName}:`, err);
      decisions.push({
        position: pos,
        tracked,
        action: "hold",
        reason: "Candle fetch failed — holding",
      });
      continue;
    }

    if (candles.length === 0) {
      // Can't compute signals — hold by default (safe)
      decisions.push({
        position: pos,
        tracked,
        action: "hold",
        reason: "No candle data available — holding",
      });
      continue;
    }

    // Check stale price data (> 5 min since last candle)
    const lastCandleAge = Date.now() / 1000 - candles[candles.length - 1].timestamp;
    if (lastCandleAge > 300) {
      decisions.push({
        position: pos,
        tracked,
        action: "hold",
        reason: `Stale candle data (${(lastCandleAge / 60).toFixed(0)}min old) — holding`,
      });
      continue;
    }

    // Compute Evil Panda exit signals
    const signals = computeExitSignals(candles, config);

    if (signals.shouldExit) {
      decisions.push({
        position: pos,
        tracked,
        action: "exit",
        reason: `EXIT SIGNAL: ${signals.details}`,
        signals,
      });
    } else {
      // Check for out-of-range + bounce pattern
      if (!pos.inRange && candles.length >= 3) {
        const recent = candles.slice(-3);
        const isBouncing = recent[2].close > recent[0].close;
        if (isBouncing && signals.signalCount >= 1) {
          decisions.push({
            position: pos,
            tracked,
            action: "exit",
            reason: `OUT_OF_RANGE + BOUNCE + ${signals.details}`,
            signals,
          });
          continue;
        }
      }

      decisions.push({
        position: pos,
        tracked,
        action: "hold",
        reason: `Hold — ${signals.details} | P&L: ${pos.pnl.valueNative >= 0 ? "+" : ""}${pos.pnl.valueNative.toFixed(4)} SOL | Fees: ${pos.uncollectedFeeNative.toFixed(4)} SOL`,
        signals,
      });
    }
  }

  return decisions;
}
