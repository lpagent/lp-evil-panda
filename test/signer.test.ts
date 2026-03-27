import { describe, it, expect } from "vitest";
import { createSigner } from "../src/signer.js";
import type { Config } from "../src/config.js";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

describe("signer", () => {
  it("creates signer from private key env var", () => {
    const keypair = Keypair.generate();
    const config = {
      privateKey: bs58.encode(keypair.secretKey),
    } as Config;

    const signer = createSigner(config);
    expect(signer.publicKey).toBe(keypair.publicKey.toBase58());
  });

  it("throws when no signer is available", () => {
    const config = {} as Config;
    expect(() => createSigner(config)).toThrow("No signer available");
  });
});
