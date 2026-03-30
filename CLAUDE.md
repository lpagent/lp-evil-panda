# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Setup & development commands

- Install deps: `yarn install`
- Run in dev mode (TypeScript via tsx): `yarn dev`
- Build: `yarn build`
- Run built bot: `yarn start`
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

This is a single-process autonomous trading bot for Meteora DLMM “Evil Panda” strategy.

Primary control flow (`src/index.ts`):
1. Load config, initialize clients/signer/telegram, load persisted state.
2. On each loop (`pollIntervalMs`):
   - **Monitor existing positions first** via `evaluatePositions`.
   - **Scan for new pools less frequently** via `scanIntervalMs`.
3. Persist state to `state.json` on position changes and shutdown.

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
- Runtime state is file-based (`state.json`), so local runs can affect subsequent behavior unless state is reset.
- `runScanCycle` sizes entries from SOL balance (`~30%` with fee buffer), so wallet balance directly affects behavior.
