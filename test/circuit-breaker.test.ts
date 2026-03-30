import { describe, expect, it } from "vitest";
import {
  cooldownRemainingMs,
  defaultCircuitBreakerState,
  recordFailure,
  recordSuccess,
  shouldAllowRun,
} from "../src/circuit-breaker.js";
import type { Config } from "../src/config.js";

const config = {
  circuitBreakerEnabled: true,
  circuitBreakerFailureThreshold: 3,
  circuitBreakerCooldownMs: 60_000,
} as Config;

describe("circuit-breaker", () => {
  it("opens after consecutive failures", () => {
    const breaker = defaultCircuitBreakerState();

    expect(recordFailure(breaker, config, 1000).opened).toBe(false);
    expect(recordFailure(breaker, config, 2000).opened).toBe(false);
    expect(recordFailure(breaker, config, 3000).opened).toBe(true);

    expect(breaker.state).toBe("open");
    expect(breaker.consecutiveFailures).toBe(3);
    expect(breaker.openedAt).toBe(3000);
  });

  it("blocks while open before cooldown", () => {
    const breaker = defaultCircuitBreakerState();
    breaker.state = "open";
    breaker.openedAt = 1000;

    expect(shouldAllowRun(breaker, config, 59_000)).toBe("blocked");
    expect(cooldownRemainingMs(breaker, config, 59_000)).toBeGreaterThan(0);
  });

  it("transitions to half_open after cooldown and closes on success", () => {
    const breaker = defaultCircuitBreakerState();
    breaker.state = "open";
    breaker.openedAt = 1000;

    expect(shouldAllowRun(breaker, config, 61_500)).toBe("allow");
    expect(breaker.state).toBe("half_open");

    recordSuccess(breaker, config);
    expect(breaker.state).toBe("closed");
    expect(breaker.consecutiveFailures).toBe(0);
    expect(breaker.openedAt).toBeNull();
  });

  it("reopens if half_open probe fails", () => {
    const breaker = defaultCircuitBreakerState();
    breaker.state = "half_open";

    const res = recordFailure(breaker, config, 50_000);
    expect(res.opened).toBe(true);
    expect(breaker.state).toBe("open");
    expect(breaker.openedAt).toBe(50_000);
  });
});
