export interface TokenSafetyInfo {
  freezeAuthority: string | null;
  mintAuthority: string | null;
  isToken2022: boolean;
  hasFreeze: boolean;
  hasMint: boolean;
}

export class JupiterClient {
  private baseUrl = "https://api.jup.ag";
  private verboseApiLogs: boolean;

  constructor(verboseApiLogs = false) {
    this.verboseApiLogs = verboseApiLogs;
  }

  private verboseLog(message: string, extra?: unknown): void {
    if (!this.verboseApiLogs) return;
    if (extra === undefined) {
      console.log(`[verbose][jupiter] ${message}`);
      return;
    }
    console.log(`[verbose][jupiter] ${message}`, extra);
  }

  async getTokenSafety(mintAddress: string): Promise<TokenSafetyInfo | null> {
    const path = `/tokens/v1/solana/${mintAddress}`;
    const startedAt = Date.now();
    try {
      this.verboseLog(`GET ${path} request`);
      const res = await fetch(`${this.baseUrl}${path}`);
      const elapsedMs = Date.now() - startedAt;
      if (!res.ok) {
        this.verboseLog(`GET ${path} failed`, { status: res.status, elapsedMs });
        return null;
      }
      const data = await res.json() as Record<string, unknown>;
      const result = {
        freezeAuthority: (data.freeze_authority as string) || null,
        mintAuthority: (data.mint_authority as string) || null,
        isToken2022: (data.is_token_2022 as boolean) || false,
        hasFreeze: !!(data.freeze_authority),
        hasMint: !!(data.mint_authority),
      };
      this.verboseLog(`GET ${path} success`, { status: res.status, elapsedMs, result });
      return result;
    } catch (err) {
      this.verboseLog(`GET ${path} error`, { error: String(err) });
      return null;
    }
  }

  async getPrice(mintAddress: string): Promise<number | null> {
    const path = `/price/v2?ids=${mintAddress}`;
    const startedAt = Date.now();
    try {
      this.verboseLog(`GET ${path} request`);
      const res = await fetch(`${this.baseUrl}${path}`);
      const elapsedMs = Date.now() - startedAt;
      if (!res.ok) {
        this.verboseLog(`GET ${path} failed`, { status: res.status, elapsedMs });
        return null;
      }
      const data = await res.json() as { data: Record<string, { price: string }> };
      const entry = data.data[mintAddress];
      const price = entry ? Number(entry.price) : null;
      this.verboseLog(`GET ${path} success`, { status: res.status, elapsedMs, price });
      return price;
    } catch (err) {
      this.verboseLog(`GET ${path} error`, { error: String(err) });
      return null;
    }
  }
}
