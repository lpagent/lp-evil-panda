import { runMonitorOnce } from "./orchestrator.js";

runMonitorOnce().catch((err) => {
  console.error("Monitor run failed:", err);
  process.exit(1);
});
