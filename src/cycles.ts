import { addPosition, recordPump, removePosition, saveState } from "./state.js";
import { evaluatePositions } from "./position-manager.js";
import { scanForCandidates } from "./scanner.js";
import { executeZapIn, executeZapOut } from "./executor.js";
import type { AppContext } from "./app-context.js";

export async function runScanCycle(context: AppContext): Promise<void> {
  const { config, lpAgent, jupiter, signer, telegram, state } = context;
  let hadFailure = false;

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
      const poolInfo = await lpAgent.getPoolInfo(pool.pool);
      const balances = await lpAgent.getTokenBalances(signer.publicKey);
      const sol = balances.find((b) => b.symbol === "SOL");
      const solBalance = sol?.balance ?? 0;
      const inputSOL = Math.min(solBalance * 0.3, solBalance - 0.05);
      if (inputSOL < 0.01) {
        console.log("[main] Insufficient SOL for position entry");
        continue;
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
        saveState(state);
        await telegram.notifyEntry(pool.pool, `${pool.token0_symbol}/${pool.token1_symbol}`, config.strategyType, inputSOL);
        console.log(`[main] ✅ Position opened: ${result.positionPubKey.slice(0, 12)}...`);
      } else {
        hadFailure = true;
      }
    } catch (err) {
      hadFailure = true;
      console.error(`[main] Entry failed for ${pool.token0_symbol}:`, err);
      await telegram.notifyError(`Entry ${pool.token0_symbol}`, String(err));
    }
  }

  if (hadFailure) {
    throw new Error("Scan cycle had one or more failed entries");
  }
}

export async function runMonitorCycle(context: AppContext): Promise<void> {
  const { config, lpAgent, gecko, signer, telegram, state } = context;
  let hadFailure = false;

  if (state.positions.length === 0) return;

  const decisions = await evaluatePositions(lpAgent, gecko, config, state, signer.publicKey);

  for (const decision of decisions) {
    if (decision.action === "exit") {
      console.log(`[main] 🚪 Exiting: ${decision.position.pairName} — ${decision.reason}`);

      try {
        const result = await executeZapOut(lpAgent, signer, config, decision.position);
        if (result) {
          removePosition(state, decision.tracked.positionId);
          saveState(state);
          await telegram.notifyExit(
            decision.position.pairName,
            decision.reason,
            decision.position.pnl.valueNative,
          );
          console.log(`[main] ✅ Position closed: ${decision.position.pairName}`);
        } else {
          hadFailure = true;
        }
      } catch (err) {
        hadFailure = true;
        console.error(`[main] Exit failed for ${decision.position.pairName}:`, err);
        await telegram.notifyError(`Exit ${decision.position.pairName}`, String(err));
      }
    } else {
      console.log(`[main] 📊 ${decision.position.pairName} — ${decision.reason}`);
    }
  }

  if (hadFailure) {
    throw new Error("Monitor cycle had one or more failed exits");
  }
}
