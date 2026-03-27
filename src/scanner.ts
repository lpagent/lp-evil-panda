import type { Config } from "./config.js";
import type { LpAgentClient, PoolDiscoveryItem } from "./lp-agent-client.js";
import type { JupiterClient } from "./jupiter-client.js";
import type { AppState } from "./state.js";
import { getPumpCount } from "./state.js";

const MAX_PUMP_COUNT = 3;

export interface ScanCandidate {
  pool: PoolDiscoveryItem;
  safetyScore: number;
  reason: string;
}

export async function scanForCandidates(
  lpAgent: LpAgentClient,
  jupiter: JupiterClient,
  config: Config,
  state: AppState,
): Promise<ScanCandidate[]> {
  console.log("[scanner] Discovering pools...");

  let pools: PoolDiscoveryItem[];
  try {
    pools = await lpAgent.discoverPools({
      sortBy: "vol_24h",
      sortOrder: "desc",
      pageSize: 20,
      minMcap: config.minMcap,
      maxMcap: config.maxMcap,
      minVol24h: config.minVol24h,
      minLiquidity: config.minLiquidity,
      minOrganicScore: config.minOrganicScore,
      minAgeHr: config.minAgeHr,
      maxAgeHr: config.maxAgeHr,
    });
  } catch (err) {
    console.error("[scanner] Pool discovery failed:", err);
    return [];
  }

  if (!Array.isArray(pools) || pools.length === 0) {
    console.log("[scanner] No pools found matching filters");
    return [];
  }

  console.log(`[scanner] Found ${pools.length} pools, applying filters...`);

  const candidates: ScanCandidate[] = [];

  for (const pool of pools) {
    const reasons: string[] = [];

    // Filter: price momentum (approximate ATH detection)
    if (pool.price_1h_change < config.minPriceChange1h) {
      continue; // Not pumping enough
    }

    // Filter: mint freeze (rug risk)
    if (pool.mint_freeze) {
      continue;
    }

    // Filter: repeat pump check
    const pumpCount = getPumpCount(state, pool.token0);
    if (pumpCount >= MAX_PUMP_COUNT) {
      continue; // Already pumped too many times
    }

    // Filter: organic score
    if (pool.organic_score < config.minOrganicScore) {
      continue;
    }

    // Jupiter token safety check (fail closed — skip pool if check fails)
    let safetyScore = pool.organic_score;
    try {
      const safety = await jupiter.getTokenSafety(pool.token0);
      if (safety) {
        if (safety.hasFreeze) {
          reasons.push("WARN: freeze authority exists");
          safetyScore -= 20;
        }
        if (safety.hasMint) {
          reasons.push("WARN: mint authority exists");
          safetyScore -= 20;
        }
      } else {
        // Safety check failed — skip pool (fail closed)
        console.log(`[scanner] Skipping ${pool.token0_symbol} — Jupiter safety check failed`);
        continue;
      }
    } catch {
      console.log(`[scanner] Skipping ${pool.token0_symbol} — Jupiter safety check error`);
      continue;
    }

    if (safetyScore < 10) {
      continue; // Too risky after safety deductions
    }

    reasons.push(
      `vol24h=$${pool.vol_24h.toLocaleString()}`,
      `mcap=$${pool.mcap.toLocaleString()}`,
      `1h_change=${pool.price_1h_change.toFixed(1)}%`,
      `organic=${pool.organic_score}`,
    );

    candidates.push({
      pool,
      safetyScore,
      reason: reasons.join(" | "),
    });
  }

  // Sort by safety score descending
  candidates.sort((a, b) => b.safetyScore - a.safetyScore);

  console.log(`[scanner] ${candidates.length} candidates passed all filters`);
  return candidates;
}
