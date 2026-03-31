import type { Config } from "./config.js";

export class Telegram {
  private botToken?: string;
  private chatId?: string;
  private enabled: boolean;
  private verboseApiLogs: boolean;

  constructor(config: Config) {
    this.botToken = config.telegramBotToken;
    this.chatId = config.telegramChatId;
    this.enabled = !!(this.botToken && this.chatId);
    this.verboseApiLogs = config.verboseApiLogs;
    if (!this.enabled) {
      console.log("[telegram] No bot token or chat ID — alerts disabled");
    }
  }

  private verboseLog(message: string, extra?: unknown): void {
    if (!this.verboseApiLogs) return;
    if (extra === undefined) {
      console.log(`[verbose][telegram] ${message}`);
      return;
    }
    console.log(`[verbose][telegram] ${message}`, extra);
  }

  async send(message: string): Promise<void> {
    if (!this.enabled) return;
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const startedAt = Date.now();
      this.verboseLog("POST /sendMessage request", { chars: message.length });
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          parse_mode: "Markdown",
        }),
      });
      const elapsedMs = Date.now() - startedAt;
      if (!res.ok) {
        const body = await res.text();
        this.verboseLog("POST /sendMessage failed", { status: res.status, elapsedMs, body });
      } else {
        this.verboseLog("POST /sendMessage success", { status: res.status, elapsedMs });
      }
    } catch (err) {
      this.verboseLog("POST /sendMessage error", { error: String(err) });
      console.error("[telegram] Failed to send:", err);
    }
  }

  async notifyEntry(pool: string, pair: string, strategy: string, solAmount: number): Promise<void> {
    await this.send(
      `🐼 *ENTRY* | ${pair}\nPool: \`${pool.slice(0, 8)}...\`\nStrategy: ${strategy}\nAmount: ${solAmount.toFixed(4)} SOL`
    );
  }

  async notifyExit(pair: string, reason: string, pnl: number): Promise<void> {
    const emoji = pnl >= 0 ? "✅" : "❌";
    await this.send(
      `${emoji} *EXIT* | ${pair}\nReason: ${reason}\nP&L: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} SOL`
    );
  }

  async notifyError(context: string, error: string): Promise<void> {
    await this.send(`⚠️ *ERROR* | ${context}\n\`${error}\``);
  }

  async notifyStartup(wallet: string, balance: number): Promise<void> {
    await this.send(
      `🚀 *LP Evil Panda started*\nWallet: \`${wallet.slice(0, 8)}...\`\nBalance: ${balance.toFixed(4)} SOL`
    );
  }
}
