import { BollingerBands, RSI, MACD } from "technicalindicators";
import type { OHLCV } from "./gecko-client.js";
import type { Config } from "./config.js";

export interface ExitSignals {
  bbUpperBreak: boolean;
  rsiOverbought: boolean;
  macdFirstGreen: boolean;
  signalCount: number;
  shouldExit: boolean;
  details: string;
}

export function computeExitSignals(candles: OHLCV[], config: Config): ExitSignals {
  const result: ExitSignals = {
    bbUpperBreak: false,
    rsiOverbought: false,
    macdFirstGreen: false,
    signalCount: 0,
    shouldExit: false,
    details: "",
  };

  const closes = candles.map((c) => c.close);

  // Need enough data for Bollinger Bands (longest indicator)
  if (closes.length < config.bbPeriod + 5) {
    result.details = `Insufficient data (${closes.length}/${config.bbPeriod + 5} candles)`;
    return result;
  }

  // Bollinger Bands — check if last close is above upper band
  const bb = BollingerBands.calculate({
    period: config.bbPeriod,
    values: closes,
    stdDev: config.bbStdDev,
  });
  if (bb.length > 0) {
    const lastBB = bb[bb.length - 1];
    const lastClose = closes[closes.length - 1];
    if (lastClose > lastBB.upper) {
      result.bbUpperBreak = true;
    }
  }

  // RSI(2) — check if above exit threshold
  const rsi = RSI.calculate({ values: closes, period: config.rsiPeriod });
  if (rsi.length > 0) {
    const lastRSI = rsi[rsi.length - 1];
    if (lastRSI > config.rsiExitThreshold) {
      result.rsiOverbought = true;
    }
  }

  // MACD — check for first green histogram bar after red
  const macd = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  });
  if (macd.length >= 2) {
    const prev = macd[macd.length - 2];
    const curr = macd[macd.length - 1];
    if (
      prev.histogram !== undefined && curr.histogram !== undefined &&
      prev.histogram < 0 && curr.histogram > 0
    ) {
      result.macdFirstGreen = true;
    }
  }

  // Count confluence signals
  if (result.bbUpperBreak) result.signalCount++;
  if (result.rsiOverbought) result.signalCount++;
  if (result.macdFirstGreen) result.signalCount++;

  // Evil Panda rule: need 2+ signals for exit
  result.shouldExit = result.signalCount >= 2;

  const parts: string[] = [];
  if (result.bbUpperBreak) parts.push("BB_UPPER");
  if (result.rsiOverbought) parts.push(`RSI(${config.rsiPeriod})>${config.rsiExitThreshold}`);
  if (result.macdFirstGreen) parts.push("MACD_GREEN");
  result.details = parts.length > 0
    ? `${result.signalCount} signals: ${parts.join(", ")}`
    : "No exit signals";

  return result;
}
