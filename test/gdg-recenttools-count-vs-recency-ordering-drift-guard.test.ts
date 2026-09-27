/**
 * GDG drift guard: freeze `ch1tty/execute` recentTools top-N-by-count ordering.
 *
 * GN-4 freezes that recentTools is capped at 5 entries. GDG freezes the SELECTION
 * and ORDERING semantics: the 5 entries are the 5 most-frequently-called tools
 * (count-desc), not the 5 most-recently-called tools (recency).
 *
 * Source: src-stdio/coordinator.ts getToolPatterns() sorts `toolPatterns` values by
 *   `b.count - a.count` (count-desc, stable) and slices to limit=5; aggregator uses
 *   `patterns.slice(0, 5).map(p => p.tool)` to build recentTools.
 *
 *   GDG-1  highest-count tool appears at recentTools[0]
 *   GDG-2  count ordering holds across all adjacent pairs (all-distinct counts)
 *   GDG-3  most-recently-called tool is EXCLUDED when 5 higher-count tools fill the cap
 *   GDG-4  calling a tool a 2nd time promotes it above a tool called only once earlier
 *          (count beats insertion/recency)
 *   GDG-5  equal-count tiebreaking preserves first-call (insertion) order — stable sort
 *
 * Frozen 2026-09-27.
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

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gdg-${Date.now()}-${++_seq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',       lazy: true },
  { id: 'stripe', name: 'Stripe',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp',      lazy: true },
  { id: 'tasks',  name: 'Tasks',   type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp', lazy: true },
];

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks',  FIXTURE_SERVERS.tasks);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

/** Execute a tool with a sessionId and return the parsed sessionContext from the appended metadata. */
async function recentToolsFor(
  agg: Aggregator,
  tool: string,
  sessionId: string,
): Promise<string[]> {
  const result = await agg.callTool('ch1tty/execute', { tool, sessionId });
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 2,
    `execute with session must append metadata (got ${content?.length ?? 0} items)`);
  const meta = JSON.parse(content[content.length - 1].text!) as Record<string, unknown>;
  const sc = meta.sessionContext as Record<string, unknown>;
  return sc.recentTools as string[];
}

// ── GDG-1: highest-count tool is at recentTools[0] ───────────────────────────

test('GDG-1: recentTools[0] is the highest-count tool, not the most-recently-called', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gdg-s1';
    // Call neon/list_projects 3× (highest frequency)
    for (let i = 0; i < 3; i++) await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', sessionId: sid });
    // Call stripe and tasks once each (lower frequency, but called after neon)
    await agg.callTool('ch1tty/execute', { tool: 'stripe/list_payments', sessionId: sid });
    const rt = await recentToolsFor(agg, 'tasks/list_tasks', sid);
    assert.equal(
      rt[0], 'neon/list_projects',
      `GDG-1: recentTools[0] must be the highest-count tool 'neon/list_projects' (called 3×), ` +
      `not 'tasks/list_tasks' (most recently called, called 1×). Got: ${rt[0]}. ` +
      'recentTools ordering is count-desc, not recency-desc.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDG-2: count-desc ordering for all adjacent pairs (all-distinct counts) ──

test('GDG-2: recentTools is sorted count-desc for all adjacent pairs (distinct counts)', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gdg-s2';
    // Make all-distinct frequencies: A=4, B=3, C=2, D=1
    const schedule: [string, number][] = [
      ['neon/list_projects',         4],   // A — highest
      ['neon/run_sql',               3],   // B
      ['neon/describe_table_schema', 2],   // C
      ['neon/create_project',        1],   // D — lowest
    ];
    for (const [tool, n] of schedule) {
      for (let i = 0; i < n; i++) await agg.callTool('ch1tty/execute', { tool, sessionId: sid });
    }
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', sessionId: sid });
    const content = (result as { content: Array<{ type: string; text?: string }> }).content;
    const meta = JSON.parse(content[content.length - 1].text!) as Record<string, unknown>;
    const sc = meta.sessionContext as Record<string, unknown>;
    const rt = sc.recentTools as string[];

    assert.ok(rt.length >= 4,
      `GDG-2: expected at least 4 tools in recentTools; got ${rt.length}`);
    // Expected order by count: A(5 after the extra call), B(3), C(2), D(1)
    // Note: A was called 4× in schedule + 1× for the final callTool above = 5×
    const expected = [
      'neon/list_projects',         // 5× (4 + final call)
      'neon/run_sql',               // 3×
      'neon/describe_table_schema', // 2×
      'neon/create_project',        // 1×
    ];
    for (let i = 0; i < expected.length; i++) {
      assert.equal(
        rt[i], expected[i],
        `GDG-2: recentTools[${i}] must be '${expected[i]}' (count-desc order); got '${rt[i]}'. ` +
        `Full recentTools: [${rt.join(', ')}]`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GDG-3: most-recently-called low-count 6th tool is excluded ───────────────

test('GDG-3: most-recently-called tool is absent when 5 higher-count tools fill the cap', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gdg-s3';
    // Fill the top-5 slots with 5 distinct tools, each called 2×
    const top5 = [
      'neon/list_projects',
      'neon/run_sql',
      'neon/describe_table_schema',
      'neon/create_project',
      'stripe/list_payments',
    ];
    for (const tool of top5) {
      for (let i = 0; i < 2; i++) await agg.callTool('ch1tty/execute', { tool, sessionId: sid });
    }
    // Now call a 6th tool once LAST — it is the most recently called, but count=1 < 2
    const lastTool = 'tasks/list_tasks';
    const rt = await recentToolsFor(agg, lastTool, sid);

    assert.ok(!rt.includes(lastTool),
      `GDG-3: '${lastTool}' (most recently called, count=1) must NOT appear in recentTools ` +
      `when 5 other tools each have count=2. Got recentTools: [${rt.join(', ')}]. ` +
      'If recentTools were recency-based, this tool would be at index 0.',
    );
    assert.equal(rt.length, 5,
      `GDG-3: recentTools must be capped at 5; got ${rt.length}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDG-4: repeat call promotes a tool above an earlier-called single-call tool ──

test('GDG-4: a repeat call promotes a tool to recentTools[0] above an earlier single-call tool', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gdg-s4';
    // Call stripe first (inserted first), then neon twice (inserted second, count=2 > 1)
    await agg.callTool('ch1tty/execute', { tool: 'stripe/list_payments',  sessionId: sid });
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects',    sessionId: sid });
    const rt = await recentToolsFor(agg, 'neon/list_projects', sid);
    // After the 3rd call total: stripe(1), neon(2) → sorted by count: neon first
    assert.equal(
      rt[0], 'neon/list_projects',
      `GDG-4: recentTools[0] must be 'neon/list_projects' (count=2 via repeat call) ` +
      `not 'stripe/list_payments' (count=1, called first/earlier). Got: ${rt[0]}. ` +
      'Count ordering must beat insertion/recency order.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDG-5: equal-count tiebreaking preserves insertion (first-call) order ────

test('GDG-5: equal-count tools are ordered by first call (insertion order) as tiebreaker', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gdg-s5';
    // Call A, B, C once each (insertion order: A first) — then again in same order
    // so all have count=2, but A was inserted first, B second, C third
    const tools = [
      'neon/list_projects',   // A — inserted first
      'stripe/list_payments', // B — inserted second
      'tasks/list_tasks',     // C — inserted third
    ];
    // Round 1: insert all in order
    for (const tool of tools) {
      await agg.callTool('ch1tty/execute', { tool, sessionId: sid });
    }
    // Round 2: increment all counts in same order → all count=2
    for (const tool of tools) {
      await agg.callTool('ch1tty/execute', { tool, sessionId: sid });
    }
    const result = await agg.callTool('ch1tty/execute', { tool: tools[0], sessionId: sid });
    const content = (result as { content: Array<{ type: string; text?: string }> }).content;
    const meta = JSON.parse(content[content.length - 1].text!) as Record<string, unknown>;
    const rt = (meta.sessionContext as Record<string, unknown>).recentTools as string[];

    // All 3 tools are present (cap=5 > 3 distinct)
    assert.ok(tools.every(t => rt.includes(t)),
      `GDG-5: all 3 equal-count tools must be present in recentTools; got [${rt.join(', ')}]`,
    );
    // Stable sort preserves insertion order for equal counts
    const idxA = rt.indexOf(tools[0]);
    const idxB = rt.indexOf(tools[1]);
    const idxC = rt.indexOf(tools[2]);
    assert.ok(idxA < idxB,
      `GDG-5: '${tools[0]}' (inserted first, count=3) must precede '${tools[1]}' (inserted second). ` +
      `Got indices: A=${idxA}, B=${idxB}. Stable sort should preserve insertion order for equal counts.`,
    );
    assert.ok(idxB < idxC,
      `GDG-5: '${tools[1]}' (inserted second, count=2) must precede '${tools[2]}' (inserted third). ` +
      `Got indices: B=${idxB}, C=${idxC}.`,
    );
  } finally {
    await agg.shutdown();
  }
});
