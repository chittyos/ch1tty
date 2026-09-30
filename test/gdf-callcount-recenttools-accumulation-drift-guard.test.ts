/**
 * GDF drift guard: freeze ch1tty/execute callCount accumulation and recentTools ordering.
 *
 * GN froze value types and caps of sessionContext fields (finite integer, cap at 5, > 0
 * after one call, namespace format). GN does NOT assert accumulation semantics:
 *   - callCount increments correctly on each successive call (not stuck after first)
 *   - callCount sums across multiple unique tools (not per-tool count)
 *   - recentTools de-duplicates — same tool called N× appears exactly once (map key)
 *   - recentTools is sorted by frequency — most-called tool precedes less-called tools
 *   - a newly invoked tool appears in recentTools immediately on its first call
 *
 * GDF closes those gaps:
 *
 *   GDF-1  callCount increments: 1 call → 1; 2nd call to same tool → 2
 *   GDF-2  recentTools de-duplicates: same tool called 3× appears exactly once
 *   GDF-3  recentTools sorted by frequency: tool with 2 calls precedes tool with 1 call
 *   GDF-4  callCount spans tools: 2 calls to A + 1 call to B → callCount=3
 *   GDF-5  new tool appears in recentTools immediately on its first execute call
 *
 * Source: dist/coordinator.js getToolPatterns — patterns sorted by count desc;
 *         callCount = patterns.reduce((sum, p) => sum + p.count, 0).
 *
 * Frozen 2026-09-27.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (execute path)
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
  return join(tmpdir(), `ch1tty-gdf-${Date.now()}-${++_seq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',  lazy: true },
  { id: 'stripe', name: 'Stripe',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
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

async function execWithSession(
  agg: Aggregator,
  tool: string,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/execute', { tool, sessionId });
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 2,
    `execute with session must append a metadata item (got ${content?.length ?? 0} items)`);
  const meta = content[content.length - 1];
  assert.equal(meta.type, 'text', 'appended metadata item must be type:text');
  assert.ok(typeof meta.text === 'string', 'appended metadata item must have text');
  return JSON.parse(meta.text!) as Record<string, unknown>;
}

function sc(meta: Record<string, unknown>): Record<string, unknown> {
  return meta.sessionContext as Record<string, unknown>;
}

// ── GDF-1: callCount increments per successive call ───────────────────────────

test('GDF-1: callCount increments by 1 on each successive execute call in the same session', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gdf-s1';
    const meta1 = await execWithSession(agg, 'neon/list_projects', sid);
    const cc1 = sc(meta1).callCount as number;
    assert.equal(cc1, 1,
      `GDF-1: callCount must be 1 after the first call; got ${cc1}. ` +
      'GN-5 only checks > 0 — a stuck-at-1 counter would silently pass GN-5.');

    const meta2 = await execWithSession(agg, 'neon/list_projects', sid);
    const cc2 = sc(meta2).callCount as number;
    assert.equal(cc2, 2,
      `GDF-1: callCount must be 2 after the second call to same tool; got ${cc2}. ` +
      'Each onToolCall increments the pattern count; callCount = sum of all pattern counts.');
  } finally {
    await agg.shutdown();
  }
});

// ── GDF-2: recentTools de-duplicates same tool ────────────────────────────────

test('GDF-2: recentTools de-duplicates — same tool called 3× appears exactly once in recentTools', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gdf-s2';
    let meta: Record<string, unknown> = {};
    for (let i = 0; i < 3; i++) {
      meta = await execWithSession(agg, 'neon/list_projects', sid);
    }
    const rt = sc(meta).recentTools as string[];
    assert.ok(Array.isArray(rt), 'GDF-2: recentTools must be an array');
    const occurrences = rt.filter((t) => t === 'neon/list_projects').length;
    assert.equal(occurrences, 1,
      `GDF-2: "neon/list_projects" must appear exactly once in recentTools after 3 calls; ` +
      `found ${occurrences} time(s). The coordinator stores tools by name in a Map — ` +
      'repeat calls increment count, they do not add duplicate entries.');
  } finally {
    await agg.shutdown();
  }
});

// ── GDF-3: recentTools sorted by call frequency ───────────────────────────────

test('GDF-3: recentTools sorted by frequency — tool with 2 calls precedes tool with 1 call', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gdf-s3';
    // stripe inserted first (count=1), neon second (count=2), tasks last (count=1).
    // Insertion order → [stripe, neon, tasks]; last-call order → [tasks, neon, stripe].
    // Frequency order → [neon, stripe, tasks] — neon must be index 0.
    await execWithSession(agg, 'stripe/list_payments', sid);
    await execWithSession(agg, 'neon/list_projects',   sid);
    await execWithSession(agg, 'neon/list_projects',   sid);
    const meta = await execWithSession(agg, 'tasks/list_tasks', sid);
    const rt = sc(meta).recentTools as string[];
    assert.ok(rt.length >= 3, `GDF-3: recentTools must have ≥ 3 entries; got ${rt.length}`);
    const neonIdx   = rt.indexOf('neon/list_projects');
    const stripeIdx = rt.indexOf('stripe/list_payments');
    assert.ok(neonIdx   >= 0, 'GDF-3: neon/list_projects must be in recentTools');
    assert.ok(stripeIdx >= 0, 'GDF-3: stripe/list_payments must be in recentTools');
    assert.equal(neonIdx, 0,
      `GDF-3: neon/list_projects (count=2) must be at index 0 in recentTools; got ${neonIdx}. ` +
      'Insertion order would put stripe first; last-call order would put tasks first. ' +
      'Only frequency-desc order places neon (highest count) first.');
  } finally {
    await agg.shutdown();
  }
});

// ── GDF-4: callCount is sum across all unique tools ───────────────────────────

test('GDF-4: callCount sums all tool counts — 2 calls to neon + 1 call to stripe → callCount=3', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gdf-s4';
    await execWithSession(agg, 'neon/list_projects',   sid);
    await execWithSession(agg, 'neon/list_projects',   sid);
    const meta = await execWithSession(agg, 'stripe/list_payments', sid);
    const cc = sc(meta).callCount as number;
    assert.equal(cc, 3,
      `GDF-4: callCount must be 3 (2 neon/list_projects + 1 stripe/list_payments); got ${cc}. ` +
      'callCount = patterns.reduce((sum, p) => sum + p.count, 0) — it is the total call count ' +
      'across all unique tools, not the count for the most recent tool only.');
  } finally {
    await agg.shutdown();
  }
});

// ── GDF-5: new tool appears in recentTools on first call ──────────────────────

test('GDF-5: newly invoked tool appears in recentTools immediately on its first execute call', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gdf-s5';
    const meta = await execWithSession(agg, 'tasks/list_tasks', sid);
    const rt = sc(meta).recentTools as string[];
    assert.ok(Array.isArray(rt), 'GDF-5: recentTools must be an array');
    assert.ok(rt.includes('tasks/list_tasks'),
      `GDF-5: "tasks/list_tasks" must appear in recentTools immediately after its first call; ` +
      `got [${rt.join(', ')}]. onToolCall must register the pattern on first invocation.`);
  } finally {
    await agg.shutdown();
  }
});
