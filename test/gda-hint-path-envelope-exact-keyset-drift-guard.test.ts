/**
 * GDA drift guard: freeze the EXACT KEY SET of the ch1tty/search no-query
 * (hint / server-summary) response envelope across no-session, with-session,
 * and with-session+focus combinations.
 *
 * EB (2026-09-19) froze the REQUIRED fields {hint, latencyMs, servers, totalTools}
 * for the hint path — a "must be present" check. It does NOT freeze the
 * EXACT key set: a regression adding `sessionId`, `intent`, or any other
 * field at the top level would pass EB silently.
 *
 * The hint path (no query / no server / no category) also diverges from the
 * keyword search path in one important way: it NEVER echoes `sessionId` even
 * when a session is active. The keyword path does echo it
 * (`...(effectiveSessionId ? { sessionId: effectiveSessionId } : {})`),
 * but the hint path omits that line intentionally. No test currently freezes
 * this absence.
 *
 * ── Source ────────────────────────────────────────────────────────────────
 *   src-stdio/aggregator.ts — handleSearch, hint branch:
 *     { hint, latencyMs, entity?, identityClass?, focus?, inFocusOnly?,
 *       sessionContext?, explanation?, servers, totalTools }
 *
 * ── Frozen invariants ────────────────────────────────────────────────────
 *
 *   GDA-1  No session, no focus → EXACTLY {hint, latencyMs, servers, totalTools}
 *          (confirms EB's required-field check is also the exact set — no extra
 *          field leaks in the default no-session/no-focus case)
 *
 *   GDA-2  Session active, no focus → EXACTLY {hint, latencyMs, servers,
 *          sessionContext, totalTools}
 *          (sessionContext is added; but sessionId is NOT added — hint path
 *          diverges from keyword path which echoes sessionId)
 *
 *   GDA-3  Session + focus → EXACTLY {focus, hint, latencyMs, servers,
 *          sessionContext, totalTools}
 *
 *   GDA-4  Session + focus + inFocusOnly → EXACTLY {focus, hint, inFocusOnly,
 *          latencyMs, servers, sessionContext, totalTools}
 *
 *   GDA-5  `sessionId` is ABSENT from the hint path even when session is active.
 *          Paired check: keyword path (query: present) with same session DOES
 *          include `sessionId`, confirming the divergence is the hint path's
 *          own choice, not a broader absence.
 *
 * Frozen 2026-09-27.
 *
 * CLAUDE.md compliance:
 *   - Public MCP surface unchanged (5 meta-tools: search/execute/status/reload/cast).
 *   - buildCastExplanation metric freeze: not applicable (search hint path, not cast explain).
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gda-${Date.now()}-${++_seq}.jsonl`);
}

const ALPHA_CFG: ServerConfig = {
  id: 'alpha', name: 'Alpha DB', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://alpha.test/mcp', lazy: true,
};
const BETA_CFG: ServerConfig = {
  id: 'beta', name: 'Beta Billing', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://beta.test/mcp', lazy: true,
};

const ALPHA_TOOLS: ToolEntry[] = [
  { name: 'list_databases', description: 'List all databases in the code project', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_query',      description: 'Run a SQL query in the code environment', inputSchema: { type: 'object', properties: {} } },
];
const BETA_TOOLS: ToolEntry[] = [
  { name: 'list_invoices',  description: 'List billing invoices for payment',       inputSchema: { type: 'object', properties: {} } },
];

const FOCUS_PROFILES = {
  profiles: {
    code: {
      description: 'Code-focused tools',
      categories: ['code' as const],
      servers: ['alpha'],
      boost: 0.5,
    },
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
    ['alpha', makeBackend(ALPHA_TOOLS)],
    ['beta',  makeBackend(BETA_TOOLS)],
  ]);
  return new Aggregator(
    [ALPHA_CFG, BETA_CFG],
    {
      focusProfiles: FOCUS_PROFILES,
      backendFactory: (cfg) => backends.get(cfg.id) ?? makeBackend([]),
      embedEnabled: false,
      ledgerDlqPath: dlq(),
    },
  );
}

function parse(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const item = result.content.find((c) => c.type === 'text');
  assert.ok(item?.text, 'Expected text content item');
  return JSON.parse(item.text) as Record<string, unknown>;
}

// ── GDA-1: no session, no focus ───────────────────────────────────────────────

test('GDA-1: hint path (no session, no focus) has EXACTLY {hint, latencyMs, servers, totalTools}', async () => {
  const agg = makeAgg();
  try {
    // No args at all → triggers hint path (no query, no server filter, no category)
    const result = await agg.callTool('ch1tty/search', {});
    const parsed = parse(result);
    const keys = Object.keys(parsed).sort();
    assert.deepEqual(keys, ['hint', 'latencyMs', 'servers', 'totalTools'],
      `hint path (no session, no focus) must have EXACTLY {hint, latencyMs, servers, totalTools} — got: ${JSON.stringify(keys)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GDA-2: session active, no focus ───────────────────────────────────────────

test('GDA-2: hint path (session active, no focus) has EXACTLY {hint, latencyMs, servers, sessionContext, totalTools}', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gda-2-session-no-focus';
    // Warm the session via execute so coordinator has recorded it.
    await agg.callTool('ch1tty/execute', { tool: 'alpha/list_databases', args: {}, sessionId: SESSION });
    // Hint path: only sessionId — no query/server/category
    const result = await agg.callTool('ch1tty/search', { sessionId: SESSION });
    const parsed = parse(result);
    const keys = Object.keys(parsed).sort();
    assert.deepEqual(keys, ['hint', 'latencyMs', 'servers', 'sessionContext', 'totalTools'],
      `hint path (session, no focus) must have EXACTLY {hint, latencyMs, servers, sessionContext, totalTools} — got: ${JSON.stringify(keys)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GDA-3: session + focus ────────────────────────────────────────────────────

test('GDA-3: hint path (session + focus) has EXACTLY {focus, hint, latencyMs, servers, sessionContext, totalTools}', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gda-3-session-focus';
    await agg.callTool('ch1tty/execute', { tool: 'alpha/list_databases', args: {}, sessionId: SESSION });
    const result = await agg.callTool('ch1tty/search', { sessionId: SESSION, focus: 'code' });
    const parsed = parse(result);
    const keys = Object.keys(parsed).sort();
    assert.deepEqual(keys, ['focus', 'hint', 'latencyMs', 'servers', 'sessionContext', 'totalTools'],
      `hint path (session+focus) must have EXACTLY {focus, hint, latencyMs, servers, sessionContext, totalTools} — got: ${JSON.stringify(keys)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GDA-4: session + focus + inFocusOnly ──────────────────────────────────────

test('GDA-4: hint path (session + focus + inFocusOnly) has EXACTLY {focus, hint, inFocusOnly, latencyMs, servers, sessionContext, totalTools}', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gda-4-session-focus-infocusonly';
    await agg.callTool('ch1tty/execute', { tool: 'alpha/list_databases', args: {}, sessionId: SESSION });
    const result = await agg.callTool('ch1tty/search', { sessionId: SESSION, focus: 'code', inFocusOnly: true });
    const parsed = parse(result);
    const keys = Object.keys(parsed).sort();
    assert.deepEqual(keys, ['focus', 'hint', 'inFocusOnly', 'latencyMs', 'servers', 'sessionContext', 'totalTools'],
      `hint path (session+focus+inFocusOnly) must have EXACTLY {focus, hint, inFocusOnly, latencyMs, servers, sessionContext, totalTools} — got: ${JSON.stringify(keys)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GDA-5: sessionId is ABSENT from hint path even when session is active ─────

test('GDA-5: hint path never echoes `sessionId` even when session is active (unlike keyword path)', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gda-5-no-sessionid-echo';
    await agg.callTool('ch1tty/execute', { tool: 'alpha/list_databases', args: {}, sessionId: SESSION });

    // Hint path: no query → sessionId must be ABSENT
    const hintResult = await agg.callTool('ch1tty/search', { sessionId: SESSION });
    const hintParsed = parse(hintResult);
    assert.ok(!('sessionId' in hintParsed),
      `hint path must NOT echo sessionId — got keys: ${JSON.stringify(Object.keys(hintParsed).sort())}`);
    assert.ok('sessionContext' in hintParsed,
      `hint path MUST include sessionContext when session is active (control check)`);

    // Keyword path with same session DOES echo sessionId — confirms divergence is real
    const kwResult = await agg.callTool('ch1tty/search', { query: 'database', sessionId: SESSION });
    const kwParsed = parse(kwResult);
    assert.ok('sessionId' in kwParsed,
      `keyword path MUST echo sessionId when session active (control check) — got: ${JSON.stringify(Object.keys(kwParsed).sort())}`);
  } finally {
    await agg.shutdown();
  }
});
