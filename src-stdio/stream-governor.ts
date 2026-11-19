import { log } from './logger.js';

/**
 * Throttles how fast a remote backend's standalone event stream is reopened.
 *
 * Why this exists. After the initialize handshake, the MCP SDK's
 * StreamableHTTPClientTransport opens a GET event stream to listen for
 * server-initiated messages. When that stream ends cleanly, SDK 1.29.0 reopens
 * it and restarts its attempt counter at zero every time, so `maxRetries` never
 * applies and the delay never grows: it is the server's `retry:` value if one
 * was sent, otherwise a flat one second. A backend that answers the GET with
 * 200 and closes straight away therefore gets reopened forever, at whatever
 * rate the round trip allows.
 *
 * Measured 2026-11-19: one ch1tty process sent about 6.8 GET /mcp per second
 * (roughly 590,000 requests a day) to a single backend this way, authenticated
 * each time, and was intermittently rate-limited as a result.
 *
 * What it does. It wraps the transport's `fetch`. Requests that are not a
 * stream open pass straight through. A stream open that follows a short-lived
 * stream is delayed, with the delay doubling up to a ceiling. A stream that
 * stays up long enough resets the delay to zero, so a healthy backend never
 * waits. Only the stream is delayed; tool calls use POST and are never held.
 */

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export interface StreamGovernorOptions {
  /** A stream that ends sooner than this counts as short-lived. Default 30s. */
  minHealthyLifetimeMs?: number;
  /** Delay before the first throttled reopen. Default 1s. */
  initialDelayMs?: number;
  /** Ceiling for the delay. Default 60s. */
  maxDelayMs?: number;
  /** Multiplier applied per consecutive short-lived stream. Default 2. */
  growFactor?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
}

const DEFAULTS = {
  minHealthyLifetimeMs: 30_000,
  initialDelayMs: 1_000,
  maxDelayMs: 60_000,
  growFactor: 2,
};

/** Resolves after `ms`, or rejects as soon as `signal` aborts. */
export function abortableSleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, ms));
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function isStreamOpen(init?: RequestInit): boolean {
  return (init?.method ?? 'GET').toUpperCase() === 'GET';
}

export class StreamGovernor {
  private readonly minHealthyLifetimeMs: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly growFactor: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal | null) => Promise<void>;

  private lastOpenAt: number | undefined;
  private shortStreak = 0;

  constructor(
    private readonly serverId: string,
    options: StreamGovernorOptions = {},
  ) {
    this.minHealthyLifetimeMs = options.minHealthyLifetimeMs ?? DEFAULTS.minHealthyLifetimeMs;
    this.initialDelayMs = options.initialDelayMs ?? DEFAULTS.initialDelayMs;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
    this.growFactor = options.growFactor ?? DEFAULTS.growFactor;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? abortableSleep;
  }

  /**
   * The delay to apply before the stream open that is about to happen.
   * Advances the short-lived-stream count, so call it once per open.
   */
  nextDelayMs(): number {
    const sinceLastOpen = this.lastOpenAt === undefined ? undefined : this.now() - this.lastOpenAt;
    const previousWasShort = sinceLastOpen !== undefined && sinceLastOpen < this.minHealthyLifetimeMs;

    if (!previousWasShort) {
      if (this.shortStreak > 0) {
        log.info(`Event stream stayed up; reopen throttle cleared`, this.serverId);
      }
      this.shortStreak = 0;
      return 0;
    }

    this.shortStreak += 1;
    if (this.shortStreak === 1) {
      log.warn(
        `Event stream ended after ${sinceLastOpen}ms; throttling reopen attempts (max ${this.maxDelayMs}ms)`,
        this.serverId,
      );
    }
    return Math.min(this.initialDelayMs * this.growFactor ** (this.shortStreak - 1), this.maxDelayMs);
  }

  /** Consecutive short-lived streams seen so far. Exposed for status and tests. */
  get consecutiveShortStreams(): number {
    return this.shortStreak;
  }

  /** A `fetch` that delays stream opens as described above and passes everything else through. */
  wrap(baseFetch: FetchLike = fetch): FetchLike {
    return async (url, init) => {
      if (!isStreamOpen(init)) return baseFetch(url, init);

      const delay = this.nextDelayMs();
      if (delay > 0) await this.sleep(delay, init?.signal);
      this.lastOpenAt = this.now();
      return baseFetch(url, init);
    };
  }
}
