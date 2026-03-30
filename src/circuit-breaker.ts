import type { Config } from "./config.js";
import type { CircuitBreakerState } from "./state.js";

export type BreakerStatus = "allow" | "blocked";

export function defaultCircuitBreakerState(): CircuitBreakerState {
  return {
    state: "closed",
    consecutiveFailures: 0,
    openedAt: null,
  };
}

export function shouldAllowRun(
  breaker: CircuitBreakerState,
  config: Config,
  now: number = Date.now(),
): BreakerStatus {
  if (!config.circuitBreakerEnabled) return "allow";

  if (breaker.state === "closed") return "allow";

  if (breaker.state === "open") {
    const openedAt = breaker.openedAt ?? 0;
    if (now - openedAt >= config.circuitBreakerCooldownMs) {
      breaker.state = "half_open";
      return "allow";
    }
    return "blocked";
  }

  // half_open allows a single probe run; the caller should record success/failure after run.
  return "allow";
}

export function recordSuccess(breaker: CircuitBreakerState, config: Config): void {
  if (!config.circuitBreakerEnabled) return;
  breaker.state = "closed";
  breaker.consecutiveFailures = 0;
  breaker.openedAt = null;
}

export function recordFailure(
  breaker: CircuitBreakerState,
  config: Config,
  now: number = Date.now(),
): { opened: boolean } {
  if (!config.circuitBreakerEnabled) return { opened: false };

  if (breaker.state === "half_open") {
    breaker.state = "open";
    breaker.openedAt = now;
    breaker.consecutiveFailures = config.circuitBreakerFailureThreshold;
    return { opened: true };
  }

  breaker.consecutiveFailures += 1;
  if (breaker.consecutiveFailures >= config.circuitBreakerFailureThreshold) {
    breaker.state = "open";
    breaker.openedAt = now;
    return { opened: true };
  }

  return { opened: false };
}

export function resetCircuitBreaker(breaker: CircuitBreakerState): void {
  breaker.state = "closed";
  breaker.consecutiveFailures = 0;
  breaker.openedAt = null;
}

export function cooldownRemainingMs(
  breaker: CircuitBreakerState,
  config: Config,
  now: number = Date.now(),
): number {
  if (!config.circuitBreakerEnabled || breaker.state !== "open" || !breaker.openedAt) return 0;
  const remaining = config.circuitBreakerCooldownMs - (now - breaker.openedAt);
  return remaining > 0 ? remaining : 0;
}
