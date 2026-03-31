import "dotenv/config";

export interface Config {
  // LP Agent API
  lpAgentApiKey: string;
  lpAgentBaseUrl: string;
  verboseApiLogs: boolean;

  // Wallet
  owsWalletName?: string;
  solanaKeypairPath?: string;
  privateKey?: string;

  // Telegram
  telegramBotToken?: string;
  telegramChatId?: string;

  // Strategy
  strategyType: "Spot" | "Curve" | "BidAsk";
  rangePercentLow: number;
  rangePercentHigh: number;
  maxPositions: number;
  pollIntervalMs: number;
  scanIntervalMs: number;
  slippageBps: number;
  stopLossHours: number;

  // Scanner filters
  minVol24h: number;
  minLiquidity: number;
  minMcap: number;
  maxMcap: number;
  minAgeHr: number;
  maxAgeHr: number;
  minOrganicScore: number;
  minPriceChange1h: number;

  // Exit signal thresholds
  rsiPeriod: number;
  rsiExitThreshold: number;
  bbPeriod: number;
  bbStdDev: number;

  // Circuit breaker
  circuitBreakerEnabled: boolean;
  circuitBreakerFailureThreshold: number;
  circuitBreakerCooldownMs: number;
}

function envStr(key: string, fallback?: string): string {
  const val = process.env[key];
  if (!val && fallback === undefined) throw new Error(`Missing required env var: ${key}`);
  return val || fallback!;
}

function envNum(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const num = Number(val);
  if (isNaN(num)) throw new Error(`Invalid numeric env var: ${key}=${val}`);
  return num;
}

function envBool(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (!val) return fallback;
  const lowered = val.toLowerCase();
  if (lowered === "true" || lowered === "1") return true;
  if (lowered === "false" || lowered === "0") return false;
  throw new Error(`Invalid boolean env var: ${key}=${val}`);
}

const VALID_STRATEGIES = ["Spot", "Curve", "BidAsk"] as const;
function validateStrategy(val?: string): Config["strategyType"] {
  if (!val) return "Spot";
  if (!VALID_STRATEGIES.includes(val as any)) {
    throw new Error(`Invalid STRATEGY_TYPE: "${val}". Must be one of: ${VALID_STRATEGIES.join(", ")}`);
  }
  return val as Config["strategyType"];
}

export function loadConfig(): Config {
  return {
    lpAgentApiKey: envStr("LP_AGENT_API_KEY"),
    lpAgentBaseUrl: envStr("LP_AGENT_BASE_URL", "https://api.lpagent.io/open-api/v1"),
    verboseApiLogs: envBool("VERBOSE_API_LOGS", false),

    owsWalletName: process.env.OWS_WALLET_NAME,
    solanaKeypairPath: process.env.SOLANA_KEYPAIR_PATH,
    privateKey: process.env.PRIVATE_KEY,

    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,

    strategyType: validateStrategy(process.env.STRATEGY_TYPE),
    rangePercentLow: envNum("RANGE_PERCENT_LOW", 80),
    rangePercentHigh: envNum("RANGE_PERCENT_HIGH", 90),
    maxPositions: envNum("MAX_POSITIONS", 3),
    pollIntervalMs: envNum("POLL_INTERVAL_MS", 60_000),
    scanIntervalMs: envNum("SCAN_INTERVAL_MS", 300_000),
    slippageBps: envNum("SLIPPAGE_BPS", 100),
    stopLossHours: envNum("STOP_LOSS_HOURS", 24),

    minVol24h: envNum("MIN_VOL_24H", 50_000),
    minLiquidity: envNum("MIN_LIQUIDITY", 10_000),
    minMcap: envNum("MIN_MCAP", 100_000),
    maxMcap: envNum("MAX_MCAP", 50_000_000),
    minAgeHr: envNum("MIN_AGE_HR", 1),
    maxAgeHr: envNum("MAX_AGE_HR", 720),
    minOrganicScore: envNum("MIN_ORGANIC_SCORE", 30),
    minPriceChange1h: envNum("MIN_PRICE_CHANGE_1H", 10),

    rsiPeriod: envNum("RSI_PERIOD", 2),
    rsiExitThreshold: envNum("RSI_EXIT_THRESHOLD", 90),
    bbPeriod: envNum("BB_PERIOD", 20),
    bbStdDev: envNum("BB_STD_DEV", 2),

    circuitBreakerEnabled: envBool("CIRCUIT_BREAKER_ENABLED", true),
    circuitBreakerFailureThreshold: envNum("CIRCUIT_BREAKER_FAILURE_THRESHOLD", 3),
    circuitBreakerCooldownMs: envNum("CIRCUIT_BREAKER_COOLDOWN_MS", 300_000),
  };
}
