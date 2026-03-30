import { runScanOnce } from "./orchestrator.js";

runScanOnce().catch((err) => {
  console.error("Scan run failed:", err);
  process.exit(1);
});
