/**
 * GDS drift guard: freeze `ch1tty/execute` live (non-dryRun) with sessionId —
 * `callCount` increments per call and `recentTools` reflects call frequency.
 *
 * Source: handleMetaTool / handleExecute in src-stdio/aggregator.ts (~line 597–625)
 * and coordinator.onToolCall / getToolPatterns in src-stdio/coordinator.ts (~line 150–241).
 *
 * Key invariants frozen here:
 *
 *   GDS-1  First execute with sessionId → callCount === 1; called tool appears in recentTools
 *   GDS-2  After 3 sequential executes with the same sessionId → callCount === 3
 *   GDS-3  After calling 3 different tools, all 3 appear in recentTools
 *   GDS-4  recentTools is sorted by call frequency (most-called tool first, not call order)
 *   GDS-5  callCount counts total calls, not unique tools — same tool called N times → callCount === N
 *
 * The coordinator accumulates tool call records via onToolCall (called inside handleExecute
 * after the backend responds). getToolPatterns sorts by count descending — so the most-called
 * tool surfaces first in recentTools, regardless of call order. callCount is the reduce-sum
 * of all counts across all tool patterns.
 *
 * Contrast: GDR verified metadata is appended at content[length-1] for multi-item backends.
 * GDS verifies the metadata *values* — callCount and recentTools — are correct across sessions.
 *
 * Frozen 2026-09-28.
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
import type { ServerConfig, ToolCallResult } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
const BASE_SESSION = 'gds-session';

/** Build a fresh Aggregator backed by FixtureBackend with neon + stripe registered. */
function makeAgg(): { agg: Aggregator; backend: FixtureBackend } {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);

  const dlq = join(tmpdir(), `ch1tty-gds-${Date.now()}-${++_seq}.jsonl`);
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
  return { agg, backend };
}

/** Call ch1tty/execute live and return the parsed last-item metadata. */
async function execAndGetMeta(
  agg: Aggregator,
  tool: string,
  sessionId: string,
): Promise<{ latencyMs: number; sessionContext: { recentTools: string[]; callCount: number } }> {
  const result = (await agg.callTool('ch1tty/execute', { tool, sessionId })) as {
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
  };
  assert.equal(result.isError, undefined, `execute must not return isError for tool ${tool}`);
  const lastItem = result.content[result.content.length - 1];
  assert.ok(lastItem?.text, `last content item must have text (tool ${tool})`);
  return JSON.parse(lastItem.text) as {
    latencyMs: number;
    sessionContext: { recentTools: string[]; callCount: number };
  };
}

// ── GDS-1: first execute → callCount === 1, called tool in recentTools ────────

test('GDS-1: first execute with sessionId → callCount is 1 and called tool appears in recentTools', async () => {
  const { agg } = makeAgg();
  try {
    const sid = `${BASE_SESSION}-1`;
    const meta = await execAndGetMeta(agg, 'neon/list_projects', sid);

    assert.equal(
      meta.sessionContext.callCount,
      1,
      `GDS-1: callCount must be 1 after the first execute; got ${meta.sessionContext.callCount}`,
    );
    assert.ok(
      meta.sessionContext.recentTools.includes('neon/list_projects'),
      `GDS-1: recentTools must include "neon/list_projects"; got ${JSON.stringify(meta.sessionContext.recentTools)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDS-2: 3 sequential executes with same sessionId → callCount === 3 ────────

test('GDS-2: three sequential executes with the same sessionId → callCount increments to 3', async () => {
  const { agg } = makeAgg();
  try {
    const sid = `${BASE_SESSION}-2`;

    const meta1 = await execAndGetMeta(agg, 'neon/list_projects', sid);
    assert.equal(meta1.sessionContext.callCount, 1, 'GDS-2: callCount must be 1 after first call');

    const meta2 = await execAndGetMeta(agg, 'neon/list_projects', sid);
    assert.equal(meta2.sessionContext.callCount, 2, 'GDS-2: callCount must be 2 after second call');

    const meta3 = await execAndGetMeta(agg, 'neon/list_projects', sid);
    assert.equal(meta3.sessionContext.callCount, 3, 'GDS-2: callCount must be 3 after third call');
  } finally {
    await agg.shutdown();
  }
});

// ── GDS-3: 3 different tools called → all 3 appear in recentTools ─────────────

test('GDS-3: after calling 3 distinct tools with same sessionId → all 3 appear in recentTools', async () => {
  const { agg } = makeAgg();
  try {
    const sid = `${BASE_SESSION}-3`;

    // Identify three tools available across neon and stripe fixtures
    const neonTools = FIXTURE_SERVERS.neon.tools;
    const stripeTools = FIXTURE_SERVERS.stripe.tools;
    const tool1 = `neon/${neonTools[0].name}`;
    const tool2 = `neon/${neonTools[1].name}`;
    const tool3 = `stripe/${stripeTools[0].name}`;

    await execAndGetMeta(agg, tool1, sid);
    await execAndGetMeta(agg, tool2, sid);
    const meta = await execAndGetMeta(agg, tool3, sid);

    assert.equal(
      meta.sessionContext.callCount,
      3,
      `GDS-3: callCount must be 3 after 3 distinct calls; got ${meta.sessionContext.callCount}`,
    );

    const rt = meta.sessionContext.recentTools;
    assert.ok(rt.includes(tool1), `GDS-3: recentTools must include ${tool1}; got ${JSON.stringify(rt)}`);
    assert.ok(rt.includes(tool2), `GDS-3: recentTools must include ${tool2}; got ${JSON.stringify(rt)}`);
    assert.ok(rt.includes(tool3), `GDS-3: recentTools must include ${tool3}; got ${JSON.stringify(rt)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GDS-4: most-called tool first in recentTools (sorted by frequency, not order) ──

test('GDS-4: recentTools is sorted by call frequency — most-called tool appears first', async () => {
  const { agg } = makeAgg();
  try {
    const sid = `${BASE_SESSION}-4`;

    const neonTools = FIXTURE_SERVERS.neon.tools;
    const stripeTools = FIXTURE_SERVERS.stripe.tools;
    const toolFrequent = `neon/${neonTools[0].name}`;
    const toolRare = `stripe/${stripeTools[0].name}`;

    // Call toolFrequent 3 times, toolRare 1 time
    await execAndGetMeta(agg, toolFrequent, sid);
    await execAndGetMeta(agg, toolFrequent, sid);
    await execAndGetMeta(agg, toolRare, sid);
    const meta = await execAndGetMeta(agg, toolFrequent, sid);

    // Total = 4 calls; toolFrequent called 3x, toolRare called 1x
    assert.equal(meta.sessionContext.callCount, 4, `GDS-4: callCount must be 4; got ${meta.sessionContext.callCount}`);

    const rt = meta.sessionContext.recentTools;
    assert.ok(rt.length >= 2, `GDS-4: recentTools must have at least 2 entries; got ${rt.length}`);
    assert.equal(
      rt[0],
      toolFrequent,
      `GDS-4: recentTools[0] must be the most-called tool (${toolFrequent}), not ${rt[0]}. ` +
        'getToolPatterns sorts by count descending — higher-count tool must appear first.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDS-5: callCount counts total calls, not unique tools ────────────────────

test('GDS-5: callCount counts total tool calls, not unique tools — same tool called 5 times → callCount === 5', async () => {
  const { agg } = makeAgg();
  try {
    const sid = `${BASE_SESSION}-5`;
    const tool = `neon/${FIXTURE_SERVERS.neon.tools[0].name}`;

    // Call the SAME tool 5 times
    for (let i = 1; i <= 5; i++) {
      const meta = await execAndGetMeta(agg, tool, sid);
      assert.equal(
        meta.sessionContext.callCount,
        i,
        `GDS-5: after ${i} calls to the same tool, callCount must be ${i}; got ${meta.sessionContext.callCount}`,
      );
    }

    // recentTools should contain exactly one entry (the one repeated tool)
    const metaFinal = await execAndGetMeta(agg, tool, sid);
    assert.equal(
      metaFinal.sessionContext.recentTools.length,
      1,
      `GDS-5: only one unique tool was called, so recentTools must have length 1; ` +
        `got ${metaFinal.sessionContext.recentTools.length}`,
    );
    assert.equal(
      metaFinal.sessionContext.recentTools[0],
      tool,
      `GDS-5: the single entry in recentTools must be ${tool}; got ${metaFinal.sessionContext.recentTools[0]}`,
    );
  } finally {
    await agg.shutdown();
  }
});
