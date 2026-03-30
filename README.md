# LP Evil Panda

Meteora DLMM liquidity provision strategy implementing **Evil Panda**, powered by the [LP Agent API](https://portal.lpagent.io). This repo contains the bot core and is intended to be used as an OpenClaw-managed plugin/integration for running the strategy.

## What it does

1. **Scans** for pumping meme coins on Meteora with good volume, safety checks (Jupiter token safety, freeze/mint authority), and organic activity filters
2. **Enters** SOL-sided SPOT DLMM positions with a wide range (-80% to -90%) to earn fees from volatility
3. **Monitors** positions on 15-minute candles using technical indicators (Bollinger Bands, RSI(2), MACD)
4. **Exits** when 2+ confluence signals fire, or after 24h hard stop-loss if out of range with negative P&L
5. **Alerts** via Telegram on entry, exit, errors, and startup

## Architecture

Current code path:

```
Scanner ──→ Executor (zap-in) ──→ Position Manager ──→ Executor (zap-out)
   │              │                       │                    │
   ▼              ▼                       ▼                    ▼
LP Agent API   Signer (OWS/local)   GeckoTerminal       LP Agent API
+ Jupiter      + Jito bundles        15m OHLCV           + Jito bundles
```

Intended operating model:

```
OpenClaw ──→ scheduled scan / heartbeat monitor ──→ bot core in this repo
```

**Priority-based polling in the current implementation:**
- Exit monitoring: every 1 minute (high priority)
- Pool scanning: every 5 minutes (lower priority)

## Quick start

```bash
# Clone and install
git clone https://github.com/lpagent/lp-evil-panda.git
cd lp-evil-panda
yarn install

# Configure
cp .env.example .env
# Edit .env — at minimum set LP_AGENT_API_KEY and a wallet option

# Run locally (standalone loop)
yarn dev

# Run a single scan tick
yarn scan:once

# Run a single monitor/heartbeat tick
yarn monitor:once
```

For production use, install this repo as an OpenClaw plugin and trigger `lp-scan` on cron + `lp-monitor` on heartbeat cadence.

### Get your LP Agent API key

1. Go to [portal.lpagent.io](https://portal.lpagent.io)
2. Create an account and generate an API key
3. Set `LP_AGENT_API_KEY` in your `.env` file

### Wallet options

| Method | Config | Security |
|--------|--------|----------|
| **OpenWallet (recommended)** | `OWS_WALLET_NAME=agent-treasury` | Policy-gated, agent never sees raw keys |
| Keypair file | `SOLANA_KEYPAIR_PATH=~/.config/solana/id.json` | Local file |
| Private key | `PRIVATE_KEY=base58_encoded_key` | Env var (least secure) |

### Setting up OpenWallet (OWS)

[OpenWallet](https://openwallet.sh/) is the recommended signing method — your bot never touches raw private keys. Transactions are signed through a policy-gated CLI, so you can restrict what your agent is allowed to do.

#### Install OWS

Use the official links:

- [OpenWallet](https://openwallet.sh/)
- [OpenWallet docs](https://docs.openwallet.sh/)
- [OpenClaw](https://openclaw.ai/) (orchestrator / assistant)

OpenClaw is the intended orchestration layer for this strategy. OpenWallet / `ows` is still the signing layer used by the bot.

If your OpenClaw workflow installs OWS for you, verify it with:

```bash
ows --version
```

#### Create a wallet for your bot

```bash
# Create a new Solana wallet
ows create wallet --name agent-treasury --chain solana

# View the wallet address (fund this with SOL)
ows address --wallet agent-treasury --chain solana

# Set in your .env
echo 'OWS_WALLET_NAME=agent-treasury' >> .env
```

The bot automatically detects OWS on your PATH and uses it for all transaction signing. If OWS is unavailable, it falls back to local keypair signing.

When running as OpenClaw plugin, `lp-start` / `lp-setup` can attempt to install OWS automatically via `npm i -g @open-wallet-standard/core` when `OWS_WALLET_NAME` is configured but `ows` is missing.

## OpenClaw orchestration model

This repo should be treated as the strategy core that OpenClaw drives.

OpenClaw-facing surfaces added in this repo:
- plugin entry: `src/openclaw-plugin.ts`
- plugin manifest: `openclaw.plugin.json`
- one-shot scan runner: `src/scan-once.ts`
- one-shot monitor runner: `src/monitor-once.ts`

Registered OpenClaw commands:
- `lp-start` — bootstrap setup check (env + signer + balance) and attempt OpenWallet auto-install if `OWS_WALLET_NAME` is set but `ows` is missing
- `lp-setup` — alias of `lp-start`
- `lp-scan` — run one entry scan / execution cycle
- `lp-monitor` — run one monitor / exit cycle
- `lp-status` — show tracked local state

Recommended OpenClaw responsibilities:
- trigger `lp-scan` on a cron schedule
- trigger `lp-monitor` on a heartbeat cadence
- surface alerts / progress updates
- restart or re-run monitoring flows after failures

Suggested cadence:
- heartbeat / monitor: every 60s
- cron / scan: every 5m

These match the strategy defaults:
- `POLL_INTERVAL_MS=60000`
- `SCAN_INTERVAL_MS=300000`

To avoid overlapping jobs, discrete runners use a repo-local lock file: `.openclaw-orchestrator.lock`.

## Configuration

All parameters are configurable via `.env`. See [.env.example](.env.example) for the full list.

### Strategy parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `STRATEGY_TYPE` | `Spot` | DLMM strategy: `Spot`, `Curve`, or `BidAsk` |
| `RANGE_PERCENT_LOW` | `80` | Lower range bound (% below active bin) |
| `RANGE_PERCENT_HIGH` | `90` | Upper range bound (% below active bin) |
| `MAX_POSITIONS` | `3` | Maximum concurrent LP positions |
| `POLL_INTERVAL_MS` | `60000` | Exit monitoring interval (ms) |
| `SCAN_INTERVAL_MS` | `300000` | Pool scanning interval (ms) |
| `SLIPPAGE_BPS` | `100` | Slippage tolerance in basis points |
| `STOP_LOSS_HOURS` | `24` | Hard stop-loss timer |

### Scanner filters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MIN_VOL_24H` | `50000` | Minimum 24h volume (USD) |
| `MIN_LIQUIDITY` | `10000` | Minimum pool liquidity (USD) |
| `MIN_MCAP` | `100000` | Minimum market cap |
| `MAX_MCAP` | `50000000` | Maximum market cap |
| `MIN_AGE_HR` | `1` | Minimum pool age (hours) |
| `MAX_AGE_HR` | `720` | Maximum pool age (hours) |
| `MIN_PRICE_CHANGE_1H` | `10` | Minimum 1h price change (%) |
| `MIN_ORGANIC_SCORE` | `30` | Minimum organic activity score |

### Exit signals (15m timeframe)

The bot exits when **2 or more** of these signals fire simultaneously:

- **Bollinger Bands**: Close above upper band (period=20, stdDev=2)
- **RSI(2)**: Value > 90 (extremely overbought on 2-period RSI)
- **MACD**: First green histogram bar after red (12/26/9)

## LP Agent API endpoints used

This bot demonstrates the full LP Agent API workflow:

| Endpoint | Purpose |
|----------|---------|
| `POST /pools/discover` | Find pools matching scanner filters |
| `GET /pools/{id}/info` | Get pool details, liquidity viz, active bin |
| `GET /user/positions` | List open positions for a wallet |
| `GET /user/token-balances` | Check SOL balance for position sizing |
| `POST /transaction/create-zap-in` | Build DLMM entry transactions |
| `POST /transaction/submit-zap-in` | Submit signed txs via Jito bundle |
| `POST /transaction/create-zap-out` | Build DLMM exit transactions |
| `POST /transaction/submit-zap-out` | Submit signed exit txs via Jito |

## Project structure

```
src/
  index.ts              Standalone entrypoint
  orchestrator.ts       Standalone loop + one-shot orchestration runners
  app-context.ts        Shared bootstrap for config/clients/state
  cycles.ts             Reusable scan and monitor cycle logic
  openclaw-plugin.ts    OpenClaw plugin commands (lp-scan, lp-monitor, lp-status)
  scan-once.ts          One-shot scan entrypoint
  monitor-once.ts       One-shot monitor entrypoint
  run-lock.ts           Lock file protection for discrete jobs
  config.ts             Environment config loader
  lp-agent-client.ts    LP Agent API client (typed)
  gecko-client.ts       GeckoTerminal OHLCV client (rate-limited)
  jupiter-client.ts     Jupiter token safety API
  signer.ts             Signing abstraction (OWS + local keypair)
  scanner.ts            Pool discovery + safety filters
  analyzer.ts           Technical indicator computation (BB, RSI, MACD)
  position-manager.ts   Position evaluation and exit decisions
  executor.ts           Zap-in/out execution with retry logic
  state.ts              JSON file persistence
  telegram.ts           Telegram Bot API notifications
test/
  analyzer.test.ts      Exit signal detection tests
  executor.test.ts      Retry logic and failure handling tests
  position-manager.test.ts  Stop-loss and stale data tests
  signer.test.ts        Wallet signing tests
  state.test.ts         State persistence tests
```

## Testing

```bash
yarn build         # Compile TypeScript
yarn test          # Run all tests
yarn test:watch    # Watch mode
```

## OpenClaw plugin packaging notes

This repository now exposes an OpenClaw plugin extension via `package.json`:

- `openclaw.extensions`: `./dist/openclaw-plugin.js`
- manifest file: `openclaw.plugin.json`

After `yarn build`, OpenClaw can load the built extension entry.

## Roadmap

See [TODOS.md](TODOS.md) for planned features.

## License

MIT
