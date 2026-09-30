/**
 * GDU drift guard: freeze the runtime types of recentTools items in
 * ch1tty/execute sessionContext.
 *
 * execute-session-context.test.ts verifies that recentTools.includes(tool)
 * and that the array length is capped at 5, but does NOT assert the runtime
 * type of each item. A change that serialises items as {tool, count} objects
 * instead of plain strings would pass those tests silently.
 *
 * Key invariants:
 *   GDU-1: recentTools is an Array (not undefined, null, or non-array)
 *   GDU-2: every item in recentTools is typeof 'string'
 *   GDU-3: every item in recentTools is non-empty
 *   GDU-4: every item in recentTools contains '/' (namespaced server/tool format)
 *   GDU-5: after N distinct tool calls, recentTools has no duplicates
 *
 * Frozen 2026-09-28.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig, ToolCallResult } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Test infrastructure ───────────────────────────────────────────────────────

function dlq(): string {
  return join(tmpdir(), `ch1tty-gdu-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
}

const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code',
  endpoint: 'https://neon.test/mcp',
};
const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem',
  endpoint: 'https://stripe.test/mcp',
};

function makeAgg(): { agg: Aggregator; backend: FixtureBackend } {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  const agg = new Aggregator([NEON_CFG, STRIPE_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    suggestionsCatalog: {},
  });
  return { agg, backend };
}

const SESSION = 'gdu-session-001';

/** Extract sessionContext from a live execute response (content[1]). */
function getRecentTools(result: ToolCallResult): unknown[] | undefined {
  if (result.isError) return undefined;
  for (const item of result.content) {
    if (item.type !== 'text') continue;
    try {
      const parsed = JSON.parse(item.text) as Record<string, unknown>;
      if (parsed.sessionContext && typeof parsed.sessionContext === 'object') {
        const sc = parsed.sessionContext as Record<string, unknown>;
        if ('recentTools' in sc) return sc.recentTools as unknown[];
      }
    } catch {
      // skip non-JSON items
    }
  }
  return undefined;
}

// ── GDU-1: recentTools is an Array ───────────────────────────────────────────

test('GDU-1: execute with sessionId → recentTools is an Array', async () => {
  const { agg } = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/execute', {
      tool: 'neon/list_projects', args: {}, sessionId: SESSION,
    });
    const rt = getRecentTools(result);
    assert.ok(rt !== undefined, 'sessionContext.recentTools must be present');
    assert.ok(Array.isArray(rt), `recentTools must be an Array, got ${typeof rt}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GDU-2: every item is typeof 'string' ─────────────────────────────────────

test('GDU-2: execute with sessionId → every recentTools item is typeof string', async () => {
  const { agg } = makeAgg();
  try {
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: SESSION });
    const result = await agg.callTool('ch1tty/execute', { tool: 'stripe/list_payments', args: {}, sessionId: SESSION });
    const rt = getRecentTools(result);
    assert.ok(Array.isArray(rt) && rt.length > 0, 'recentTools must be non-empty after two calls');
    for (const item of rt) {
      assert.equal(
        typeof item,
        'string',
        `recentTools item must be typeof string, got typeof ${typeof item}: ${JSON.stringify(item)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GDU-3: every item is non-empty ───────────────────────────────────────────

test('GDU-3: execute with sessionId → every recentTools item is non-empty', async () => {
  const { agg } = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/execute', {
      tool: 'neon/list_projects', args: {}, sessionId: SESSION,
    });
    const rt = getRecentTools(result);
    assert.ok(Array.isArray(rt) && rt.length > 0, 'recentTools must be non-empty');
    for (const item of rt) {
      assert.ok(typeof item === 'string' && item.length > 0, `recentTools item must be non-empty string, got ${JSON.stringify(item)}`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GDU-4: every item is in namespaced server/tool format ────────────────────

test('GDU-4: execute with sessionId → every recentTools item contains "/" (namespaced format)', async () => {
  const { agg } = makeAgg();
  try {
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: SESSION });
    const result = await agg.callTool('ch1tty/execute', { tool: 'stripe/list_payments', args: {}, sessionId: SESSION });
    const rt = getRecentTools(result);
    assert.ok(Array.isArray(rt) && rt.length > 0, 'recentTools must be non-empty after two calls');
    for (const item of rt) {
      assert.ok(
        typeof item === 'string' && item.includes('/'),
        `recentTools item must be namespaced (server/tool), got ${JSON.stringify(item)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GDU-5: distinct calls produce no duplicates in recentTools ───────────────

test('GDU-5: after 3 distinct tool calls → recentTools has no duplicates', async () => {
  const { agg } = makeAgg();
  try {
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: SESSION });
    await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql', args: {}, sessionId: SESSION });
    const result = await agg.callTool('ch1tty/execute', { tool: 'stripe/list_payments', args: {}, sessionId: SESSION });
    const rt = getRecentTools(result);
    assert.ok(Array.isArray(rt), 'recentTools must be an Array');
    const unique = new Set(rt);
    assert.equal(unique.size, rt.length, `recentTools must have no duplicate entries, got ${JSON.stringify(rt)}`);
  } finally {
    await agg.shutdown();
  }
});
