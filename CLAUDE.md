# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Setup & development commands

- Install deps: `yarn install`
- Run in dev mode (TypeScript via tsx): `yarn dev`
- Build: `yarn build`
- Run built bot: `yarn start`
- Run one scan cycle: `yarn scan:once`
- Run one monitor/heartbeat cycle: `yarn monitor:once`
- Run all tests once: `yarn test`
- Run tests in watch mode: `yarn test:watch`
- Run a single test file: `yarn test test/executor.test.ts`
- Run tests matching a name: `yarn test -t "retries zap-in"`

Notes:
- Package manager in this repo is Yarn (`yarn.lock` present).
- No lint script is currently defined in `package.json`.

## Required runtime configuration

- Copy `.env.example` to `.env` and set at minimum:
  - `LP_AGENT_API_KEY`
  - one wallet method: `OWS_WALLET_NAME` or `SOLANA_KEYPAIR_PATH` or `PRIVATE_KEY`
- Optional Telegram alerts require `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`.

## Architecture overview

This repo contains the bot core for Meteora DLMM “Evil Panda” strategy.

Important project intent: this should be treated as an OpenClaw-managed plugin/integration, not only as a standalone bot. OpenClaw is the orchestration layer; the code here is the strategy engine.

Primary control flow in standalone mode:
1. `src/index.ts` delegates to `runStandaloneLoop()` in `src/orchestrator.ts`.
2. `src/orchestrator.ts` builds app context (`src/app-context.ts`) and runs:
   - `runMonitorCycle()` from `src/cycles.ts` on poll cadence
   - `runScanCycle()` from `src/cycles.ts` on scan cadence
3. State persists via `src/state.ts` and one-shot/loop runs are protected by `.openclaw-orchestrator.lock`.

OpenClaw integration expectation:
- use OpenClaw cron/scheduled jobs for scan cadence
- use OpenClaw heartbeat checks for frequent position-monitor cadence
- use plugin commands `lp-scan`, `lp-monitor`, and `lp-status` from `src/openclaw-plugin.ts`
- keep bot-level strategy intervals aligned with env defaults unless intentionally changed

Core modules and responsibilities:

- `src/config.ts`
  - Central env parsing + defaults + validation.
  - Strategy type must be one of `Spot | Curve | BidAsk`.

- `src/lp-agent-client.ts`
  - Typed wrapper around LP Agent API.
  - Handles pool discovery, pool info, open positions, balances, create/submit zap-in, create/submit zap-out.

- `src/scanner.ts`
  - Candidate discovery pipeline for entries.
  - Applies momentum/liquidity/market-cap/organic filters plus Jupiter safety checks.
  - Uses `state.seenCoins` to cap repeated pumps per token.

- `src/position-manager.ts`
  - Exit decision engine for tracked open positions.
  - Uses 15m GeckoTerminal candles + indicator confluence (`computeExitSignals`).
  - Enforces hard stop-loss rule (age + out-of-range + negative P&L).

- `src/analyzer.ts`
  - Technical indicators (Bollinger Bands, RSI, MACD) and confluence logic.
  - Exit rule: `signalCount >= 2`.

- `src/executor.ts`
  - Transaction execution workflow with retries for zap-in/out.
  - Signs all tx blobs through signer abstraction, then submits bundled txs.

- `src/signer.ts`
  - Signing abstraction:
    1. Prefer OpenWallet CLI (`ows`) when `OWS_WALLET_NAME` is configured.
    2. Fallback to local keypair (`PRIVATE_KEY`, `SOLANA_KEYPAIR_PATH`, or default Solana keypair path).

- `src/gecko-client.ts`
  - GeckoTerminal OHLCV fetcher with built-in rate limiting (~10 calls/min).

- `src/jupiter-client.ts`
  - Jupiter token safety lookup (freeze/mint authority checks) used by scanner.

- `src/state.ts`
  - JSON persistence in repo root (`state.json`) for tracked positions and seen token pump counts.

- `src/app-context.ts`
  - Shared bootstrap for config, clients, signer, telegram, and persisted state.

- `src/cycles.ts`
  - Reusable one-pass scan and monitor cycle implementations used by standalone mode and OpenClaw mode.

- `src/orchestrator.ts`
  - Standalone loop plus one-shot orchestration runners with lock protection.

- `src/openclaw-plugin.ts`
  - OpenClaw plugin bridge registering `lp-scan`, `lp-monitor`, and `lp-status` commands.

- `src/telegram.ts`
  - Optional notifications for startup, entry, exit, and errors.

## Testing structure

- Test runner: Vitest (`vitest.config.ts`, Node environment).
- Tests are in `test/*.test.ts` and focus on strategy-critical logic:
  - `analyzer.test.ts`
  - `executor.test.ts`
  - `position-manager.test.ts`
  - `signer.test.ts`
  - `state.test.ts`

## Important implementation details

- TypeScript build compiles only `src/**/*` to `dist/`; tests are excluded from TS build (`tsconfig.json`).
- OpenClaw plugin metadata lives in `openclaw.plugin.json`, and `package.json` exposes `./dist/openclaw-plugin.js` under the `openclaw.extensions` key.
- Runtime state is file-based (`state.json`), so local runs can affect subsequent behavior unless state is reset.
- One-shot orchestration runners use `.openclaw-orchestrator.lock` to prevent overlapping cron/heartbeat executions.
- `runScanCycle` sizes entries from SOL balance (`~30%` with fee buffer), so wallet balance directly affects behavior.
