/**
 * T: ch1tty/status session focus reporting
 *
 * When a session has a sticky focus set (via an explicit `focus` param on
 * ch1tty/search or ch1tty/cast), the coordinator snapshot surfaces it as
 * `sessionFocus` on the matching session entry under `coordinator.sessions`.
 *
 * Rules:
 * - Sessions with no sticky focus → no `sessionFocus` field on the entry
 * - Sessions with a sticky focus → `sessionFocus: "<name>"` on the entry
 * - Clearing via `focus:"none"` → `sessionFocus` absent on the entry
 * - Multiple sessions → independent `sessionFocus` per session
 * - Process-level env focus does not write `sessionFocus` on session entries
 *
 * Tests:
 *   1. No active sessions → coordinator.sessions is []
 *   2. Session with no focus set → no sessionFocus field
 *   3. Focus set via search → sessionFocus in coordinator.sessions
 *   4. Focus cleared via focus:"none" → sessionFocus absent
 *   5. Two sessions with different focus → independent sessionFocus per session
 *   6. Focus set via cast → sessionFocus in coordinator.sessions
 *   7. Process default env focus does not write sessionFocus on session entries
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-ssf-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'list_invoices', description: 'List Stripe invoices for finance and billing', inputSchema: { type: 'object', properties: {} } },
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

const FOCUS_PROFILES = {
  profiles: {
    finance: { categories: ['ecosystem'], servers: ['stripe'], boost: 0.5 },
    code: { categories: ['search'], servers: ['context7'], boost: 0.5 },
  },
};

const backends = new Map<string, Backend>([
  ['stripe', makeStaticBackend(STRIPE_TOOLS)],
  ['context7', makeStaticBackend(CONTEXT7_TOOLS)],
]);

function makeAgg(opts: { envFocus?: string; label?: string } = {}): Aggregator {
  const label = opts.label ?? 'test';
  return new Aggregator([STRIPE_CFG, CONTEXT7_CFG], {
    backendFactory: (cfg) => backends.get(cfg.id) ?? makeStaticBackend([]),
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: {},
    embedEnabled: false,
    ledgerDlqPath: dlqPath(label),
    ...(opts.envFocus ? { focus: opts.envFocus } : {}),
  });
}

type SessionEntry = { sessionId: string; sessionFocus?: string };

function parse(result: ToolCallResult): Record<string, unknown> {
  return JSON.parse(result.content[0].text as string);
}

// ── 1. No active sessions → coordinator.sessions is [] ───────────────────────

test('status: no active sessions → coordinator.sessions is []', async () => {
  const agg = makeAgg({ label: '1' });
  const snap = agg.getStatusSnapshot();
  assert.deepEqual(snap.coordinator.sessions, []);
});

// ── 2. Session with no focus set → no sessionFocus field on entry ─────────────

test('status: session with no focus set → no sessionFocus field on entry', async () => {
  const agg = makeAgg({ label: '2' });
  const SID = 'sess-nofocus';
  await agg.coordinator.onSessionStart(SID, 'http');
  // Search without explicit focus — session created but no sticky focus
  await agg.callTool('ch1tty/search', { query: 'invoice' }, SID);
  const snap = agg.getStatusSnapshot();
  const entry = snap.coordinator.sessions.find((s: SessionEntry) => s.sessionId === SID);
  assert.ok(entry, 'session entry present');
  assert.ok(!('sessionFocus' in entry), 'sessionFocus absent when no focus set');
});

// ── 3. Focus set via search → sessionFocus in coordinator.sessions ─────────────

test('status: focus set via search → sessionFocus in coordinator.sessions', async () => {
  const agg = makeAgg({ label: '3' });
  const SID = 'sess-finance';
  await agg.coordinator.onSessionStart(SID, 'http');
  await agg.callTool('ch1tty/search', { query: 'invoice', focus: 'finance' }, SID);
  const snap = agg.getStatusSnapshot();
  const entry = snap.coordinator.sessions.find((s: SessionEntry) => s.sessionId === SID);
  assert.ok(entry, 'session entry present');
  assert.equal(entry.sessionFocus, 'finance');
});

// ── 4. Focus cleared via focus:"none" → sessionFocus absent ───────────────────

test('status: focus cleared via focus:"none" → sessionFocus absent', async () => {
  const agg = makeAgg({ label: '4' });
  const SID = 'sess-clear';
  await agg.coordinator.onSessionStart(SID, 'http');
  await agg.callTool('ch1tty/search', { query: 'invoice', focus: 'finance' }, SID);
  await agg.callTool('ch1tty/search', { query: 'invoice', focus: 'none' }, SID);
  const snap = agg.getStatusSnapshot();
  const entry = snap.coordinator.sessions.find((s: SessionEntry) => s.sessionId === SID);
  assert.ok(entry, 'session entry present');
  assert.ok(!('sessionFocus' in entry), 'sessionFocus absent after clearing');
});

// ── 5. Two sessions with different focus → independent sessionFocus ────────────

test('status: two sessions with different focus → independent sessionFocus', async () => {
  const agg = makeAgg({ label: '5' });
  const SID_A = 'sess-A';
  const SID_B = 'sess-B';
  await agg.coordinator.onSessionStart(SID_A, 'http');
  await agg.coordinator.onSessionStart(SID_B, 'http');
  await agg.callTool('ch1tty/search', { query: 'invoice', focus: 'finance' }, SID_A);
  await agg.callTool('ch1tty/search', { query: 'library', focus: 'code' }, SID_B);
  const snap = agg.getStatusSnapshot();
  const entryA = snap.coordinator.sessions.find((s: SessionEntry) => s.sessionId === SID_A);
  const entryB = snap.coordinator.sessions.find((s: SessionEntry) => s.sessionId === SID_B);
  assert.equal(entryA?.sessionFocus, 'finance');
  assert.equal(entryB?.sessionFocus, 'code');
});

// ── 6. Focus set via cast → sessionFocus in coordinator.sessions ──────────────

test('status: focus set via cast → sessionFocus in coordinator.sessions', async () => {
  const agg = makeAgg({ label: '6' });
  const SID = 'sess-cast';
  await agg.coordinator.onSessionStart(SID, 'http');
  await agg.callTool('ch1tty/cast', { intent: 'list invoices', focus: 'finance' }, SID);
  const snap = agg.getStatusSnapshot();
  const entry = snap.coordinator.sessions.find((s: SessionEntry) => s.sessionId === SID);
  assert.ok(entry, 'session entry present');
  assert.equal(entry.sessionFocus, 'finance');
});

// ── 7. Process default env focus does not write sessionFocus on entries ────────

test('status: process default env focus does not write sessionFocus on entries', async () => {
  const agg = makeAgg({ envFocus: 'finance', label: '7' });
  const SID = 'sess-envfocus';
  await agg.coordinator.onSessionStart(SID, 'http');
  // Call search without explicit focus — session uses env default but should not write sessionFocus
  await agg.callTool('ch1tty/search', { query: 'invoice' }, SID);
  const snap = agg.getStatusSnapshot();
  // Top-level focus reported from env
  assert.equal(snap.focus?.active, 'finance');
  // Session entry has no sessionFocus — env default is not sticky-written
  const entry = snap.coordinator.sessions.find((s: SessionEntry) => s.sessionId === SID);
  assert.ok(entry, 'session entry present');
  assert.ok(!('sessionFocus' in entry), 'env default focus not written as sessionFocus');
});
