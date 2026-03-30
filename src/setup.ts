import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { loadConfig } from "./config.js";
import { LpAgentClient } from "./lp-agent-client.js";
import { createSigner } from "./signer.js";
import { loadState } from "./state.js";

interface SetupResult {
  text: string;
}

function checkOwsAvailable(): boolean {
  try {
    execFileSync("ows", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function tryInstallOws(): { ok: boolean; message: string } {
  try {
    execFileSync("npm", ["i", "-g", "@open-wallet-standard/core"], { stdio: "pipe" });
  } catch (err) {
    return {
      ok: false,
      message: `Failed to auto-install OpenWallet via npm: ${String(err)}`,
    };
  }

  if (!checkOwsAvailable()) {
    return {
      ok: false,
      message:
        "OpenWallet install command ran but `ows` is still unavailable on PATH. Verify global npm bin is on PATH.",
    };
  }

  return { ok: true, message: "OpenWallet CLI installed successfully (`ows` is now available)." };
}

function maskAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function walletModeSummary(): string {
  if (process.env.OWS_WALLET_NAME) return `OpenWallet (${process.env.OWS_WALLET_NAME})`;
  if (process.env.SOLANA_KEYPAIR_PATH) return `Keypair file (${process.env.SOLANA_KEYPAIR_PATH})`;
  if (process.env.PRIVATE_KEY) return "Private key (env)";
  return "Not configured";
}

function hasDefaultSolanaKeypair(): boolean {
  const defaultPath = `${process.env.HOME || ""}/.config/solana/id.json`;
  return existsSync(defaultPath);
}

export async function runSetupBootstrap(): Promise<SetupResult> {
  const lines: string[] = [];
  lines.push("LP Evil Panda setup check");
  lines.push("");

  const walletMode = walletModeSummary();
  lines.push("Configuration");
  lines.push(`- wallet mode: ${walletMode}`);

  let config;
  try {
    config = loadConfig();
    lines.push("- LP_AGENT_API_KEY: ✓ set");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push("- LP_AGENT_API_KEY: ✗ missing or invalid");
    lines.push(`- details: ${msg}`);
    lines.push("");
    lines.push("How to fix");
    lines.push("1) Get API key from https://portal.lpagent.io");
    lines.push("2) Set LP_AGENT_API_KEY in your environment or .env");
    lines.push("3) Configure one wallet option: OWS_WALLET_NAME or SOLANA_KEYPAIR_PATH or PRIVATE_KEY");
    if (!hasDefaultSolanaKeypair()) {
      lines.push("4) (optional) Or place a default Solana keypair at ~/.config/solana/id.json");
    }
    return { text: lines.join("\n") };
  }

  if (config.owsWalletName && !checkOwsAvailable()) {
    lines.push("- OpenWallet CLI (`ows`): ✗ missing (OWS_WALLET_NAME is set)");
    const install = tryInstallOws();
    if (install.ok) {
      lines.push(`- OpenWallet auto-install: ✓ ${install.message}`);
    } else {
      lines.push(`- OpenWallet auto-install: ✗ ${install.message}`);
      lines.push("- manual install: npm i -g @open-wallet-standard/core");
    }
  } else if (config.owsWalletName) {
    lines.push("- OpenWallet CLI (`ows`): ✓ available");
  }

  let signerAddress: string | null = null;
  try {
    const signer = createSigner(config);
    signerAddress = signer.publicKey;
    lines.push(`- signer: ✓ ready (${maskAddress(signer.publicKey)})`);
  } catch (err) {
    lines.push(`- signer: ✗ ${err instanceof Error ? err.message : String(err)}`);
  }

  if (signerAddress) {
    try {
      const lpAgent = new LpAgentClient(config);
      const balances = await lpAgent.getTokenBalances(signerAddress);
      const sol = balances.find((b) => b.symbol === "SOL");
      if (sol) {
        lines.push(`- SOL balance: ${sol.balance.toFixed(4)} SOL (~$${sol.balanceInUsd.toFixed(2)})`);
      } else {
        lines.push("- SOL balance: not found in LP Agent wallet balances");
      }
    } catch (err) {
      lines.push(`- LP Agent API check: ✗ ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const state = loadState();
  lines.push("");
  lines.push("Local state");
  lines.push(`- tracked positions: ${state.positions.length}`);
  lines.push(`- tracked token pumps: ${Object.keys(state.seenCoins).length}`);

  lines.push("");
  lines.push("Next steps");
  lines.push("- run lp-status to inspect state quickly");
  lines.push("- run lp-scan for one entry cycle");
  lines.push("- run lp-monitor for one monitor/exit cycle");

  return { text: lines.join("\n") };
}
