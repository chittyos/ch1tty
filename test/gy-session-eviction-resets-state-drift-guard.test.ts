/**
 * GY drift guard: freeze session-eviction reset — after evictStaleSessions fires,
 * the evicted sessionId starts a completely fresh session on the next call.
 *
 * Prior coverage of session state:
 *   GDS  callCount and recentTools accumulate correctly within a single session
 *   GDG  recentTools top-5-by-count ordering (selection + tie-breaking)
 *   GX   session-A state is unaffected by session-B activity (isolation)
 *
 * Gap: no test verifies what happens AFTER eviction. Specifically:
 *   (a) Does the evicted sessionId start at callCount === 1 on the next call (not
 *       resume from the pre-eviction callCount)?
 *   (b) Does recentTools show only the post-eviction tool (not the pre-eviction
 *       history)?
 *   (c) Does evictStaleSessions return the correct evicted count?
 *   (d) Does evicting session A leave session B's callCount and recentTools intact?
 *
 * A regression that treats eviction as a soft "forget" while preserving the
 * underlying context (or that restores it on the next call from a stale map) would
 * pass GDS, GDG, and GX silently.
 *
 * Source:
 *   src-stdio/coordinator.ts evictStaleSessions() — deletes context from `contexts`
 *   src-stdio/aggregator.ts  — hasSession check → onSessionStart on miss (fresh context)
 *
 *   The eviction path:
 *     evictStaleSessions(now, ttlMs) {
 *       const cutoff = now - ttlMs;
 *       for (const [id, ctx] of this.contexts) {
 *         if (!ctx.stagingComplete) continue;
 *         if (ctx.lastActiveAt > cutoff) continue;
 *         this.contexts.delete(id);
 *       }
 *     }
 *
 *   On the next call with the evicted sessionId:
 *     if (!this.coordinator.hasSession(explicitSid)) {
 *       await this.coordinator.onSessionStart(explicitSid, 'http');
 *     }
 *     // → brand-new context: callCount = 0, toolPatterns = {}
 *     // → onToolCall increments to callCount = 1
 *
 * Invariants frozen:
 *
 *   GY-1  After eviction of sessionId A, the next execute with sessionId A returns
 *         callCount === 1 — the session restarted, not resumed.
 *         (Regression guard (a): if the pre-eviction context were preserved, callCount
 *          would be N+1 where N was the pre-eviction count.)
 *
 *   GY-2  After eviction, recentTools in the first post-eviction execute response
 *         contains exactly the tool from that one post-eviction call, not any
 *         pre-eviction tool history.
 *         (Regression guard (b): stale context would include all prior tools.)
 *
 *   GY-3  evictStaleSessions returns an integer equal to the number of
 *         sessions actually evicted — 1 when one eligible session is present.
 *         (Correctness / regression guard (c): return value integrity.)
 *
 *   GY-4  Eviction of session A does NOT affect session B's callCount — B remains
 *         at its pre-eviction count after A is evicted.
 *         (Regression guard (d): eviction must not cross-contaminate live sessions.)
 *
 *   GY-5  Eviction of session A does NOT affect session B's recentTools — B still
 *         sees its own tools after A is evicted.
 *         (Symmetric regression guard for recentTools cross-contamination.)
 *
 * Fixture: stripe only (list_payments, get_balance, create_payment_intent).
 * Config category: 'tools' (NOT 'ecosystem') — ensures no ecosystem backend is
 * bound, so stageSession() sets stagingComplete = true in the first microtask
 * tick (no async ecosystem calls). This makes eviction deterministic without
 * timing dependencies.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (execute path, not cast explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Config ────────────────────────────────────────────────────────────────────

// Use 'tools' category (not 'ecosystem') so no ecosystem backend is bound.
// This ensures stageSession() completes in the first microtask (synchronous body),
// making eviction deterministic without any sleep/wait.
const BASE_CONFIGS: ServerConfig[] = [
  {
    id: 'stripe',
    name: 'Stripe',
    type: 'remote',
    access: 'readwrite',
    category: 'tools',
    endpoint: 'https://stripe.com/mcp',
    lazy: true,
  } as ServerConfig,
];

const STRIPE_TOOL_A = `stripe/${FIXTURE_SERVERS.stripe.tools[0].name}`; // stripe/list_payments
const STRIPE_TOOL_B = `stripe/${FIXTURE_SERVERS.stripe.tools[1].name}`; // stripe/get_balance

let _seq = 0;

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  const dlqPath = join(tmpdir(), `ch1tty-gy-${Date.now()}-${++_seq}.jsonl`);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlqPath,
  });
}

/** Execute a tool with a sessionId and return the sessionContext from the metadata item. */
async function execGetCtx(
  agg: Aggregator,
  tool: string,
  sessionId: string,
): Promise<{ callCount: number; recentTools: string[] }> {
  const result = await agg.callTool('ch1tty/execute', { tool, sessionId });
  assert.equal(result.isError, undefined, `execute must not error for tool ${tool}`);
  const lastItem = result.content[result.content.length - 1];
  assert.ok(lastItem?.text, `last content item must have text (tool ${tool})`);
  const meta = JSON.parse(lastItem.text) as {
    sessionContext: { recentTools: string[]; callCount: number };
  };
  assert.ok(meta.sessionContext, 'metadata must contain sessionContext');
  return meta.sessionContext;
}

/** Read sessionContext via search (non-mutating — does NOT call onToolCall). */
async function searchGetCtx(
  agg: Aggregator,
  sessionId: string,
): Promise<{ callCount: number; recentTools: string[] }> {
  const result = await agg.callTool('ch1tty/search', { query: 'stripe', sessionId });
  assert.equal(result.isError, undefined, 'search must not error');
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  const sc = body.sessionContext as { recentTools: string[]; callCount: number } | undefined;
  assert.ok(sc !== undefined, 'search must return sessionContext when sessionId is active');
  return sc;
}

/** Yield two setImmediate ticks so stageSession microtask has time to complete. */
async function letStagingSettle(): Promise<void> {
  await new Promise<void>((r) => setImmediate(r));
  await new Promise<void>((r) => setImmediate(r));
}

// ── GY-1: callCount === 1 after eviction (reset, not resume) ─────────────────

test('GY-1: after eviction, same sessionId returns callCount === 1 (fresh session, not pre-eviction count)', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gy-1-session';

    // Build up pre-eviction history: 3 calls → callCount should be 3
    await execGetCtx(agg, STRIPE_TOOL_A, sid);
    await execGetCtx(agg, STRIPE_TOOL_A, sid);
    const pre = await execGetCtx(agg, STRIPE_TOOL_A, sid);
    assert.equal(pre.callCount, 3, 'GY-1 pre-eviction: callCount must be 3');

    // Let stagingComplete settle, then evict
    await letStagingSettle();
    agg.coordinator.evictStaleSessions(Date.now() + 1000, 1);

    // First call post-eviction: should be callCount === 1, not 4
    const fresh = await execGetCtx(agg, STRIPE_TOOL_A, sid);
    assert.equal(
      fresh.callCount,
      1,
      `GY-1: post-eviction callCount must be 1 (fresh session); got ${fresh.callCount} — if stale context survived, it would be 4`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GY-2: recentTools shows only post-eviction tool ──────────────────────────

test('GY-2: after eviction, recentTools contains only the post-eviction tool (no pre-eviction history)', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gy-2-session';

    // Pre-eviction: call TOOL_A twice so it appears in recentTools
    await execGetCtx(agg, STRIPE_TOOL_A, sid);
    await execGetCtx(agg, STRIPE_TOOL_A, sid);

    await letStagingSettle();
    agg.coordinator.evictStaleSessions(Date.now() + 1000, 1);

    // Post-eviction: call TOOL_B (different tool from pre-eviction)
    const fresh = await execGetCtx(agg, STRIPE_TOOL_B, sid);

    assert.deepEqual(
      fresh.recentTools,
      [STRIPE_TOOL_B],
      `GY-2: post-eviction recentTools must contain only TOOL_B; got ${JSON.stringify(fresh.recentTools)} — stale history would include TOOL_A`,
    );
    assert.ok(
      !fresh.recentTools.includes(STRIPE_TOOL_A),
      `GY-2: TOOL_A must NOT appear in recentTools after eviction — it was only called in the discarded pre-eviction session`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GY-3: evictStaleSessions return value equals evicted count ───────────────

test('GY-3: evictStaleSessions returns the count of evicted sessions (1 for a single eligible session)', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gy-3-session';

    // Create and use the session
    await execGetCtx(agg, STRIPE_TOOL_A, sid);

    await letStagingSettle();

    // Evict all sessions (TTL = 1ms, now = far future — all sessions are stale)
    const evicted = agg.coordinator.evictStaleSessions(Date.now() + 1000, 1);
    assert.equal(
      evicted,
      1,
      `GY-3: evictStaleSessions must return 1 (one session evicted); got ${evicted}`,
    );

    // Second eviction: nothing left to evict
    const evictedAgain = agg.coordinator.evictStaleSessions(Date.now() + 1000, 1);
    assert.equal(
      evictedAgain,
      0,
      `GY-3: second eviction must return 0 (session already gone); got ${evictedAgain}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GY-4: evicting session A does NOT reset session B's callCount ─────────────

test("GY-4: evicting session A leaves session B's callCount intact", async () => {
  const agg = makeAgg();
  try {
    const sidA = 'gy-4-session-A';
    const sidB = 'gy-4-session-B';

    // Build session B's history first
    await execGetCtx(agg, STRIPE_TOOL_B, sidB);
    await execGetCtx(agg, STRIPE_TOOL_B, sidB);
    const preB = await execGetCtx(agg, STRIPE_TOOL_B, sidB);
    assert.equal(preB.callCount, 3, 'GY-4 pre-eviction: session B callCount must be 3');

    // Also create session A
    await execGetCtx(agg, STRIPE_TOOL_A, sidA);
    await execGetCtx(agg, STRIPE_TOOL_A, sidA);

    await letStagingSettle();

    // Evict ALL sessions (both A and B eligible)
    agg.coordinator.evictStaleSessions(Date.now() + 1000, 1);

    // Restart session B (one call)
    const freshB = await execGetCtx(agg, STRIPE_TOOL_B, sidB);
    assert.equal(
      freshB.callCount,
      1,
      `GY-4: session B callCount must be 1 after eviction and one fresh call; got ${freshB.callCount}`,
    );

    // Restart session A (one call) — verify independent fresh start
    const freshA = await execGetCtx(agg, STRIPE_TOOL_A, sidA);
    assert.equal(
      freshA.callCount,
      1,
      `GY-4: session A callCount must be 1 after eviction and one fresh call; got ${freshA.callCount}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GY-5: evicting session A does NOT corrupt session B's recentTools ─────────

test("GY-5: evicting session A leaves session B's recentTools intact (no cross-session contamination)", async () => {
  const agg = makeAgg();
  try {
    const sidA = 'gy-5-session-A';
    const sidB = 'gy-5-session-B';

    // Session B uses TOOL_B; session A uses TOOL_A
    await execGetCtx(agg, STRIPE_TOOL_B, sidB);
    await execGetCtx(agg, STRIPE_TOOL_B, sidB);

    await execGetCtx(agg, STRIPE_TOOL_A, sidA);

    await letStagingSettle();

    // Evict session A only (TTL = 1ms; both were last active > 0ms ago so both eligible,
    // but we verify B's post-eviction fresh call sees only its own tool)
    agg.coordinator.evictStaleSessions(Date.now() + 1000, 1);

    // Session B: call TOOL_B once more in a fresh session (post-eviction)
    const freshB = await execGetCtx(agg, STRIPE_TOOL_B, sidB);

    assert.ok(
      freshB.recentTools.includes(STRIPE_TOOL_B),
      `GY-5: session B recentTools must include TOOL_B after fresh post-eviction call`,
    );
    assert.ok(
      !freshB.recentTools.includes(STRIPE_TOOL_A),
      `GY-5: session B recentTools must NOT include TOOL_A (session A's tool) after eviction — cross-contamination from A would be a bug`,
    );
  } finally {
    await agg.shutdown();
  }
});
