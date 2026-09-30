/**
 * GDQ drift guard: freeze `ch1tty/execute` dryRun WITH SESSION exact body key set.
 *
 * EC (execute-dry-run.test.ts) froze the exact top-level key set for dryRun WITHOUT a
 * session: exactly {status, server, tool, args, latencyMs}. It does NOT assert an exact
 * key set when a session IS active — it only checks that `sessionContext` is present
 * and has `recentTools`/`callCount`. A regression adding an unexpected top-level key (e.g.
 * `focus`, `brainPath`, `sessionId`) when a session is active would pass all existing tests.
 *
 * GDQ closes those gaps:
 *
 *   GDQ-1  dryRun + sessionId → body has EXACTLY {status, server, tool, args, latencyMs,
 *           sessionContext} (6 keys, no unexpected extras)
 *   GDQ-2  dryRun + sessionId + sticky focus → body still has EXACTLY 6 keys (focus is
 *           embedded in sessionContext.activeSessionFocus, never as a top-level body key)
 *   GDQ-3  dryRun + sessionId (no focus) → sessionContext has EXACTLY {recentTools, callCount}
 *           (EC + execute-session-context.test.ts check field presence; no merged test freezes
 *           the exact set — a regression adding e.g. `sessionId` or `tool` to sessionContext
 *           would silently pass)
 *   GDQ-4  dryRun + sessionId + sticky focus → sessionContext has EXACTLY
 *           {recentTools, callCount, activeSessionFocus} (3 keys, no others)
 *   GDQ-5  dryRun + sessionId after one prior live call → body exact key set unchanged
 *           (prior non-dryRun calls grow callCount / recentTools but must not expand the
 *           body key set)
 *
 * Source: handleExecute (src-stdio/aggregator.ts, dryRun path) + outer inject in callTool.
 *
 * Frozen 2026-09-28.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (execute path, not cast)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gdq-${Date.now()}-${++_seq}.jsonl`);
}

const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true,
};
const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true,
};

const NEON_TOOLS: ToolEntry[] = [
  { name: 'run_sql', description: 'Run SQL on Neon', inputSchema: { type: 'object', properties: {} } },
];
const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'list_customers', description: 'List Stripe customers', inputSchema: { type: 'object', properties: {} } },
];

const FOCUS_PROFILES = {
  profiles: {
    code: { description: 'Code tools', categories: ['code' as const], servers: ['neon'], boost: 0.5 },
  },
};

function makeBackend(tools: ToolEntry[]): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: tools.length, toolCacheAge: 0 }),
    listTools: async () => tools,
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: 'ok' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makeAgg(): Aggregator {
  const backends = new Map<string, Backend>([
    ['neon', makeBackend(NEON_TOOLS)],
    ['stripe', makeBackend(STRIPE_TOOLS)],
  ]);
  return new Aggregator([NEON_CFG, STRIPE_CFG], {
    focusProfiles: FOCUS_PROFILES,
    backendFactory: (cfg) => backends.get(cfg.id) ?? makeBackend([]),
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

/** Execute dryRun and return the parsed JSON body from content[0]. */
async function dryRunBody(agg: Aggregator, tool: string, sessionId: string): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/execute', { tool, dryRun: true, sessionId });
  assert.equal(result.isError, false, 'dryRun must not set isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'dryRun must return at least one content item');
  assert.equal(content[0].type, 'text', 'dryRun content[0] must be type:text');
  return JSON.parse(content[0].text!) as Record<string, unknown>;
}

// ── GDQ-1 ─────────────────────────────────────────────────────────────────────

test('GDQ-1: execute dryRun + sessionId → body has EXACTLY {status,server,tool,args,latencyMs,sessionContext}', async () => {
  const agg = makeAgg();
  try {
    const body = await dryRunBody(agg, 'neon/run_sql', 'gdq-1-session');
    const actual = Object.keys(body).sort();
    const expected = ['args', 'latencyMs', 'server', 'sessionContext', 'status', 'tool'];
    assert.deepEqual(
      actual,
      expected,
      `GDQ-1: body key set mismatch. got: [${actual.join(', ')}], want: [${expected.join(', ')}]. ` +
        'EC froze no-session key set; GDQ-1 freezes the WITH-session exact key set.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDQ-2 ─────────────────────────────────────────────────────────────────────

test('GDQ-2: execute dryRun + sessionId + sticky focus → body still has EXACTLY 6 keys (focus not promoted to top level)', async () => {
  const agg = makeAgg();
  try {
    const SID = 'gdq-2-session';
    // Set sticky focus via search — focus must land in sessionContext.activeSessionFocus, not top-level
    await agg.callTool('ch1tty/search', { query: 'sql', focus: 'code', sessionId: SID });
    const body = await dryRunBody(agg, 'neon/run_sql', SID);
    const actual = Object.keys(body).sort();
    const expected = ['args', 'latencyMs', 'server', 'sessionContext', 'status', 'tool'];
    assert.deepEqual(
      actual,
      expected,
      `GDQ-2: body key set with sticky focus mismatch. got: [${actual.join(', ')}]. ` +
        'Sticky focus must be embedded in sessionContext.activeSessionFocus; no top-level focus key allowed.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDQ-3 ─────────────────────────────────────────────────────────────────────

test('GDQ-3: execute dryRun + sessionId (no focus) → sessionContext has EXACTLY {recentTools, callCount}', async () => {
  const agg = makeAgg();
  try {
    const body = await dryRunBody(agg, 'neon/run_sql', 'gdq-3-session');
    const sc = body.sessionContext as Record<string, unknown>;
    assert.ok(sc && typeof sc === 'object' && !Array.isArray(sc), 'sessionContext must be a plain object');
    const scKeys = Object.keys(sc).sort();
    const expected = ['callCount', 'recentTools'];
    assert.deepEqual(
      scKeys,
      expected,
      `GDQ-3: sessionContext key set mismatch (no focus). got: [${scKeys.join(', ')}], want: [${expected.join(', ')}]. ` +
        'EC/execute-session-context check presence; GDQ-3 freezes the exact set.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDQ-4 ─────────────────────────────────────────────────────────────────────

test('GDQ-4: execute dryRun + sessionId + sticky focus → sessionContext has EXACTLY {recentTools,callCount,activeSessionFocus}', async () => {
  const agg = makeAgg();
  try {
    const SID = 'gdq-4-session';
    await agg.callTool('ch1tty/search', { query: 'sql', focus: 'code', sessionId: SID });
    const body = await dryRunBody(agg, 'neon/run_sql', SID);
    const sc = body.sessionContext as Record<string, unknown>;
    assert.ok(sc && typeof sc === 'object' && !Array.isArray(sc), 'sessionContext must be a plain object');
    const scKeys = Object.keys(sc).sort();
    const expected = ['activeSessionFocus', 'callCount', 'recentTools'];
    assert.deepEqual(
      scKeys,
      expected,
      `GDQ-4: sessionContext key set mismatch (with focus). got: [${scKeys.join(', ')}], want: [${expected.join(', ')}]. ` +
        'No merged test freezes the exact sessionContext key set when focus is active.',
    );
    assert.equal(typeof sc.activeSessionFocus, 'string', 'GDQ-4: activeSessionFocus must be a string');
    assert.ok((sc.activeSessionFocus as string).length > 0, 'GDQ-4: activeSessionFocus must be non-empty');
  } finally {
    await agg.shutdown();
  }
});

// ── GDQ-5 ─────────────────────────────────────────────────────────────────────

test('GDQ-5: execute dryRun + sessionId after one live call → body exact key set unchanged (session growth does not expand key set)', async () => {
  const agg = makeAgg();
  try {
    const SID = 'gdq-5-session';
    // One live call to grow callCount and recentTools in the session
    await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql', sessionId: SID });
    // dryRun in same session — body shape must stay the same 6-key set
    const body = await dryRunBody(agg, 'stripe/list_customers', SID);
    const actual = Object.keys(body).sort();
    const expected = ['args', 'latencyMs', 'server', 'sessionContext', 'status', 'tool'];
    assert.deepEqual(
      actual,
      expected,
      `GDQ-5: body key set after prior live call mismatch. got: [${actual.join(', ')}]. ` +
        'Prior calls grow callCount/recentTools but must not expand the body key set.',
    );
    // Confirm callCount > 0 so we know the session state was actually read
    const sc = body.sessionContext as Record<string, unknown>;
    assert.ok(
      typeof sc.callCount === 'number' && (sc.callCount as number) > 0,
      'GDQ-5: callCount must be > 0 after one live call (confirms session state was read, not an empty fresh session)',
    );
  } finally {
    await agg.shutdown();
  }
});
