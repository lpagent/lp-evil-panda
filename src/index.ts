import { loadConfig, type Config } from "./config.js";
import { LpAgentClient } from "./lp-agent-client.js";
import { JupiterClient } from "./jupiter-client.js";
import { GeckoClient } from "./gecko-client.js";
import { createSigner, type Signer } from "./signer.js";
import { Telegram } from "./telegram.js";
import { loadState, saveState, addPosition, removePosition, recordPump, type AppState } from "./state.js";
import { scanForCandidates } from "./scanner.js";
import { evaluatePositions } from "./position-manager.js";
import { executeZapIn, executeZapOut } from "./executor.js";

// ─────────────────────────────────────────────
//  LP Evil Panda — Autonomous Meteora LP Bot
//  Evil Panda Strategy via LP Agent API
// ─────────────────────────────────────────────

const BANNER = `
╔══════════════════════════════════════════╗
║     🐼 LP Evil Panda — Meteora LP Bot   ║
║     Evil Panda Strategy via LP Agent API ║
╚══════════════════════════════════════════╝
`;

async function onboard(config: Config, lpAgent: LpAgentClient, signer: Signer): Promise<void> {
  console.log(BANNER);
  console.log(`  Wallet:    ${signer.publicKey}`);
  console.log(`  Strategy:  ${config.strategyType}`);
  console.log(`  Range:     -${config.rangePercentLow}% to -${config.rangePercentHigh}% SOL side`);
  console.log(`  Max pos:   ${config.maxPositions}`);
  console.log(`  Stop-loss: ${config.stopLossHours}h`);
  console.log();

  // Validate API key by fetching balance
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

async function runScanCycle(
  lpAgent: LpAgentClient,
  jupiter: JupiterClient,
  gecko: GeckoClient,
  signer: Signer,
  telegram: Telegram,
  config: Config,
  state: AppState,
): Promise<void> {
  // Check current position count
  const currentPositions = state.positions.length;
  if (currentPositions >= config.maxPositions) {
    console.log(`[main] Max positions reached (${currentPositions}/${config.maxPositions}) — skipping scan`);
    return;
  }

  const slotsAvailable = config.maxPositions - currentPositions;
  const candidates = await scanForCandidates(lpAgent, jupiter, config, state);

  for (const candidate of candidates.slice(0, slotsAvailable)) {
    const { pool } = candidate;
    console.log(`[main] Entering: ${pool.token0_symbol}/${pool.token1_symbol} — ${candidate.reason}`);

    try {
      // Get pool info for bin calculation
      const poolInfo = await lpAgent.getPoolInfo(pool.pool);

      // Calculate SOL amount per position
      const balances = await lpAgent.getTokenBalances(signer.publicKey);
      const sol = balances.find((b) => b.symbol === "SOL");
      const solBalance = sol?.balance ?? 0;
      const inputSOL = Math.min(solBalance * 0.3, solBalance - 0.05); // Use 30% or leave 0.05 for fees
      if (inputSOL < 0.01) {
        console.log("[main] Insufficient SOL for position entry");
        break;
      }

      const result = await executeZapIn(lpAgent, signer, config, pool.pool, poolInfo, inputSOL);
      if (result) {
        addPosition(state, {
          positionId: result.positionPubKey,
          poolId: pool.pool,
          tokenMint: pool.token0,
          entryTime: Date.now(),
          entryPrice: pool.base_price,
          strategy: config.strategyType,
        });
        recordPump(state, pool.token0);
        await telegram.notifyEntry(pool.pool, `${pool.token0_symbol}/${pool.token1_symbol}`, config.strategyType, inputSOL);
        console.log(`[main] ✅ Position opened: ${result.positionPubKey.slice(0, 12)}...`);
      }
    } catch (err) {
      console.error(`[main] Entry failed for ${pool.token0_symbol}:`, err);
      await telegram.notifyError(`Entry ${pool.token0_symbol}`, String(err));
    }
  }
}

async function runMonitorCycle(
  lpAgent: LpAgentClient,
  gecko: GeckoClient,
  signer: Signer,
  telegram: Telegram,
  config: Config,
  state: AppState,
): Promise<void> {
  if (state.positions.length === 0) return;

  const decisions = await evaluatePositions(lpAgent, gecko, config, state, signer.publicKey);

  for (const decision of decisions) {
    if (decision.action === "exit") {
      console.log(`[main] 🚪 Exiting: ${decision.position.pairName} — ${decision.reason}`);

      try {
        const result = await executeZapOut(lpAgent, signer, config, decision.position);
        if (result) {
          removePosition(state, decision.tracked.positionId);
          await telegram.notifyExit(
            decision.position.pairName,
            decision.reason,
            decision.position.pnl.valueNative,
          );
          console.log(`[main] ✅ Position closed: ${decision.position.pairName}`);
        }
      } catch (err) {
        console.error(`[main] Exit failed for ${decision.position.pairName}:`, err);
        await telegram.notifyError(`Exit ${decision.position.pairName}`, String(err));
      }
    } else {
      console.log(`[main] 📊 ${decision.position.pairName} — ${decision.reason}`);
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const lpAgent = new LpAgentClient(config);
  const jupiter = new JupiterClient();
  const gecko = new GeckoClient();
  const signer = createSigner(config);
  const telegram = new Telegram(config);
  const state = loadState();

  await onboard(config, lpAgent, signer);
  await telegram.notifyStartup(signer.publicKey, 0);

  console.log("[main] Starting Evil Panda loop...\n");

  let lastScanTime = 0;
  let running = true;

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n[main] Shutting down gracefully...");
    running = false;
    saveState(state);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (running) {
    try {
      // Priority 1: Monitor existing positions (every poll interval)
      await runMonitorCycle(lpAgent, gecko, signer, telegram, config, state);

      // Priority 2: Scan for new entries (every scan interval)
      const now = Date.now();
      if (now - lastScanTime >= config.scanIntervalMs) {
        await runScanCycle(lpAgent, jupiter, gecko, signer, telegram, config, state);
        lastScanTime = now;
      }
    } catch (err) {
      console.error("[main] Loop error:", err);
      await telegram.notifyError("Main loop", String(err));
    }

    // Wait for next poll cycle
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
  }

  console.log("[main] Evil Panda stopped. State saved.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
