import type { Config } from "./config.js";

export class Telegram {
  private botToken?: string;
  private chatId?: string;
  private enabled: boolean;

  constructor(config: Config) {
    this.botToken = config.telegramBotToken;
    this.chatId = config.telegramChatId;
    this.enabled = !!(this.botToken && this.chatId);
    if (!this.enabled) {
      console.log("[telegram] No bot token or chat ID — alerts disabled");
    }
  }

  async send(message: string): Promise<void> {
    if (!this.enabled) return;
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          parse_mode: "Markdown",
        }),
      });
    } catch (err) {
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
