import { Keypair, VersionedTransaction, Transaction } from "@solana/web3.js";
import { execFileSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import bs58 from "bs58";
import type { Config } from "./config.js";

export interface Signer {
  publicKey: string;
  signTransaction(txBase64: string): Promise<string>;
}

function tryOws(walletName: string): Signer | null {
  try {
    execFileSync("ows", ["--version"], { stdio: "ignore" });
  } catch {
    return null;
  }

  let publicKey: string;
  try {
    publicKey = execFileSync("ows", ["address", "--wallet", walletName, "--chain", "solana"], {
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }

  return {
    publicKey,
    async signTransaction(txBase64: string): Promise<string> {
      try {
        const result = execFileSync(
          "ows",
          ["sign", "transaction", "--wallet", walletName, "--chain", "solana", "--data", txBase64],
          { encoding: "utf-8" }
        ).trim();
        return result;
      } catch (err) {
        throw new Error(`OWS signing failed: ${err}`);
      }
    },
  };
}

function tryLocalKeypair(config: Config): Signer | null {
  let secretKey: Uint8Array | null = null;

  // Try private key from env (base58)
  if (config.privateKey) {
    try {
      secretKey = bs58.decode(config.privateKey);
    } catch {
      console.warn("[signer] Invalid base58 private key");
    }
  }

  // Try keypair file path
  if (!secretKey && config.solanaKeypairPath) {
    const path = config.solanaKeypairPath.replace("~", process.env.HOME || "");
    if (existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, "utf-8"));
        secretKey = new Uint8Array(raw);
      } catch {
        console.warn("[signer] Failed to read keypair file");
      }
    }
  }

  // Try default Solana CLI keypair
  if (!secretKey) {
    const defaultPath = `${process.env.HOME}/.config/solana/id.json`;
    if (existsSync(defaultPath)) {
      try {
        const raw = JSON.parse(readFileSync(defaultPath, "utf-8"));
        secretKey = new Uint8Array(raw);
      } catch {
        // ignore
      }
    }
  }

  if (!secretKey) return null;

  const keypair = Keypair.fromSecretKey(secretKey);

  return {
    publicKey: keypair.publicKey.toBase58(),
    async signTransaction(txBase64: string): Promise<string> {
      const txBuf = Buffer.from(txBase64, "base64");
      let signed: Buffer;

      try {
        // Try versioned transaction first
        const vtx = VersionedTransaction.deserialize(txBuf);
        vtx.sign([keypair]);
        signed = Buffer.from(vtx.serialize());
      } catch {
        // Fall back to legacy transaction
        const ltx = Transaction.from(txBuf);
        ltx.partialSign(keypair);
        signed = Buffer.from(ltx.serialize({ requireAllSignatures: false }));
      }

      return signed.toString("base64");
    },
  };
}

export function createSigner(config: Config): Signer {
  // Try OWS first (most secure)
  if (config.owsWalletName) {
    const ows = tryOws(config.owsWalletName);
    if (ows) {
      console.log(`[signer] Using OpenWallet (${config.owsWalletName})`);
      return ows;
    }
    console.warn("[signer] OWS wallet specified but OWS not available — falling back to local keypair");
  }

  // Fall back to local keypair
  const local = tryLocalKeypair(config);
  if (local) {
    console.log(`[signer] Using local keypair (${local.publicKey.slice(0, 8)}...)`);
    return local;
  }

  throw new Error(
    "No signer available. Set OWS_WALLET_NAME for OpenWallet, " +
    "or PRIVATE_KEY / SOLANA_KEYPAIR_PATH for local keypair."
  );
}
