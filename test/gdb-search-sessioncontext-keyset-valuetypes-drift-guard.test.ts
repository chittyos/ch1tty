/**
 * GDB drift guard: freeze the exact KEY SET and VALUE TYPES of the
 * `sessionContext` sub-object returned by ch1tty/search.
 *
 * FF (search-session-context.test.ts, 2026-09-19) freezes sessionContext
 * BEHAVIOUR in ch1tty/search: presence/absence, recentTools contents,
 * callCount incrementing, and activeSessionFocus tracking.  It does NOT freeze:
 *
 *   1. The EXACT key set — extra keys (e.g. `timestamp`, `sessionId`) could
 *      silently appear without breaking any existing assertion.
 *   2. VALUE TYPES — callCount being Infinity, NaN, or a float; recentTools
 *      items being bare (non-namespaced) strings; activeSessionFocus being
 *      non-string — all pass FF's assertions silently.
 *
 * GR (2026-09-21) closes the same gaps for cast.
 * GN (2026-09-20) closes them for execute.
 * GDB is the parallel guard for ch1tty/search.
 *
 * Source: handleSearch, keyword path, src-stdio/aggregator.ts ~lines 658–664.
 * The sessionContext object is built by the same coordinator path across all
 * three meta-tools (search, execute, cast).
 *
 * ── Frozen invariants ────────────────────────────────────────────────────
 *
 *   GDB-1  No sticky focus → sessionContext exact key set is
 *          {callCount, recentTools}
 *          (activeSessionFocus absent; no other keys present)
 *
 *   GDB-2  Sticky focus active → sessionContext exact key set is
 *          {activeSessionFocus, callCount, recentTools}
 *          (no other keys present beyond these three)
 *
 *   GDB-3  sessionContext.callCount is Number.isFinite, Number.isInteger,
 *          and >= 0 (not Infinity, NaN, -1, or a float like 1.5)
 *
 *   GDB-4  Each sessionContext.recentTools item contains exactly one '/'
 *          (namespaced "serverId/toolName" format; bare tool names without
 *          a '/', or multi-slash paths, are rejected)
 *
 *   GDB-5  sessionContext.activeSessionFocus is typeof string and non-empty
 *          when present (never null, undefined, 0, false, or "")
 *
 * Frozen 2026-09-27.
 *
 * CLAUDE.md compliance:
 *   - Public MCP surface unchanged (5 meta-tools: search/execute/status/reload/cast).
 *   - buildCastExplanation metric freeze: not applicable (search, not cast explain).
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig, ToolCallResult } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';
import type { FixtureToolDef } from './fixture-backend.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gdb-${Date.now()}-${++_seq}.jsonl`);
}

function tool(name: string, desc: string): FixtureToolDef {
  return {
    name,
    description: desc,
    inputSchema: { type: 'object', properties: {} },
    response: { content: [{ type: 'text', text: 'ok' }] },
  };
}

function parse(result: ToolCallResult): Record<string, unknown> {
  return JSON.parse(
    (result.content[0] as { type: 'text'; text: string }).text,
  ) as Record<string, unknown>;
}

// ── Fixture config ─────────────────────────────────────────────────────────────

const ALPHA_CFG: ServerConfig = {
  id: 'alpha', name: 'Alpha DB', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://alpha.test/mcp',
};
const BETA_CFG: ServerConfig = {
  id: 'beta', name: 'Beta Billing', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://beta.test/mcp',
};

const ALPHA_TOOLS: FixtureToolDef[] = [
  tool('list_databases', 'List all databases in the code project'),
  tool('run_query',      'Run a SQL query in the code environment'),
];
const BETA_TOOLS: FixtureToolDef[] = [
  tool('list_invoices', 'List billing invoices for payment'),
  tool('pay_invoice',   'Pay an invoice for billing'),
];

const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code' as const], servers: ['alpha'], boost: 0.5 },
  },
};

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('alpha', { tools: ALPHA_TOOLS });
  backend.defineServer('beta', { tools: BETA_TOOLS });
  return new Aggregator([ALPHA_CFG, BETA_CFG], {
    focusProfiles: FOCUS_PROFILES,
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

// ── GDB-1: exact key set — no sticky focus ─────────────────────────────────────

test('GDB-1: search sessionContext exact key set (no focus) is exactly {callCount, recentTools}', async () => {
  const SESSION = 'gdb-1-session';
  const agg = makeAgg();
  try {
    await agg.callTool('ch1tty/execute', { tool: 'alpha/list_databases', args: {}, sessionId: SESSION });
    const result = await agg.callTool('ch1tty/search', { query: 'database', sessionId: SESSION });
    assert.equal(result.isError, undefined, 'no error expected');
    const parsed = parse(result);
    assert.ok(parsed.sessionContext, 'sessionContext must be present when session is active');
    const sc = parsed.sessionContext as Record<string, unknown>;
    const keys = Object.keys(sc).sort();
    assert.deepEqual(
      keys,
      ['callCount', 'recentTools'],
      `Expected exactly {callCount, recentTools}; got {${keys.join(', ')}}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDB-2: exact key set — sticky focus active ─────────────────────────────────

test('GDB-2: search sessionContext exact key set (sticky focus active) is exactly {activeSessionFocus, callCount, recentTools}', async () => {
  const SESSION = 'gdb-2-session';
  const agg = makeAgg();
  try {
    // Warm session with execute, then set sticky focus via a search call
    await agg.callTool('ch1tty/execute', { tool: 'alpha/list_databases', args: {}, sessionId: SESSION });
    await agg.callTool('ch1tty/search', { query: 'code tools', sessionId: SESSION, focus: 'code' });
    // Next search — sessionContext must now include activeSessionFocus
    const result = await agg.callTool('ch1tty/search', { query: 'database', sessionId: SESSION });
    assert.equal(result.isError, undefined, 'no error expected');
    const parsed = parse(result);
    assert.ok(parsed.sessionContext, 'sessionContext must be present when session is active');
    const sc = parsed.sessionContext as Record<string, unknown>;
    const keys = Object.keys(sc).sort();
    assert.deepEqual(
      keys,
      ['activeSessionFocus', 'callCount', 'recentTools'],
      `Expected exactly {activeSessionFocus, callCount, recentTools}; got {${keys.join(', ')}}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDB-3: callCount value types ──────────────────────────────────────────────

test('GDB-3: search sessionContext.callCount is a finite non-negative integer', async () => {
  const SESSION = 'gdb-3-session';
  const agg = makeAgg();
  try {
    await agg.callTool('ch1tty/execute', { tool: 'alpha/list_databases', args: {}, sessionId: SESSION });
    await agg.callTool('ch1tty/execute', { tool: 'alpha/run_query',      args: {}, sessionId: SESSION });
    await agg.callTool('ch1tty/execute', { tool: 'beta/list_invoices',   args: {}, sessionId: SESSION });
    const result = await agg.callTool('ch1tty/search', { query: 'list', sessionId: SESSION });
    assert.equal(result.isError, undefined, 'no error expected');
    const sc = parse(result).sessionContext as Record<string, unknown>;
    const cc = sc.callCount as number;
    assert.ok(Number.isFinite(cc),  `callCount must be finite (got ${cc})`);
    assert.ok(Number.isInteger(cc), `callCount must be an integer (got ${cc})`);
    assert.ok(cc >= 0,              `callCount must be >= 0 (got ${cc})`);
  } finally {
    await agg.shutdown();
  }
});

// ── GDB-4: recentTools namespaced format ──────────────────────────────────────

test('GDB-4: each sessionContext.recentTools item contains exactly one "/" (serverId/toolName format)', async () => {
  const SESSION = 'gdb-4-session';
  const agg = makeAgg();
  try {
    await agg.callTool('ch1tty/execute', { tool: 'alpha/list_databases', args: {}, sessionId: SESSION });
    await agg.callTool('ch1tty/execute', { tool: 'beta/list_invoices',   args: {}, sessionId: SESSION });
    await agg.callTool('ch1tty/execute', { tool: 'alpha/run_query',      args: {}, sessionId: SESSION });
    const result = await agg.callTool('ch1tty/search', { query: 'list', sessionId: SESSION });
    assert.equal(result.isError, undefined, 'no error expected');
    const sc = parse(result).sessionContext as Record<string, unknown>;
    const recent = sc.recentTools as string[];
    assert.ok(Array.isArray(recent), 'recentTools must be an array');
    assert.ok(recent.length > 0, 'recentTools must be non-empty after tool calls');
    for (const item of recent) {
      assert.equal(typeof item, 'string', `recentTools item must be a string, got ${typeof item}`);
      const slashCount = (item.match(/\//g) ?? []).length;
      assert.equal(
        slashCount,
        1,
        `"${item}" must contain exactly one "/" (namespaced serverId/toolName); found ${slashCount}`,
      );
      const [serverId, toolName] = item.split('/');
      assert.ok(serverId.length > 0, `serverId part of "${item}" must be non-empty`);
      assert.ok(toolName.length > 0,  `toolName part of "${item}" must be non-empty`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GDB-5: activeSessionFocus value type ─────────────────────────────────────

test('GDB-5: sessionContext.activeSessionFocus is a non-empty string when present', async () => {
  const SESSION = 'gdb-5-session';
  const agg = makeAgg();
  try {
    // Set sticky focus via a search call
    await agg.callTool('ch1tty/search', { query: 'code tools', sessionId: SESSION, focus: 'code' });
    const result = await agg.callTool('ch1tty/search', { query: 'database', sessionId: SESSION });
    assert.equal(result.isError, undefined, 'no error expected');
    const sc = parse(result).sessionContext as Record<string, unknown>;
    assert.ok(
      'activeSessionFocus' in sc,
      'activeSessionFocus must be present after sticky focus is set',
    );
    const asf = sc.activeSessionFocus;
    assert.equal(
      typeof asf,
      'string',
      `activeSessionFocus must be typeof string, got ${typeof asf}`,
    );
    assert.ok(
      (asf as string).length > 0,
      'activeSessionFocus must be a non-empty string',
    );
  } finally {
    await agg.shutdown();
  }
});
