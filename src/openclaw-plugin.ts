import { loadState } from "./state.js";
import { runMonitorOnce, runScanOnce } from "./orchestrator.js";
import { runSetupBootstrap } from "./setup.js";

const plugin = {
  id: "lp-evil-panda",
  name: "LP Evil Panda",
  description: "OpenClaw orchestration bridge for LP Evil Panda scan and heartbeat monitor jobs.",
  register(api: any) {
    api.registerCommand({
      name: "lp-scan",
      description: "Run one scan cycle (entry discovery + potential zap-in).",
      acceptsArgs: false,
      handler: async () => {
        await runScanOnce();
        return { text: "✅ LP Evil Panda scan cycle completed." };
      },
    });

    api.registerCommand({
      name: "lp-monitor",
      description: "Run one monitor/heartbeat cycle (position checks + potential exits).",
      acceptsArgs: false,
      handler: async () => {
        await runMonitorOnce();
        return { text: "✅ LP Evil Panda monitor cycle completed." };
      },
    });

    api.registerCommand({
      name: "lp-status",
      description: "Show current tracked strategy state for orchestration checks.",
      acceptsArgs: false,
      handler: async () => {
        const state = loadState();
        const tracked = state.positions.length;
        const seen = Object.keys(state.seenCoins).length;
        return {
          text: `LP Evil Panda state\n- tracked positions: ${tracked}\n- tracked token pumps: ${seen}`,
        };
      },
    });

    const setupHandler = async () => {
      return await runSetupBootstrap();
    };

    api.registerCommand({
      name: "lp-start",
      description: "Guide setup, validate wallet/API readiness, and auto-install OpenWallet if needed.",
      acceptsArgs: false,
      handler: setupHandler,
    });

    api.registerCommand({
      name: "lp-setup",
      description: "Alias for lp-start.",
      acceptsArgs: false,
      handler: setupHandler,
    });
  },
};

export default plugin;
