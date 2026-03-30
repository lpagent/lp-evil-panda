import type { AppContext } from "./app-context.js";
import { createAppContext } from "./app-context.js";
import { runMonitorCycle, runScanCycle } from "./cycles.js";
import { saveState } from "./state.js";
import { withRunLock } from "./run-lock.js";

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
      try {
        await runMonitorCycle(context);

        const now = Date.now();
        if (now - lastScanTime >= config.scanIntervalMs) {
          await runScanCycle(context);
          lastScanTime = now;
        }
      } catch (err) {
        console.error("[main] Loop error:", err);
        await telegram.notifyError("Main loop", String(err));
      }

      await new Promise((r) => setTimeout(r, config.pollIntervalMs));
    }

    console.log("[main] Evil Panda stopped. State saved.");
  });
}

export async function runScanOnce(): Promise<void> {
  await withRunLock("scan-once", async () => {
    const context = createAppContext();
    await runScanCycle(context);
    saveState(context.state);
  });
}

export async function runMonitorOnce(): Promise<void> {
  await withRunLock("monitor-once", async () => {
    const context = createAppContext();
    await runMonitorCycle(context);
    saveState(context.state);
  });
}
