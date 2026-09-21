/**
 * GN drift guard: freeze ch1tty/execute session-appended metadata VALUE TYPES.
 *
 * EC froze the session-appended metadata shape:
 *   - top-level key set is exactly {latencyMs, sessionContext}
 *   - sessionContext key set is exactly {recentTools, callCount} (+ optional activeSessionFocus)
 *   - recentTools is an array of strings; callCount is typeof number
 *   - latencyMs is a non-negative number
 *
 * EC does NOT assert the tighter value-type constraints that would catch:
 *   - latencyMs being Infinity or NaN (EC checks >= 0, not isFinite)
 *   - recentTools items being namespaced "serverId/toolName" strings (EC: typeof string)
 *   - callCount being a finite integer (EC: typeof number — float or Infinity would pass)
 *   - recentTools.length being capped at 5 (aggregator slices to 5; no prior test freezes)
 *   - callCount advancing past 0 after actual calls (EC only checks typeof)
 *   - activeSessionFocus, when present, being a non-empty string
 *
 * GN closes those gaps:
 *
 *   GN-1  latencyMs is a finite non-NaN number (not Infinity, not NaN)
 *   GN-2  sessionContext.recentTools items each contain exactly one '/'
 *          (namespaced "serverId/toolName" format, not bare tool names)
 *   GN-3  sessionContext.callCount is a finite non-negative integer
 *          (Number.isInteger; not a float; not Infinity)
 *   GN-4  sessionContext.recentTools.length does not exceed 5 even after >5 distinct calls
 *          (aggregator caps recentTools to last 5 patterns)
 *   GN-5  sessionContext.callCount is > 0 after at least one successful call
 *          (counter is not stuck at zero after real tool executions)
 *   GN-6  sessionContext.activeSessionFocus, when present, is a non-empty string
 *          (a blank string or non-string would silently mislead the client)
 *
 * Source: src/aggregator.ts execute path — appended metadata item content[last]:
 *   { latencyMs, sessionContext: { recentTools, callCount, activeSessionFocus? } }
 *
 * Frozen 2026-09-21.
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
  return join(tmpdir(), `ch1tty-gn-${Date.now()}-${++_seq}.jsonl`);
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

/**
 * Execute a tool with a sessionId and return the parsed appended metadata JSON.
 * Asserts the appended item exists and is valid JSON before returning it.
 */
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

// ── GN-1: latencyMs is a finite non-NaN number ───────────────────────────────

test('GN-1: execute session-metadata latencyMs is a finite non-NaN non-negative number', async () => {
  const agg = makeAgg();
  try {
    const meta = await execWithSession(agg, 'neon/list_projects', 'gn-s1');
    const ms = meta.latencyMs as number;
    assert.equal(typeof ms, 'number', 'GN-1: latencyMs must be typeof number');
    assert.ok(Number.isFinite(ms),
      `GN-1: latencyMs must be finite (not Infinity or NaN); got ${ms}. ` +
      'EC confirms >= 0, but does not check isFinite — Infinity would pass EC.');
    assert.ok(ms >= 0, `GN-1: latencyMs must be non-negative; got ${ms}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GN-2: recentTools items are namespaced strings ───────────────────────────

test('GN-2: execute sessionContext.recentTools items each contain exactly one "/" (namespaced)', async () => {
  const agg = makeAgg();
  try {
    const meta = await execWithSession(agg, 'neon/list_projects', 'gn-s2');
    const sc = meta.sessionContext as Record<string, unknown>;
    const rt = sc.recentTools as string[];
    assert.ok(Array.isArray(rt), 'GN-2: recentTools must be an array');
    assert.ok(rt.length >= 1,
      'GN-2: after one call, recentTools must have at least one entry');
    for (const entry of rt) {
      assert.equal(typeof entry, 'string', `GN-2: recentTools item must be a string, got ${typeof entry}`);
      const slashes = entry.split('/').length - 1;
      assert.equal(slashes, 1,
        `GN-2: recentTools item "${entry}" must contain exactly one "/" (namespaced "serverId/toolName"). ` +
        'EC checks typeof string only — a bare tool name without namespace would silently pass.');
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GN-3: callCount is a finite non-negative integer ─────────────────────────

test('GN-3: execute sessionContext.callCount is a finite non-negative integer', async () => {
  const agg = makeAgg();
  try {
    const meta = await execWithSession(agg, 'neon/list_projects', 'gn-s3');
    const sc = meta.sessionContext as Record<string, unknown>;
    const cc = sc.callCount as number;
    assert.equal(typeof cc, 'number', 'GN-3: callCount must be typeof number');
    assert.ok(Number.isFinite(cc),
      `GN-3: callCount must be finite (not Infinity or NaN); got ${cc}. ` +
      'EC checks typeof number — a float like 1.5 or Infinity would pass.');
    assert.ok(Number.isInteger(cc),
      `GN-3: callCount must be an integer (not a float); got ${cc}`);
    assert.ok(cc >= 0, `GN-3: callCount must be non-negative; got ${cc}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GN-4: recentTools.length is capped at 5 ──────────────────────────────────

test('GN-4: execute sessionContext.recentTools.length does not exceed 5 after >5 distinct calls', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gn-s4-session';
    // Make 7 calls to different tools across servers (more than the cap of 5)
    const tools = [
      'neon/list_projects',       'neon/run_sql',
      'neon/describe_table_schema', 'neon/create_project',
      'stripe/list_payments',     'stripe/get_balance',
      'tasks/list_tasks',
    ];
    let meta: Record<string, unknown> = {};
    for (const tool of tools) {
      meta = await execWithSession(agg, tool, sid);
    }
    const sc = meta.sessionContext as Record<string, unknown>;
    const rt = sc.recentTools as string[];
    assert.ok(Array.isArray(rt), 'GN-4: recentTools must be an array');
    assert.ok(rt.length <= 5,
      `GN-4: recentTools must be capped at 5 entries even after ${tools.length} calls; ` +
      `got ${rt.length}. The aggregator slices patterns to 5 before building sessionContext.`);
  } finally {
    await agg.shutdown();
  }
});

// ── GN-5: callCount is > 0 after actual calls ────────────────────────────────

test('GN-5: execute sessionContext.callCount is > 0 after at least one real tool execution', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gn-s5-session';
    const meta = await execWithSession(agg, 'neon/list_projects', sid);
    const sc = meta.sessionContext as Record<string, unknown>;
    const cc = sc.callCount as number;
    assert.ok(cc > 0,
      `GN-5: callCount must be > 0 after at least one real call; got ${cc}. ` +
      'EC checks typeof number only — a stuck-at-zero counter would silently pass.');
  } finally {
    await agg.shutdown();
  }
});

// ── GN-6: activeSessionFocus, when present, is a non-empty string ────────────

test('GN-6: execute sessionContext.activeSessionFocus, when present, is a non-empty string', async () => {
  const agg = makeAgg();
  try {
    const sid = 'gn-s6-session';
    // First call: set a focus on the session via cast (sticky focus path)
    await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      sessionId: sid,
      focus: 'code',
    });
    // Second call: execute with session — if activeSessionFocus is set it must be non-empty string
    const meta = await execWithSession(agg, 'neon/list_projects', sid);
    const sc = meta.sessionContext as Record<string, unknown>;
    if ('activeSessionFocus' in sc) {
      const af = sc.activeSessionFocus;
      assert.equal(typeof af, 'string',
        `GN-6: activeSessionFocus must be a string when present; got ${typeof af}`);
      assert.ok((af as string).length > 0,
        `GN-6: activeSessionFocus must be non-empty when present; got "${af}". ` +
        'A blank string would silently mislead the client into thinking no focus is set.');
    }
    // If activeSessionFocus is absent, the test still passes — we only constrain when present
  } finally {
    await agg.shutdown();
  }
});
