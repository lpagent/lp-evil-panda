import { runStandaloneLoop } from "./orchestrator.js";

runStandaloneLoop().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
