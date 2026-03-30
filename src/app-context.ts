import { loadConfig, type Config } from "./config.js";
import { LpAgentClient } from "./lp-agent-client.js";
import { JupiterClient } from "./jupiter-client.js";
import { GeckoClient } from "./gecko-client.js";
import { createSigner, type Signer } from "./signer.js";
import { Telegram } from "./telegram.js";
import { loadState, type AppState } from "./state.js";

export interface AppContext {
  config: Config;
  lpAgent: LpAgentClient;
  jupiter: JupiterClient;
  gecko: GeckoClient;
  signer: Signer;
  telegram: Telegram;
  state: AppState;
}

export function createAppContext(): AppContext {
  const config = loadConfig();
  return {
    config,
    lpAgent: new LpAgentClient(config),
    jupiter: new JupiterClient(),
    gecko: new GeckoClient(),
    signer: createSigner(config),
    telegram: new Telegram(config),
    state: loadState(),
  };
}
