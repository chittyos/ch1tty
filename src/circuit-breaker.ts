import { log } from './logger.js';

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_COOLDOWN_MS = 30_000; // 30s

interface BreakerState {
  failures: number;
  openUntil: number; // timestamp — 0 means closed (healthy)
}

export class CircuitBreaker {
  private states = new Map<string, BreakerState>();
  private failureThreshold: number;
  private cooldownMs: number;

  constructor(options?: { failureThreshold?: number; cooldownMs?: number }) {
    this.failureThreshold = options?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.cooldownMs = options?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  /** Check if a backend is allowed to proceed. Returns true if healthy or cooldown expired. */
  isAllowed(serverId: string): boolean {
    const state = this.states.get(serverId);
    if (!state || state.openUntil === 0) return true;

    if (Date.now() >= state.openUntil) {
      // Cooldown expired — allow one probe attempt (half-open)
      log.debug(`Circuit half-open, allowing probe`, serverId);
      return true;
    }

    return false;
  }

  /** Record a successful call — resets the breaker to closed. */
  recordSuccess(serverId: string): void {
    const state = this.states.get(serverId);
    if (state && (state.failures > 0 || state.openUntil > 0)) {
      log.info(`Circuit closed (recovered)`, serverId);
      state.failures = 0;
      state.openUntil = 0;
    }
  }

  /** Record a failure — may trip the breaker open. */
  recordFailure(serverId: string): void {
    let state = this.states.get(serverId);
    if (!state) {
      state = { failures: 0, openUntil: 0 };
      this.states.set(serverId, state);
    }

    state.failures++;

    if (state.failures >= this.failureThreshold) {
      state.openUntil = Date.now() + this.cooldownMs;
      log.warn(
        `Circuit open — ${state.failures} consecutive failures, cooldown ${this.cooldownMs}ms`,
        serverId,
      );
    }
  }

  /** Get breaker status for a server (for status endpoint). */
  getState(serverId: string): { failures: number; open: boolean; cooldownRemaining: number } {
    const state = this.states.get(serverId);
    if (!state) return { failures: 0, open: false, cooldownRemaining: 0 };

    const open = state.openUntil > 0 && Date.now() < state.openUntil;
    const cooldownRemaining = open ? state.openUntil - Date.now() : 0;
    return { failures: state.failures, open, cooldownRemaining };
  }

  /** Reset all breakers (e.g. on config reload). */
  reset(): void {
    this.states.clear();
  }
}
