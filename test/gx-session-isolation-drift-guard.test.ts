/**
 * GX drift guard: freeze session isolation — two distinct sessionIds must maintain
 * completely independent state (callCount, recentTools).
 *
 * GDS froze per-session callCount and recentTools accumulation for a single session.
 * Neither GDS nor any prior test verifies that session A's state is unaffected by
 * session B's activity in the same Aggregator instance.
 *
 * Source: handleExecute → coordinator.onToolCall / getToolPatterns
 *         handleSearch  → coordinator.getToolPatterns (read-only; does NOT call onToolCall)
 *         src-stdio/aggregator.ts ~lines 595–625, 658–664
 *         src-stdio/coordinator.ts (onToolCall, getToolPatterns, per-sessionId maps)
 *
 * Invariants frozen:
 *
 *   GX-1  An unused sessionId (B) shows callCount 0 and recentTools [] via search even
 *         after session A has made multiple execute calls (no cross-session bleed at rest).
 *
 *   GX-2  Session A's callCount equals exactly the count of A's own execute calls,
 *         unaffected by the number of execute calls made with session B.
 *
 *   GX-3  Session A's recentTools contains only tools called via session A —
 *         tools called exclusively with session B do not appear in A's recentTools.
 *
 *   GX-4  Session B's recentTools contains only tools called via session B —
 *         tools called exclusively with session A do not appear in B's recentTools.
 *
 *   GX-5  After interleaved calls across two sessions (3 for A, 2 for B using distinct
 *         tools), both sessions report exactly their own call count and tool lists.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (execute/search paths, not explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;

function makeAgg(): { agg: Aggregator; neonTool: string; stripeTool: string } {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);

  const dlq = join(tmpdir(), `ch1tty-gx-${Date.now()}-${++_seq}.jsonl`);
  const agg = new Aggregator(
    [
      {
        id: 'neon',
        name: 'Neon',
        type: 'remote',
        access: 'readwrite',
        category: 'code',
        endpoint: 'https://neon.tech/mcp',
        lazy: true,
      } as ServerConfig,
      {
        id: 'stripe',
        name: 'Stripe',
        type: 'remote',
        access: 'readwrite',
        category: 'ecosystem',
        endpoint: 'https://stripe.com/mcp',
        lazy: true,
      } as ServerConfig,
    ],
    { backendFactory: () => backend, embedEnabled: false, ledgerDlqPath: dlq },
  );

  const neonTool = `neon/${FIXTURE_SERVERS.neon.tools[0].name}`;
  const stripeTool = `stripe/${FIXTURE_SERVERS.stripe.tools[0].name}`;
  return { agg, neonTool, stripeTool };
}

/** Call ch1tty/execute live and return the parsed session metadata. */
async function execAndGetMeta(
  agg: Aggregator,
  tool: string,
  sessionId: string,
): Promise<{ callCount: number; recentTools: string[] }> {
  const result = await agg.callTool('ch1tty/execute', { tool, sessionId });
  assert.equal(result.isError, undefined, `execute must not error for tool ${tool}`);
  const lastItem = result.content[result.content.length - 1];
  assert.ok(lastItem?.text, `last content item must have text (tool ${tool})`);
  const meta = JSON.parse(lastItem.text) as { sessionContext: { recentTools: string[]; callCount: number } };
  return meta.sessionContext;
}

/** Call ch1tty/search with a sessionId and return the sessionContext (read-only; does not call onToolCall). */
async function searchAndGetCtx(
  agg: Aggregator,
  sessionId: string,
): Promise<{ callCount: number; recentTools: string[] }> {
  const result = await agg.callTool('ch1tty/search', { query: 'test', sessionId });
  assert.equal(result.isError, undefined, `search must not error`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  const sc = body.sessionContext as { recentTools: string[]; callCount: number } | undefined;
  assert.ok(sc !== undefined, 'search must return sessionContext when sessionId is active');
  return sc;
}

// ── GX-1: unused session shows empty state via search ─────────────────────────

test('GX-1: unused session B has callCount 0 and empty recentTools even after session A made 3 execute calls', async () => {
  const { agg, neonTool } = makeAgg();
  try {
    const sidA = 'gx-1-session-A';
    const sidB = 'gx-1-session-B';

    // Make 3 calls with session A
    await execAndGetMeta(agg, neonTool, sidA);
    await execAndGetMeta(agg, neonTool, sidA);
    await execAndGetMeta(agg, neonTool, sidA);

    // Session B has never been used — read its state via search (non-mutating)
    const ctxB = await searchAndGetCtx(agg, sidB);

    assert.equal(
      ctxB.callCount,
      0,
      `GX-1: session B callCount must be 0 when it has never called execute; got ${ctxB.callCount}`,
    );
    assert.deepEqual(
      ctxB.recentTools,
      [],
      `GX-1: session B recentTools must be empty when it has never called execute; got ${JSON.stringify(ctxB.recentTools)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GX-2: session A's callCount is unaffected by session B's calls ────────────

test('GX-2: session A callCount equals exactly A\'s own execute calls, unaffected by session B', async () => {
  const { agg, neonTool, stripeTool } = makeAgg();
  try {
    const sidA = 'gx-2-session-A';
    const sidB = 'gx-2-session-B';

    // 2 calls with session A
    await execAndGetMeta(agg, neonTool, sidA);
    await execAndGetMeta(agg, neonTool, sidA);

    // 5 calls with session B
    await execAndGetMeta(agg, stripeTool, sidB);
    await execAndGetMeta(agg, stripeTool, sidB);
    await execAndGetMeta(agg, stripeTool, sidB);
    await execAndGetMeta(agg, stripeTool, sidB);
    await execAndGetMeta(agg, stripeTool, sidB);

    // Session A's callCount should be 2, not 2+5=7
    const ctxA = await searchAndGetCtx(agg, sidA);
    assert.equal(
      ctxA.callCount,
      2,
      `GX-2: session A callCount must be 2 (its own calls only), got ${ctxA.callCount} — bleed from B's 5 calls would produce 7`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GX-3: session A's recentTools does not contain tools called only by session B ──

test('GX-3: session A recentTools does not include tools called exclusively by session B', async () => {
  const { agg, neonTool, stripeTool } = makeAgg();
  try {
    const sidA = 'gx-3-session-A';
    const sidB = 'gx-3-session-B';

    // Session A only calls neon tool
    await execAndGetMeta(agg, neonTool, sidA);

    // Session B only calls stripe tool
    await execAndGetMeta(agg, stripeTool, sidB);

    // A's recentTools should include neon tool but NOT stripe tool
    const ctxA = await searchAndGetCtx(agg, sidA);
    assert.ok(
      ctxA.recentTools.includes(neonTool),
      `GX-3: session A recentTools must include "${neonTool}"; got ${JSON.stringify(ctxA.recentTools)}`,
    );
    assert.ok(
      !ctxA.recentTools.includes(stripeTool),
      `GX-3: session A recentTools must NOT include "${stripeTool}" (B's tool); got ${JSON.stringify(ctxA.recentTools)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GX-4: session B's recentTools does not contain tools called only by session A ──

test('GX-4: session B recentTools does not include tools called exclusively by session A', async () => {
  const { agg, neonTool, stripeTool } = makeAgg();
  try {
    const sidA = 'gx-4-session-A';
    const sidB = 'gx-4-session-B';

    // Session A calls neon tool 3 times (high frequency)
    await execAndGetMeta(agg, neonTool, sidA);
    await execAndGetMeta(agg, neonTool, sidA);
    await execAndGetMeta(agg, neonTool, sidA);

    // Session B only calls stripe tool once
    const ctxB = await execAndGetMeta(agg, stripeTool, sidB);

    assert.ok(
      ctxB.recentTools.includes(stripeTool),
      `GX-4: session B recentTools must include "${stripeTool}"; got ${JSON.stringify(ctxB.recentTools)}`,
    );
    assert.ok(
      !ctxB.recentTools.includes(neonTool),
      `GX-4: session B recentTools must NOT include "${neonTool}" (A's tool, called 3x by A); got ${JSON.stringify(ctxB.recentTools)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GX-5: interleaved calls — both sessions accumulate only their own state ────

test('GX-5: interleaved calls — after 3 A-calls and 2 B-calls each session reports its own state exactly', async () => {
  const { agg, neonTool, stripeTool } = makeAgg();
  try {
    const sidA = 'gx-5-session-A';
    const sidB = 'gx-5-session-B';

    // Interleave calls across both sessions
    await execAndGetMeta(agg, neonTool, sidA);   // A: 1
    await execAndGetMeta(agg, stripeTool, sidB); // B: 1
    await execAndGetMeta(agg, neonTool, sidA);   // A: 2
    await execAndGetMeta(agg, stripeTool, sidB); // B: 2
    await execAndGetMeta(agg, neonTool, sidA);   // A: 3

    const ctxA = await searchAndGetCtx(agg, sidA);
    const ctxB = await searchAndGetCtx(agg, sidB);

    // callCounts are independent
    assert.equal(ctxA.callCount, 3,
      `GX-5: session A callCount must be 3; got ${ctxA.callCount}`);
    assert.equal(ctxB.callCount, 2,
      `GX-5: session B callCount must be 2; got ${ctxB.callCount}`);

    // recentTools are isolated
    assert.ok(ctxA.recentTools.includes(neonTool),
      `GX-5: session A recentTools must include "${neonTool}"; got ${JSON.stringify(ctxA.recentTools)}`);
    assert.ok(!ctxA.recentTools.includes(stripeTool),
      `GX-5: session A recentTools must NOT include "${stripeTool}"; got ${JSON.stringify(ctxA.recentTools)}`);

    assert.ok(ctxB.recentTools.includes(stripeTool),
      `GX-5: session B recentTools must include "${stripeTool}"; got ${JSON.stringify(ctxB.recentTools)}`);
    assert.ok(!ctxB.recentTools.includes(neonTool),
      `GX-5: session B recentTools must NOT include "${neonTool}"; got ${JSON.stringify(ctxB.recentTools)}`);
  } finally {
    await agg.shutdown();
  }
});
