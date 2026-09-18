/**
 * CS — timer unref?.() optional chaining: workerd/DO runtime branch
 *
 * Covers two `this.<timer>.unref?.()` guards in source files that exist
 * because the workerd/Cloudflare DO runtime returns a plain number from
 * setInterval (no .unref method), while Node.js returns a NodeJS.Timeout
 * with .unref().
 *
 * Branch targets:
 *   - src-stdio/coordinator.ts line ~82: `this.evictTimer.unref?.()`
 *     inside the `if (evictIntervalMs > 0 && sessionTtlMs > 0)` block
 *   - src-stdio/ledger.ts line ~197: `this.flushTimer.unref?.()`
 *     inside `LedgerClient.bind()` after starting the periodic flush timer
 *
 * Strategy: monkey-patch the global `setInterval` to return a plain number
 * (mimicking the workerd runtime), construct the class under test, verify no
 * throw, then restore the original setInterval.  We also verify the
 * complementary true-branch (standard Node timer with .unref) to confirm the
 * positive path is exercised as well.
 */

import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';

// ── Helpers ─────────────────────────────────────────────────────────────────

type GlobalSetInterval = typeof globalThis.setInterval;

/** A minimal fake backend that always succeeds, used only to call bind(). */
function makeFakeBackend() {
  return {
    callTool: async () => ({ isError: false, content: [] }),
    listTools: async () => ({ tools: [] }),
    connect: async () => {},
    disconnect: async () => {},
    isConnected: () => true,
  } as any;
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('CS — timer unref?.() workerd branch', { concurrency: false }, () => {
  let savedSetInterval: GlobalSetInterval;

  before(() => {
    savedSetInterval = globalThis.setInterval;
  });

  after(() => {
    globalThis.setInterval = savedSetInterval;
  });

  // ── LedgerClient.bind — unref?.() when setInterval returns a plain number ──

  it('LedgerClient.bind: does not throw when setInterval returns a plain number (workerd-style)', async () => {
    // Patch setInterval to return a plain number (no .unref method).
    (globalThis as any).setInterval = (..._args: any[]) => 42 as unknown as ReturnType<typeof setInterval>;

    try {
      // Dynamic import so the patched global is seen by the module.
      const { LedgerClient } = await import('../src-stdio/ledger.js');
      const client = new LedgerClient();
      // bind() triggers the setInterval path and calls unref?.() on a plain number.
      assert.doesNotThrow(() => {
        client.bind(makeFakeBackend(), 'test-server-id');
      });
      // Clean up timer.
      client.unbind();
    } finally {
      globalThis.setInterval = savedSetInterval;
    }
  });

  it('LedgerClient.bind: does not throw when setInterval returns a Node.js timer (standard path)', async () => {
    let unrefCalls = 0;
    (globalThis as any).setInterval = (...args: any[]) => {
      const timer = (savedSetInterval as any)(...args);
      const origUnref = (timer as any).unref?.bind(timer);
      if (origUnref) {
        (timer as any).unref = () => { unrefCalls++; return origUnref(); };
      }
      return timer;
    };
    try {
      const { LedgerClient } = await import('../src-stdio/ledger.js');
      const client = new LedgerClient();
      assert.doesNotThrow(() => {
        client.bind(makeFakeBackend(), 'test-server-id');
      });
      assert.equal(unrefCalls, 1, 'unref() must be called exactly once on the Node.js flush timer');
      client.unbind();
    } finally {
      globalThis.setInterval = savedSetInterval;
    }
  });

  // ── SessionCoordinator constructor — unref?.() when setInterval returns a plain number ──

  it('SessionCoordinator: does not throw when setInterval returns a plain number (workerd-style)', async () => {
    (globalThis as any).setInterval = (..._args: any[]) => 99 as unknown as ReturnType<typeof setInterval>;

    // Set env vars so the evict-timer branch is entered.
    const savedTtl = process.env.CH1TTY_SESSION_TTL_MS;
    const savedInterval = process.env.CH1TTY_SESSION_EVICT_INTERVAL_MS;
    process.env.CH1TTY_SESSION_TTL_MS = '3600000';
    process.env.CH1TTY_SESSION_EVICT_INTERVAL_MS = '300000';

    try {
      const { SessionCoordinator } = await import('../src-stdio/coordinator.js');
      let coordinator: InstanceType<typeof SessionCoordinator> | undefined;
      assert.doesNotThrow(() => {
        coordinator = new SessionCoordinator();
      });
      // Clean up — shutdown stops the flush timer inside the ledger.
      await coordinator?.ledger.shutdown();
    } finally {
      globalThis.setInterval = savedSetInterval;
      if (savedTtl === undefined) delete process.env.CH1TTY_SESSION_TTL_MS;
      else process.env.CH1TTY_SESSION_TTL_MS = savedTtl;
      if (savedInterval === undefined) delete process.env.CH1TTY_SESSION_EVICT_INTERVAL_MS;
      else process.env.CH1TTY_SESSION_EVICT_INTERVAL_MS = savedInterval;
    }
  });

  it('SessionCoordinator: evict-timer branch is skipped when TTL is 0', async () => {
    let intervalCalls = 0;
    (globalThis as any).setInterval = (..._args: any[]) => {
      intervalCalls++;
      return 123 as unknown as ReturnType<typeof setInterval>;
    };
    const savedTtl = process.env.CH1TTY_SESSION_TTL_MS;
    process.env.CH1TTY_SESSION_TTL_MS = '0';
    try {
      const { SessionCoordinator } = await import('../src-stdio/coordinator.js');
      let coordinator: InstanceType<typeof SessionCoordinator> | undefined;
      assert.doesNotThrow(() => {
        coordinator = new SessionCoordinator();
      });
      assert.equal(intervalCalls, 0, 'setInterval must not be called when TTL is 0');
      await coordinator?.ledger.shutdown();
    } finally {
      globalThis.setInterval = savedSetInterval;
      if (savedTtl === undefined) delete process.env.CH1TTY_SESSION_TTL_MS;
      else process.env.CH1TTY_SESSION_TTL_MS = savedTtl;
    }
  });
});
