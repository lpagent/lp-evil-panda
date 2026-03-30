import type { AppContext } from "./app-context.js";
import { createAppContext } from "./app-context.js";
import { runMonitorCycle, runScanCycle } from "./cycles.js";
import { saveState } from "./state.js";
import { withRunLock } from "./run-lock.js";
import {
  cooldownRemainingMs,
  recordFailure,
  recordSuccess,
  resetCircuitBreaker,
  shouldAllowRun,
} from "./circuit-breaker.js";

const BANNER = `
╔══════════════════════════════════════════╗
║     🐼 LP Evil Panda — Meteora LP Bot   ║
║     Evil Panda Strategy via LP Agent API ║
╚══════════════════════════════════════════╝
`;

export async function onboard(context: AppContext): Promise<void> {
  const { config, lpAgent, signer } = context;

  console.log(BANNER);
  console.log(`  Wallet:    ${signer.publicKey}`);
  console.log(`  Strategy:  ${config.strategyType}`);
  console.log(`  Range:     -${config.rangePercentLow}% to -${config.rangePercentHigh}% SOL side`);
  console.log(`  Max pos:   ${config.maxPositions}`);
  console.log(`  Stop-loss: ${config.stopLossHours}h`);
  console.log();

  try {
    const balances = await lpAgent.getTokenBalances(signer.publicKey);
    const sol = balances.find((b) => b.symbol === "SOL");
    const solBalance = sol?.balance ?? 0;
    console.log(`  SOL balance: ${solBalance.toFixed(4)} SOL`);
    if (solBalance < 0.01) {
      console.warn("  ⚠ Low SOL balance — bot needs SOL to enter positions");
    }
    console.log();
  } catch (err) {
    console.error("  ❌ Failed to validate API key or fetch balance");
    console.error("     Get your API key at: https://portal.lpagent.io");
    throw err;
  }
}

export async function runStandaloneLoop(): Promise<void> {
  await withRunLock("standalone-loop", async () => {
    const context = createAppContext();
    const { config, signer, telegram, state } = context;

    await onboard(context);
    await telegram.notifyStartup(signer.publicKey, 0);

    console.log("[main] Starting Evil Panda loop...\n");

    let lastScanTime = 0;
    let running = true;

    const shutdown = () => {
      console.log("\n[main] Shutting down gracefully...");
      running = false;
      saveState(state);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    while (running) {
      const breaker = state.circuitBreaker;
      const allowed = shouldAllowRun(breaker, config);
      if (allowed === "blocked") {
        const remainMs = cooldownRemainingMs(breaker, config);
        console.warn(`[main] Circuit breaker OPEN — skipping cycles (${Math.ceil(remainMs / 1000)}s remaining)`);
        await new Promise((r) => setTimeout(r, config.pollIntervalMs));
        continue;
      }

      if (breaker.state === "half_open") {
        console.warn("[main] Circuit breaker HALF_OPEN — running probe cycle");
      }

      try {
        await runMonitorCycle(context);

        const now = Date.now();
        if (now - lastScanTime >= config.scanIntervalMs) {
          await runScanCycle(context);
          lastScanTime = now;
        }

        const wasHalfOpen = breaker.state === "half_open";
        recordSuccess(breaker, config);
        saveState(state);
        if (wasHalfOpen) {
          console.log("[main] Circuit breaker CLOSED after successful probe");
        }
      } catch (err) {
        const tripped = recordFailure(breaker, config).opened;
        saveState(state);
        console.error("[main] Loop error:", err);
        await telegram.notifyError("Main loop", String(err));
        if (tripped) {
          await telegram.notifyError(
            "Circuit breaker",
            `Opened after ${breaker.consecutiveFailures} consecutive failures. Cooldown ${Math.ceil(config.circuitBreakerCooldownMs / 1000)}s.`,
          );
        }
      }

      await new Promise((r) => setTimeout(r, config.pollIntervalMs));
    }

    console.log("[main] Evil Panda stopped. State saved.");
  });
}

export function getCircuitBreakerSnapshot() {
  const context = createAppContext();
  const breaker = context.state.circuitBreaker;
  const remainingMs = cooldownRemainingMs(breaker, context.config);
  return {
    state: breaker.state,
    consecutiveFailures: breaker.consecutiveFailures,
    openedAt: breaker.openedAt,
    cooldownRemainingMs: remainingMs,
  };
}

export function resetCircuitBreakerState(): void {
  const context = createAppContext();
  resetCircuitBreaker(context.state.circuitBreaker);
  saveState(context.state);
}

export async function runScanOnce(): Promise<void> {
  await withRunLock("scan-once", async () => {
    const context = createAppContext();
    const { state, config } = context;
    const breaker = state.circuitBreaker;
    const allowed = shouldAllowRun(breaker, config);
    if (allowed === "blocked") {
      const remainMs = cooldownRemainingMs(breaker, config);
      throw new Error(`Circuit breaker is OPEN. Try again in ${Math.ceil(remainMs / 1000)}s`);
    }

    try {
      await runScanCycle(context);
      recordSuccess(breaker, config);
      saveState(state);
    } catch (err) {
      recordFailure(breaker, config);
      saveState(state);
      throw err;
    }
  });
}

export async function runMonitorOnce(): Promise<void> {
  await withRunLock("monitor-once", async () => {
    const context = createAppContext();
    const { state, config } = context;
    const breaker = state.circuitBreaker;
    const allowed = shouldAllowRun(breaker, config);
    if (allowed === "blocked") {
      const remainMs = cooldownRemainingMs(breaker, config);
      throw new Error(`Circuit breaker is OPEN. Try again in ${Math.ceil(remainMs / 1000)}s`);
    }

    try {
      await runMonitorCycle(context);
      recordSuccess(breaker, config);
      saveState(state);
    } catch (err) {
      recordFailure(breaker, config);
      saveState(state);
      throw err;
    }
  });
}
