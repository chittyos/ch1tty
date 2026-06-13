/**
 * S: session-sticky focus
 *
 * When an explicit `focus` param is passed to ch1tty/search or ch1tty/cast,
 * the resolved profile name is persisted per-session via SessionCoordinator.
 * Subsequent calls in the same session that omit the `focus` param automatically
 * use the session-stored focus — clients don't need to re-pass it every call.
 *
 * Priority: per-call focus > session-sticky focus > process default (CH1TTY_FOCUS).
 * Passing focus:"none" or focus:"" clears the session-sticky focus.
 * Session isolation: one session's sticky focus does not affect another session.
 *
 * Covered:
 *   1. search: explicit focus param → stored as session-sticky focus
 *   2. search: subsequent call without focus → session-sticky focus is used
 *   3. search: focus:"none" clears session-sticky focus
 *   4. cast: explicit focus param → stored as session-sticky focus
 *   5. cast: subsequent search without focus → uses focus set by cast
 *   6. session isolation: sticky focus in session A does not affect session B
 *   7. process default (env focus) is used when no session focus and no per-call focus
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-sticky-focus-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'list_invoices', description: 'List Stripe invoices for billing and finance reporting', inputSchema: { type: 'object', properties: {} } },
];

const CONTEXT7_CFG: ServerConfig = {
  id: 'context7', name: 'Context7', type: 'remote', access: 'readwrite',
  category: 'search', endpoint: 'https://context7.test/mcp',
};
const CONTEXT7_TOOLS: ToolEntry[] = [
  { name: 'get-library-docs', description: 'Retrieve library documentation by library ID', inputSchema: { type: 'object', properties: {} } },
];

function makeStaticBackend(tools: ToolEntry[]): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: tools.length, toolCacheAge: 0 }),
    listTools: async () => tools,
    callTool: async (_sid: string, toolName: string): Promise<ToolCallResult> => ({
      content: [{ type: 'text', text: `${toolName}: ok` }],
    }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makeAgg(envFocus?: string, label = 'test'): Aggregator {
  const backends = new Map<string, Backend>([
    ['stripe',   makeStaticBackend(STRIPE_TOOLS)],
    ['context7', makeStaticBackend(CONTEXT7_TOOLS)],
  ]);
  return new Aggregator([STRIPE_CFG, CONTEXT7_CFG], {
    backendFactory: (cfg) => backends.get(cfg.id) ?? makeStaticBackend([]),
    embedEnabled: false,
    ledgerDlqPath: dlqPath(label),
    ...(envFocus ? { focus: envFocus } : {}),
  });
}

function parse(result: ToolCallResult): Record<string, unknown> {
  return JSON.parse(result.content[0].text as string);
}

// ── 1. search: explicit focus param → stored as session-sticky focus ──────────

test('sticky focus: explicit focus on search is persisted for the session', async () => {
  const agg = makeAgg(undefined, '1-store');
  const SID = 'session-1';
  await agg.coordinator.onSessionStart(SID, 'http');
  try {
    // First call — set focus to "finance" explicitly
    await agg.callTool('ch1tty/search', { focus: 'finance' }, SID);
    // Verify coordinator stored it
    assert.equal(agg.coordinator.getSessionFocus(SID), 'finance');
  } finally {
    await agg.coordinator.onSessionEnd(SID);
    await agg.shutdown();
  }
});

// ── 2. search: subsequent call without focus → session-sticky focus used ──────

test('sticky focus: subsequent search without focus uses session-stored focus', async () => {
  const agg = makeAgg(undefined, '2-reuse');
  const SID = 'session-2';
  await agg.coordinator.onSessionStart(SID, 'http');
  try {
    // First call: set focus to "finance" (stripe is in-focus; context7 is not)
    await agg.callTool('ch1tty/search', { query: 'invoices', focus: 'finance' }, SID);

    // Second call: no focus param → should use session-sticky focus "finance"
    const result = await agg.callTool('ch1tty/search', { query: 'invoices' }, SID);
    const data = parse(result);
    // With finance focus active, in-focus tools appear first; focus field is reported
    assert.equal(data.focus, 'finance', 'session-sticky focus reflected in response');
    // stripe is in finance focus → its tools should appear and have inFocus: true
    const tools = data.tools as Array<{ server: string; inFocus?: boolean }>;
    const stripeTool = tools.find((t) => t.server === 'stripe');
    assert.ok(stripeTool, 'stripe tool appears in results');
    assert.equal(stripeTool?.inFocus, true, 'stripe tool marked inFocus: true');
  } finally {
    await agg.coordinator.onSessionEnd(SID);
    await agg.shutdown();
  }
});

// ── 3. search: focus:"none" clears session-sticky focus ───────────────────────

test('sticky focus: focus:"none" clears session focus', async () => {
  const agg = makeAgg(undefined, '3-clear');
  const SID = 'session-3';
  await agg.coordinator.onSessionStart(SID, 'http');
  try {
    // Set a session focus
    await agg.callTool('ch1tty/search', { focus: 'finance' }, SID);
    assert.equal(agg.coordinator.getSessionFocus(SID), 'finance');

    // Clear it with "none"
    await agg.callTool('ch1tty/search', { focus: 'none' }, SID);
    assert.equal(agg.coordinator.getSessionFocus(SID), undefined, 'session focus cleared');

    // Next call without focus → no focus active (no response focus field)
    const result = await agg.callTool('ch1tty/search', { query: 'invoices' }, SID);
    const data = parse(result);
    assert.equal(data.focus, undefined, 'no focus active after clearing');
  } finally {
    await agg.coordinator.onSessionEnd(SID);
    await agg.shutdown();
  }
});

// ── 4. cast: explicit focus param → stored as session-sticky focus ────────────

test('sticky focus: explicit focus on cast is persisted for the session', async () => {
  const agg = makeAgg(undefined, '4-cast-store');
  const SID = 'session-4';
  await agg.coordinator.onSessionStart(SID, 'http');
  try {
    // Cast with an explicit focus (intent doesn't need to resolve)
    await agg.callTool('ch1tty/cast', { intent: 'list invoices', focus: 'finance' }, SID);
    assert.equal(agg.coordinator.getSessionFocus(SID), 'finance', 'cast persists focus to session');
  } finally {
    await agg.coordinator.onSessionEnd(SID);
    await agg.shutdown();
  }
});

// ── 5. cast sets focus → subsequent search uses it ────────────────────────────

test('sticky focus: focus set by cast is used in subsequent search', async () => {
  const agg = makeAgg(undefined, '5-cross-meta');
  const SID = 'session-5';
  await agg.coordinator.onSessionStart(SID, 'http');
  try {
    // Set focus via cast
    await agg.callTool('ch1tty/cast', { intent: 'list invoices', focus: 'finance' }, SID);

    // Search without explicit focus — should inherit from session
    const result = await agg.callTool('ch1tty/search', { query: 'invoices' }, SID);
    const data = parse(result);
    assert.equal(data.focus, 'finance', 'search uses focus set by cast');
  } finally {
    await agg.coordinator.onSessionEnd(SID);
    await agg.shutdown();
  }
});

// ── 6. session isolation: sticky focus in session A does not affect session B ─

test('sticky focus: session focus is isolated per session', async () => {
  const agg = makeAgg(undefined, '6-isolation');
  const SID_A = 'session-A';
  const SID_B = 'session-B';
  await agg.coordinator.onSessionStart(SID_A, 'http');
  await agg.coordinator.onSessionStart(SID_B, 'http');
  try {
    // Set focus only on session A
    await agg.callTool('ch1tty/search', { focus: 'finance' }, SID_A);

    // Session B should have no sticky focus
    assert.equal(agg.coordinator.getSessionFocus(SID_B), undefined, 'session B has no focus');

    // Search from session B without focus → no focus active
    const resultB = await agg.callTool('ch1tty/search', { query: 'invoices' }, SID_B);
    const dataB = parse(resultB);
    assert.equal(dataB.focus, undefined, 'session B search has no focus');
  } finally {
    await agg.coordinator.onSessionEnd(SID_A);
    await agg.coordinator.onSessionEnd(SID_B);
    await agg.shutdown();
  }
});

// ── 7. process default used when no session focus and no per-call focus ────────

test('sticky focus: process default CH1TTY_FOCUS used when no session focus is set', async () => {
  const agg = makeAgg('governance', '7-env-fallback');
  const SID = 'session-7';
  await agg.coordinator.onSessionStart(SID, 'http');
  try {
    // No explicit focus, no session-stored focus → falls back to env default "governance"
    const result = await agg.callTool('ch1tty/search', { query: 'compliance' }, SID);
    const data = parse(result);
    assert.equal(data.focus, 'governance', 'env default focus is used as final fallback');
  } finally {
    await agg.coordinator.onSessionEnd(SID);
    await agg.shutdown();
  }
});
