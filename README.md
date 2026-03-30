# LP Evil Panda

Autonomous Meteora DLMM liquidity provision bot implementing the **Evil Panda** strategy, powered by the [LP Agent API](https://portal.lpagent.io).

## What it does

1. **Scans** for pumping meme coins on Meteora with good volume, safety checks (Jupiter token safety, freeze/mint authority), and organic activity filters
2. **Enters** SOL-sided SPOT DLMM positions with a wide range (-80% to -90%) to earn fees from volatility
3. **Monitors** positions on 15-minute candles using technical indicators (Bollinger Bands, RSI(2), MACD)
4. **Exits** when 2+ confluence signals fire, or after 24h hard stop-loss if out of range with negative P&L
5. **Alerts** via Telegram on entry, exit, errors, and startup

## Architecture

```
Scanner ──→ Executor (zap-in) ──→ Position Manager ──→ Executor (zap-out)
   │              │                       │                    │
   ▼              ▼                       ▼                    ▼
LP Agent API   Signer (OWS/local)   GeckoTerminal       LP Agent API
+ Jupiter      + Jito bundles        15m OHLCV           + Jito bundles
```

**Priority-based polling:**
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

# Run
yarn dev
```

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
- [OpenClaw](https://openclaw.ai/) (optional package manager)

If you already have OpenClaw installed, install OWS with:

```bash
openclaw install ows
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
  index.ts              Main loop with priority-based polling
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

## Roadmap

See [TODOS.md](TODOS.md) for planned features.

## License

MIT
