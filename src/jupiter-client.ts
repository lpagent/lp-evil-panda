export interface TokenSafetyInfo {
  freezeAuthority: string | null;
  mintAuthority: string | null;
  isToken2022: boolean;
  hasFreeze: boolean;
  hasMint: boolean;
}

export class JupiterClient {
  private baseUrl = "https://api.jup.ag";

  async getTokenSafety(mintAddress: string): Promise<TokenSafetyInfo | null> {
    try {
      const res = await fetch(`${this.baseUrl}/tokens/v1/solana/${mintAddress}`);
      if (!res.ok) return null;
      const data = await res.json() as Record<string, unknown>;
      return {
        freezeAuthority: (data.freeze_authority as string) || null,
        mintAuthority: (data.mint_authority as string) || null,
        isToken2022: (data.is_token_2022 as boolean) || false,
        hasFreeze: !!(data.freeze_authority),
        hasMint: !!(data.mint_authority),
      };
    } catch {
      return null;
    }
  }

  async getPrice(mintAddress: string): Promise<number | null> {
    try {
      const res = await fetch(`${this.baseUrl}/price/v2?ids=${mintAddress}`);
      if (!res.ok) return null;
      const data = await res.json() as { data: Record<string, { price: string }> };
      const entry = data.data[mintAddress];
      return entry ? Number(entry.price) : null;
    } catch {
      return null;
    }
  }
}
