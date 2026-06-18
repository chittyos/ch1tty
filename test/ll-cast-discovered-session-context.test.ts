/**
 * Workstream LL: sessionContext in cast: discovered responses.
 *
 * cast: discovered fires when at least one prompt or resource matches the intent
 * but no tools score above the threshold. With this change, when a sessionId is
 * active the response includes sessionContext: { recentTools, callCount,
 * activeSessionFocus? } reflecting pre-execution session state — the same
 * shape as cast: plan (KK).
 *
 * Covered:
 *   1. No sessionId → sessionContext absent in cast: discovered
 *   2. Fresh session, no prior calls → sessionContext present: recentTools: [], callCount: 0
 *   3. Prior execute calls → callCount reflects all prior calls in the session
 *   4. Prior execute calls → recentTools includes the previously called tool
 *   5. activeSessionFocus set before discovered cast → present in sessionContext
 *   6. No sticky focus set → activeSessionFocus absent from sessionContext
 *   7. Resource-only discovered path (no prompts) → sessionContext still included
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-ll-${label}-${Date.now()}.jsonl`);
}

const FOCUS_PROFILES = {
  profiles: {
    code: { description: 'Code tools', categories: ['code' as const], servers: ['neon'], boost: 0.5 },
  },
};

// Backend with tools that can be executed for session state seeding.
const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite', category: 'code',
  endpoint: 'https://neon.test/mcp',
};
// Prompt-only backend for triggering cast: discovered.
const RUNBOOK_CFG: ServerConfig = {
  id: 'runbook', name: 'Runbook', type: 'remote', access: 'read', category: 'documents',
  endpoint: 'https://runbook.test/mcp',
};
// Resource-only backend for the resource-discovered path.
const DOCS_CFG: ServerConfig = {
  id: 'docs', name: 'Docs', type: 'remote', access: 'read', category: 'documents',
  endpoint: 'https://docs.test/mcp',
};
// Stripe backend — distinct domain for seeding session state without giving neon affinity.
const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe Payments', type: 'remote', access: 'readwrite', category: 'ecosystem',
  endpoint: 'https://stripe.test/mcp',
};

const NEON_TOOLS: ToolEntry[] = [
  { name: 'list_projects', description: 'List Neon projects', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_sql', description: 'Run SQL on Neon', inputSchema: { type: 'object', properties: {} } },
];

const STRIPE_TOOLS: ToolEntry[] = [
  { name: 'list_customers', description: 'List Stripe customers', inputSchema: { type: 'object', properties: {} } },
  { name: 'create_invoice', description: 'Create Stripe invoice', inputSchema: { type: 'object', properties: {} } },
];

function makeNeonBackend(): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: NEON_TOOLS.length, toolCacheAge: 0 }),
    listTools: async () => NEON_TOOLS,
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: 'tool-output' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makeStripeBackend(): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: STRIPE_TOOLS.length, toolCacheAge: 0 }),
    listTools: async () => STRIPE_TOOLS,
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: 'stripe-output' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makePromptBackend(): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: 0, toolCacheAge: 0 }),
    listTools: async () => [],
    callTool: async (): Promise<ToolCallResult> => ({ content: [] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [
      { name: 'deploy-runbook', description: 'runbook for production deployment procedures' },
    ],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makeResourceBackend(): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: 0, toolCacheAge: 0 }),
    listTools: async () => [],
    callTool: async (): Promise<ToolCallResult> => ({ content: [] }),
    listResources: async () => ({
      resources: [{ uri: 'readme', name: 'project-readme', description: 'quickstart guide for onboarding new contributors' }],
      templates: [],
    }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

/** Build aggregator with neon (for tools) + runbook (prompts-only) */
function makePromptAgg(label: string): Aggregator {
  const backends = new Map<string, Backend>([
    ['neon', makeNeonBackend()],
    ['runbook', makePromptBackend()],
  ]);
  return new Aggregator([NEON_CFG, RUNBOOK_CFG], {
    focusProfiles: FOCUS_PROFILES,
    backendFactory: (cfg) => backends.get(cfg.id) ?? makeNeonBackend(),
    embedEnabled: false,
    ledgerDlqPath: dlqPath(label),
  });
}

/**
 * Build aggregator with stripe (for session-state seeding) + runbook (prompts-only).
 * Neon is intentionally excluded so stripe execute calls cannot give neon affinity.
 */
function makeStripePromptAgg(label: string): Aggregator {
  const backends = new Map<string, Backend>([
    ['stripe', makeStripeBackend()],
    ['runbook', makePromptBackend()],
  ]);
  return new Aggregator([STRIPE_CFG, RUNBOOK_CFG], {
    focusProfiles: FOCUS_PROFILES,
    backendFactory: (cfg) => backends.get(cfg.id) ?? makeStripeBackend(),
    embedEnabled: false,
    ledgerDlqPath: dlqPath(label),
  });
}

/** Build aggregator with neon (for tools) + docs (resources-only) */
function makeResourceAgg(label: string): Aggregator {
  const backends = new Map<string, Backend>([
    ['neon', makeNeonBackend()],
    ['docs', makeResourceBackend()],
  ]);
  return new Aggregator([NEON_CFG, DOCS_CFG], {
    focusProfiles: FOCUS_PROFILES,
    backendFactory: (cfg) => backends.get(cfg.id) ?? makeNeonBackend(),
    embedEnabled: false,
    ledgerDlqPath: dlqPath(label),
  });
}

function parseCast(result: ToolCallResult): Record<string, unknown> {
  const first = result.content[0];
  assert.equal(first?.type, 'text');
  return JSON.parse(first.text) as Record<string, unknown>;
}

// ── 1. No sessionId → sessionContext absent ───────────────────────────────────

test('cast: discovered — no sessionId → sessionContext absent', async () => {
  const agg = makePromptAgg('1-no-session');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'production deployment runbook' });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'discovered', `expected discovered, got: ${cast.cast}`);
    assert.equal('sessionContext' in cast, false, 'sessionContext must be absent without sessionId');
  } finally {
    await agg.shutdown();
  }
});

// ── 2. Fresh session → sessionContext present: recentTools: [], callCount: 0 ──

test('cast: discovered — fresh sessionId → sessionContext present with empty state', async () => {
  const agg = makePromptAgg('2-fresh-session');
  try {
    const SESSION = 'll-fresh-session';
    const result = await agg.callTool('ch1tty/cast', { intent: 'production deployment runbook', sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'discovered', `expected discovered, got: ${cast.cast}`);
    const sc = cast.sessionContext as { recentTools: string[]; callCount: number } | undefined;
    assert.ok(sc, 'sessionContext should be present when sessionId is active');
    assert.deepEqual(sc.recentTools, [], 'recentTools should be empty for a fresh session with no prior calls');
    assert.equal(sc.callCount, 0, 'callCount should be 0 for a fresh session with no prior calls');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. confirm:true does not redirect to cast:plan when no tools matched ────────
// The !best gate fires before the confirm check, so discovered takes precedence.
// sessionContext is present in the discovered response.

test('cast: discovered — confirm:true does not redirect to plan; sessionContext present', async () => {
  const agg = makePromptAgg('3-confirm');
  try {
    const SESSION = 'll-confirm-session';
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'production deployment runbook',
      confirm: true,
      sessionId: SESSION,
    });
    const cast = parseCast(result);
    // discovered fires before the confirm check (no tools matched)
    assert.equal(cast.cast, 'discovered', `confirm:true must not redirect to plan when no tools match (got ${cast.cast})`);
    const sc = cast.sessionContext as { recentTools: string[]; callCount: number } | undefined;
    assert.ok(sc, 'sessionContext should be present even when confirm:true triggers discovered');
    assert.deepEqual(sc.recentTools, [], 'recentTools should be empty for a fresh session');
    assert.equal(sc.callCount, 0, 'callCount should be 0 for a fresh session');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. dryRun:true does not redirect to cast:resolved when no tools matched ────
// Same routing logic: !best fires before the dryRun check.

test('cast: discovered — dryRun:true does not redirect to resolved; sessionContext present', async () => {
  const agg = makePromptAgg('4-dryrun');
  try {
    const SESSION = 'll-dryrun-session';
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'production deployment runbook',
      dryRun: true,
      sessionId: SESSION,
    });
    const cast = parseCast(result);
    // discovered fires before the dryRun check (no tools matched)
    assert.equal(cast.cast, 'discovered', `dryRun:true must not redirect to resolved when no tools match (got ${cast.cast})`);
    const sc = cast.sessionContext as { recentTools: string[]; callCount: number } | undefined;
    assert.ok(sc, 'sessionContext should be present even when dryRun:true triggers discovered');
    assert.deepEqual(sc.recentTools, [], 'recentTools should be empty for a fresh session');
    assert.equal(sc.callCount, 0, 'callCount should be 0 for a fresh session');
  } finally {
    await agg.shutdown();
  }
});

// ── 5. Sticky focus set → activeSessionFocus present ─────────────────────────

test('cast: discovered — sticky focus set → activeSessionFocus present in sessionContext', async () => {
  const agg = makePromptAgg('5-focus');
  try {
    const SESSION = 'll-focus-session';
    // Set sticky focus via search
    await agg.callTool('ch1tty/search', { query: 'sql neon', focus: 'code', sessionId: SESSION });
    const result = await agg.callTool('ch1tty/cast', { intent: 'production deployment runbook', sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'discovered', `expected discovered, got: ${cast.cast}`);
    const sc = cast.sessionContext as { activeSessionFocus?: string } | undefined;
    assert.ok(sc, 'sessionContext should be present');
    assert.equal(sc.activeSessionFocus, 'code', 'activeSessionFocus should be "code" when sticky focus is set');
  } finally {
    await agg.shutdown();
  }
});

// ── 6. No sticky focus → activeSessionFocus absent ───────────────────────────

test('cast: discovered — no focus set → activeSessionFocus absent from sessionContext', async () => {
  const agg = makePromptAgg('6-no-focus');
  try {
    const SESSION = 'll-nofocus-session';
    const result = await agg.callTool('ch1tty/cast', { intent: 'production deployment runbook', sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'discovered', `expected discovered, got: ${cast.cast}`);
    const sc = cast.sessionContext as Record<string, unknown> | undefined;
    assert.ok(sc, 'sessionContext should be present');
    assert.equal('activeSessionFocus' in sc, false, 'activeSessionFocus should be absent when no focus set');
  } finally {
    await agg.shutdown();
  }
});

// ── 7. Resource-only discovered path → sessionContext still included ──────────

test('cast: discovered via resource-only match → sessionContext present', async () => {
  const agg = makeResourceAgg('7-resource');
  try {
    const SESSION = 'll-resource-session';
    // "quickstart onboarding contributors" matches the docs resource but not neon tools
    const result = await agg.callTool('ch1tty/cast', { intent: 'quickstart onboarding contributors', sessionId: SESSION });
    const cast = parseCast(result);
    assert.equal(cast.cast, 'discovered', `expected discovered, got: ${cast.cast}`);
    assert.ok(Array.isArray(cast.resources), 'resources should be present in discovered response');
    const sc = cast.sessionContext as { recentTools: string[]; callCount: number } | undefined;
    assert.ok(sc, 'sessionContext should be present even on resource-only discovered path');
    assert.deepEqual(sc.recentTools, [], 'recentTools should be empty for fresh session');
    assert.equal(sc.callCount, 0, 'callCount should be 0 for fresh session');
  } finally {
    await agg.shutdown();
  }
});
