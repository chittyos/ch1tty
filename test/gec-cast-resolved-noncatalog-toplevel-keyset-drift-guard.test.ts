/**
 * GEC drift guard: freeze cast:resolved (dryRun) top-level key set — no catalog combo.
 *
 * GEA froze the top-level key set of cast:resolved when a catalog combo IS matched
 * (which adds keys like `catalogCombo`, `suggestions`, `chainContinuation`, etc.).
 * No test freezes the EXACT top-level key set of cast:resolved when NO catalog combo
 * is present — the standard dryRun path used for preview-before-execute workflows.
 *
 * Probed 2026-09-30:
 *   dryRun, no focus, no session  → {cast, intent, latencyMs, resolved, resolvedBy}
 *   dryRun, no focus, + session   → {cast, intent, latencyMs, resolved, resolvedBy, sessionContext}
 *   dryRun, focus:code, no session → {cast, focus, intent, latencyMs, resolved, resolvedBy}
 *   dryRun, focus:code + session   → {cast, focus, intent, latencyMs, resolved, resolvedBy, sessionContext}
 *
 * GEC freezes:
 *
 *   GEC-1: cast:resolved (dryRun) — no focus, no session → EXACTLY 5 keys
 *          {cast, intent, latencyMs, resolved, resolvedBy}
 *   GEC-2: cast:resolved (dryRun) — no focus, with sessionId → EXACTLY 6 keys
 *          {cast, intent, latencyMs, resolved, resolvedBy, sessionContext}
 *   GEC-3: cast:resolved (dryRun) — focus:code, no session → EXACTLY 6 keys
 *          {cast, focus, intent, latencyMs, resolved, resolvedBy}
 *   GEC-4: cast:resolved (dryRun) — focus:code + sessionId → EXACTLY 7 keys
 *          {cast, focus, intent, latencyMs, resolved, resolvedBy, sessionContext}
 *   GEC-5: invariant — `catalogCombo` key NEVER present when no suggestions catalog
 *          is configured (across all four combinations above)
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (cast:resolved, not explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function makeDlq(): string {
  return join(tmpdir(), `ch1tty-gec-${Date.now()}-${++_seq}.jsonl`);
}

const NEON_CFG: ServerConfig = {
  id: 'neon',
  name: 'Neon Database',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.test/mcp',
};

const NEON_TOOLS: ToolEntry[] = [
  {
    name: 'list_projects',
    description: 'List Neon projects',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_sql',
    description: 'Run SQL query on Neon',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  },
];

function makeBackend(): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: NEON_TOOLS.length, toolCacheAge: 0 }),
    listTools: async () => NEON_TOOLS,
    callTool: async (): Promise<ToolCallResult> => ({
      content: [{ type: 'text', text: 'tool-output' }],
    }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makeAgg(): Aggregator {
  return new Aggregator([NEON_CFG], {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: makeDlq(),
  } as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

/** Parse cast body JSON from content[0]. */
function parseCast(result: ToolCallResult): Record<string, unknown> {
  assert.ok(Array.isArray(result.content) && result.content.length > 0, 'result.content must be non-empty');
  const item = result.content[0] as { type: string; text: string };
  assert.equal(item.type, 'text', 'content[0].type must be text');
  return JSON.parse(item.text) as Record<string, unknown>;
}

// ── GEC-1: dryRun, no focus, no session → EXACTLY {cast, intent, latencyMs, resolved, resolvedBy} ──

test('GEC-1: cast:resolved (dryRun) no focus no session → EXACTLY {cast,intent,latencyMs,resolved,resolvedBy}', async () => {
  const agg = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', dryRun: true });
  const cast = parseCast(result);
  assert.equal(cast.cast, 'resolved', `expected cast:resolved, got ${cast.cast}`);
  const keys = Object.keys(cast).sort();
  assert.deepEqual(
    keys,
    ['cast', 'intent', 'latencyMs', 'resolved', 'resolvedBy'],
    `cast:resolved (no focus, no session) must have EXACTLY 5 keys; got ${JSON.stringify(keys)}`,
  );
});

// ── GEC-2: dryRun, no focus, with sessionId → EXACTLY {cast, intent, latencyMs, resolved, resolvedBy, sessionContext} ──

test('GEC-2: cast:resolved (dryRun) no focus with sessionId → EXACTLY {cast,intent,latencyMs,resolved,resolvedBy,sessionContext}', async () => {
  const agg = makeAgg();
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    dryRun: true,
    sessionId: 'gec-session-2',
  });
  const cast = parseCast(result);
  assert.equal(cast.cast, 'resolved', `expected cast:resolved, got ${cast.cast}`);
  const keys = Object.keys(cast).sort();
  assert.deepEqual(
    keys,
    ['cast', 'intent', 'latencyMs', 'resolved', 'resolvedBy', 'sessionContext'],
    `cast:resolved (no focus, with session) must have EXACTLY 6 keys; got ${JSON.stringify(keys)}`,
  );
});

// ── GEC-3: dryRun, focus:code, no session → EXACTLY {cast, focus, intent, latencyMs, resolved, resolvedBy} ──

test('GEC-3: cast:resolved (dryRun) focus:code no session → EXACTLY {cast,focus,intent,latencyMs,resolved,resolvedBy}', async () => {
  const agg = makeAgg();
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    dryRun: true,
    focus: 'code',
  });
  const cast = parseCast(result);
  assert.equal(cast.cast, 'resolved', `expected cast:resolved, got ${cast.cast}`);
  const keys = Object.keys(cast).sort();
  assert.deepEqual(
    keys,
    ['cast', 'focus', 'intent', 'latencyMs', 'resolved', 'resolvedBy'],
    `cast:resolved (focus:code, no session) must have EXACTLY 6 keys; got ${JSON.stringify(keys)}`,
  );
});

// ── GEC-4: dryRun, focus:code, with sessionId → EXACTLY {cast, focus, intent, latencyMs, resolved, resolvedBy, sessionContext} ──

test('GEC-4: cast:resolved (dryRun) focus:code with sessionId → EXACTLY {cast,focus,intent,latencyMs,resolved,resolvedBy,sessionContext}', async () => {
  const agg = makeAgg();
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    dryRun: true,
    focus: 'code',
    sessionId: 'gec-session-4',
  });
  const cast = parseCast(result);
  assert.equal(cast.cast, 'resolved', `expected cast:resolved, got ${cast.cast}`);
  const keys = Object.keys(cast).sort();
  assert.deepEqual(
    keys,
    ['cast', 'focus', 'intent', 'latencyMs', 'resolved', 'resolvedBy', 'sessionContext'],
    `cast:resolved (focus:code, with session) must have EXACTLY 7 keys; got ${JSON.stringify(keys)}`,
  );
});

// ── GEC-5: `catalogCombo` NEVER present when no suggestions catalog configured ──

test('GEC-5: cast:resolved (dryRun) catalogCombo key NEVER present when no suggestions catalog configured', async () => {
  const combos: Array<Record<string, unknown>> = [];

  const agg1 = makeAgg();
  combos.push(parseCast(await agg1.callTool('ch1tty/cast', { intent: 'list neon projects', dryRun: true })));

  const agg2 = makeAgg();
  combos.push(parseCast(await agg2.callTool('ch1tty/cast', { intent: 'list neon projects', dryRun: true, sessionId: 'gec-session-5a' })));

  const agg3 = makeAgg();
  combos.push(parseCast(await agg3.callTool('ch1tty/cast', { intent: 'list neon projects', dryRun: true, focus: 'code' })));

  const agg4 = makeAgg();
  combos.push(parseCast(await agg4.callTool('ch1tty/cast', { intent: 'list neon projects', dryRun: true, focus: 'code', sessionId: 'gec-session-5b' })));

  for (const cast of combos) {
    assert.equal(cast.cast, 'resolved', `expected cast:resolved, got ${cast.cast}`);
    assert.ok(
      !('catalogCombo' in cast),
      `catalogCombo must NEVER appear when no suggestions catalog is configured; got keys: ${JSON.stringify(Object.keys(cast))}`,
    );
  }
});
