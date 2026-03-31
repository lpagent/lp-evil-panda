import type { Config } from "./config.js";
import type { LpAgentClient, PoolInfo, ZapInResponse, ZapOutResponse } from "./lp-agent-client.js";
import type { Signer } from "./signer.js";
import type { OpenPosition } from "./lp-agent-client.js";

export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 3000;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfterMs(err: unknown): number | null {
  const text = String(err);
  const match = text.match(/retry[- ]after[^\d]*(\d+)/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

function classifyRetry(err: unknown): "retry" | "stop" {
  const text = String(err);
  if (text.includes("API error 400") || text.includes("API error 401") || text.includes("API error 403") || text.includes("API error 404")) {
    return "stop";
  }
  return "retry";
}

async function waitBeforeRetry(err: unknown, attempt: number): Promise<void> {
  const text = String(err);
  if (text.includes("API error 429")) {
    const retryAfter = parseRetryAfterMs(err);
    const backoffMs = Math.max(retryAfter ?? 0, RETRY_DELAY_MS * attempt * 2);
    await sleep(backoffMs);
    return;
  }
  await sleep(RETRY_DELAY_MS * attempt);
}

async function signAndSubmitTxs(
  txs: string[],
  signer: Signer,
): Promise<string[]> {
  const signed: string[] = [];
  for (const tx of txs) {
    const signedTx = await signer.signTransaction(tx);
    signed.push(signedTx);
  }
  return signed;
}

export async function executeZapIn(
  lpAgent: LpAgentClient,
  signer: Signer,
  config: Config,
  poolId: string,
  poolInfo: PoolInfo,
  inputSOL: number,
): Promise<{ positionPubKey: string; signature: string } | null> {
  if (!poolInfo.liquidityViz) {
    console.error("[executor] Pool has no liquidity viz data (not a DLMM pool?)");
    return null;
  }

  const activeBinId = poolInfo.liquidityViz.activeBin.binId;
  // SOL-sided range: from active bin down by rangePercentLow-rangePercentHigh
  // For a -80% to -90% SOL side, we place bins below the active price
  const rangeBins = Math.floor(poolInfo.liquidityViz.bins.length * (config.rangePercentLow / 100));
  const fromBinId = activeBinId - rangeBins;
  const toBinId = activeBinId;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[executor] Zap-in attempt ${attempt}/${MAX_RETRIES} — ${inputSOL} SOL into ${poolId.slice(0, 8)}...`);

      // Step 1: Get unsigned transactions from LP Agent
      const zapIn: ZapInResponse = await lpAgent.createZapInTx(poolId, {
        stratergy: config.strategyType,
        inputSOL,
        percentX: 0, // SOL-sided, all goes to quote token side
        fromBinId,
        toBinId,
        owner: signer.publicKey,
        slippage_bps: config.slippageBps,
        mode: "zap-in",
      });

      // Step 2: Sign all transactions
      const signedSwaps = await signAndSubmitTxs(zapIn.swapTxsWithJito, signer);
      const signedAdds = await signAndSubmitTxs(zapIn.addLiquidityTxsWithJito, signer);

      // Step 3: Submit via Jito bundle
      const result = await lpAgent.submitZapIn({
        lastValidBlockHeight: zapIn.lastValidBlockHeight,
        swapTxsWithJito: signedSwaps,
        addLiquidityTxsWithJito: signedAdds,
        meta: zapIn.meta,
      });

      console.log(`[executor] Zap-in SUCCESS — sig: ${result.signature.slice(0, 16)}...`);
      return {
        positionPubKey: zapIn.meta.positionPubKey,
        signature: result.signature,
      };
    } catch (err) {
      console.error(`[executor] Zap-in attempt ${attempt} failed:`, err);
      if (classifyRetry(err) === "stop") {
        break;
      }
      if (attempt < MAX_RETRIES) {
        await waitBeforeRetry(err, attempt);
      }
    }
  }

  console.error("[executor] Zap-in FAILED after all retries");
  return null;
}

export async function executeZapOut(
  lpAgent: LpAgentClient,
  signer: Signer,
  config: Config,
  position: OpenPosition,
): Promise<{ signature: string } | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[executor] Zap-out attempt ${attempt}/${MAX_RETRIES} — ${position.pairName}`);

      // Step 1: Get unsigned transactions from LP Agent
      const zapOut: ZapOutResponse = await lpAgent.createZapOutTx({
        position_id: position.tokenId,
        bps: 10_000, // 100% — full exit
        owner: signer.publicKey,
        slippage_bps: config.slippageBps,
        output: "allBaseToken", // Convert everything to SOL
        provider: "meteora",
      });

      // Step 2: Sign all transactions
      const signedClose = await signAndSubmitTxs(zapOut.closeTxsWithJito, signer);
      const signedSwap = await signAndSubmitTxs(zapOut.swapTxsWithJito, signer);

      // Step 3: Submit via Jito bundle
      const result = await lpAgent.submitZapOut({
        lastValidBlockHeight: zapOut.lastValidBlockHeight,
        closeTxsWithJito: signedClose,
        swapTxsWithJito: signedSwap,
      });

      console.log(`[executor] Zap-out SUCCESS — sig: ${result.signature.slice(0, 16)}...`);
      return { signature: result.signature };
    } catch (err) {
      console.error(`[executor] Zap-out attempt ${attempt} failed:`, err);
      if (classifyRetry(err) === "stop") {
        break;
      }
      if (attempt < MAX_RETRIES) {
        await waitBeforeRetry(err, attempt);
      }
    }
  }

  // Verify state after all retries fail
  try {
    const balances = await lpAgent.getTokenBalances(signer.publicKey);
    console.log("[executor] Post-failure balance check:", balances.map((b) => `${b.symbol}: ${b.balance}`).join(", "));
  } catch {
    console.error("[executor] Could not verify wallet state after failed zap-out");
  }

  console.error("[executor] Zap-out FAILED after all retries");
  return null;
}
