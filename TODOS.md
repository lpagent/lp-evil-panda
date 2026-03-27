# TODOS

## Web Dashboard for P&L Visualization
**Priority:** Medium
**What:** Simple web UI showing open positions, P&L chart, fee earnings over time, and bot activity log.
**Why:** Terminal output + Telegram alerts work for running the bot, but a visual dashboard makes the demo far more compelling and helps users understand their portfolio at a glance.
**Pros:** Great showcase for LP Agent API data endpoints (positions, revenue, overview). Visual P&L tracking builds confidence.
**Cons:** Adds web framework dependency (Express + static HTML or lightweight React). Significant extra scope beyond the core bot.
**Context:** The core bot logs P&L to state.json and sends Telegram alerts. The dashboard would read the same state file + call LP Agent API directly for real-time position data. Could be a simple Express server serving static HTML with fetch calls to LP Agent API.
**Depends on:** Core bot with state persistence working. LP Agent API key available in config.
**Blocked by:** Nothing — can be built independently after core bot ships.
