/**
 * EE: enrich `recentlyUsed` in ch1tty/search results with per-tool callCount + lastUsedMs.
 *
 * Previously `recentlyUsed: true` fired whenever any tool from the same server had been
 * called in the session (server-level granularity). Now:
 *   - When the exact tool was called: `recentlyUsed: { callCount: N, lastUsedMs: T }`
 *   - When only the server was used (not this specific tool): `recentlyUsed: true` (unchanged)
 *   - When neither: no `recentlyUsed` field
 *
 * Covered:
 *   1. Tool called once in session → recentlyUsed: { callCount: 1, lastUsedMs: <number> }
 *   2. Tool called twice → callCount: 2
 *   3. Server used (different tool executed) → recentlyUsed: true (server-level fallback)
 *   4. No tool calls in session → no recentlyUsed field
 *   5. No sessionId → no recentlyUsed even for matching server
 *   6. explain: true → topCandidates carries richer recentlyUsed object
 *   7. lastUsedMs is a recent epoch-ms timestamp
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-recentlyused-rich-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const CONTEXT7_CFG: ServerConfig = {
  id: 'context7', name: 'Context7', type: 'remote', access: 'readwrite',
  category: 'search', endpoint: 'https://context7.test/mcp',
};

function makeAgg(label: string) {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', {
    tools: [
      {
        name: 'list_invoices',
        description: 'List Stripe invoices for billing and finance reporting',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '[]' }] },
      },
      {
        name: 'list_charges',
        description: 'List Stripe charges for payment tracking',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '[]' }] },
      },
    ],
  });
  backend.defineServer('context7', {
    tools: [{
      name: 'get-library-docs',
      description: 'Retrieve library documentation by library ID',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: 'docs' }] },
    }],
  });
  const dlq = dlqPath(label);
  const coordinator = new KeywordOnlyCoordinator({}, { enabled: false }, dlq);
  const agg = new Aggregator([STRIPE_CFG, CONTEXT7_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq,
    coordinator,
  });
  return { agg, coordinator };
}

function text(r: Awaited<ReturnType<Aggregator['callTool']>>): Record<string, unknown> {
  return JSON.parse((r.content[0] as { text: string }).text);
}

test('recentlyUsed: exact tool called → { callCount: 1, lastUsedMs: N }', async () => {
  const { agg, coordinator } = makeAgg('t1');
  await coordinator.onSessionStart('s1', 'http');
  await agg.callTool('ch1tty/execute', { tool: 'stripe/list_invoices', args: {}, sessionId: 's1' });

  const result = text(await agg.callTool('ch1tty/search', { query: 'invoices', sessionId: 's1' }));
  const tool = (result.tools as Array<Record<string, unknown>>).find((t) => t.tool === 'stripe/list_invoices');
  assert.ok(tool, 'stripe/list_invoices must appear in results');
  const ru = tool.recentlyUsed as { callCount: number; lastUsedMs: number } | undefined;
  assert.ok(ru && typeof ru === 'object', 'recentlyUsed must be an object');
  assert.equal(ru.callCount, 1);
  assert.equal(typeof ru.lastUsedMs, 'number');
});

test('recentlyUsed: exact tool called twice → callCount: 2', async () => {
  const { agg, coordinator } = makeAgg('t2');
  await coordinator.onSessionStart('s2', 'http');
  await agg.callTool('ch1tty/execute', { tool: 'stripe/list_invoices', args: {}, sessionId: 's2' });
  await agg.callTool('ch1tty/execute', { tool: 'stripe/list_invoices', args: {}, sessionId: 's2' });

  const result = text(await agg.callTool('ch1tty/search', { query: 'invoices', sessionId: 's2' }));
  const tool = (result.tools as Array<Record<string, unknown>>).find((t) => t.tool === 'stripe/list_invoices');
  assert.ok(tool, 'stripe/list_invoices must appear in results');
  const ru = tool.recentlyUsed as { callCount: number } | undefined;
  assert.ok(ru && typeof ru === 'object', 'recentlyUsed must be an object');
  assert.equal(ru.callCount, 2);
});

test('recentlyUsed: server used but not this tool → true (server-level fallback)', async () => {
  const { agg, coordinator } = makeAgg('t3');
  await coordinator.onSessionStart('s3', 'http');
  // Execute list_invoices — establishes stripe server affinity but not list_charges pattern
  await agg.callTool('ch1tty/execute', { tool: 'stripe/list_invoices', args: {}, sessionId: 's3' });

  const result = text(await agg.callTool('ch1tty/search', { query: 'charges', sessionId: 's3' }));
  const tool = (result.tools as Array<Record<string, unknown>>).find((t) => t.tool === 'stripe/list_charges');
  assert.ok(tool, 'stripe/list_charges must appear in results');
  // list_charges was never called directly — only the server was used → boolean true
  assert.equal(tool.recentlyUsed, true);
});

test('recentlyUsed: no tool calls in session → no recentlyUsed field', async () => {
  const { agg, coordinator } = makeAgg('t4');
  await coordinator.onSessionStart('s4', 'http');

  const result = text(await agg.callTool('ch1tty/search', { query: 'invoices stripe', sessionId: 's4' }));
  const tool = (result.tools as Array<Record<string, unknown>>).find((t) => t.tool === 'stripe/list_invoices');
  assert.ok(tool, 'stripe/list_invoices must appear in results');
  assert.equal(tool.recentlyUsed, undefined);
});

test('recentlyUsed: no sessionId → no recentlyUsed even for matching server', async () => {
  const { agg, coordinator } = makeAgg('t5');
  await coordinator.onSessionStart('s5-other', 'http');
  await agg.callTool('ch1tty/execute', { tool: 'stripe/list_invoices', args: {}, sessionId: 's5-other' });

  // Search without a sessionId — cannot look up patterns
  const result = text(await agg.callTool('ch1tty/search', { query: 'invoices' }));
  const tool = (result.tools as Array<Record<string, unknown>>).find((t) => t.tool === 'stripe/list_invoices');
  assert.ok(tool, 'stripe/list_invoices must appear in results');
  assert.equal(tool.recentlyUsed, undefined);
});

test('explain: true — topCandidates carries richer recentlyUsed object', async () => {
  const { agg, coordinator } = makeAgg('t6');
  await coordinator.onSessionStart('s6', 'http');
  await agg.callTool('ch1tty/execute', { tool: 'stripe/list_invoices', args: {}, sessionId: 's6' });

  const result = text(await agg.callTool('ch1tty/search', { query: 'invoices', explain: true, sessionId: 's6' }));
  const explanation = result.explanation as Record<string, unknown>;
  assert.ok(explanation, 'explanation must be present');
  const candidates = explanation.topCandidates as Array<Record<string, unknown>>;
  const candidate = candidates.find((c) => c.tool === 'stripe/list_invoices');
  assert.ok(candidate, 'stripe/list_invoices must be in topCandidates');
  const ru = candidate.recentlyUsed as { callCount: number; lastUsedMs: number } | undefined;
  assert.ok(ru && typeof ru === 'object', 'topCandidates recentlyUsed must be an object when tool was called');
  assert.equal(ru.callCount, 1);
});

test('lastUsedMs is a recent epoch-ms timestamp', async () => {
  const { agg, coordinator } = makeAgg('t7');
  await coordinator.onSessionStart('s7', 'http');
  const before = Date.now();
  await agg.callTool('ch1tty/execute', { tool: 'stripe/list_invoices', args: {}, sessionId: 's7' });
  const after = Date.now();

  const result = text(await agg.callTool('ch1tty/search', { query: 'invoices', sessionId: 's7' }));
  const tool = (result.tools as Array<Record<string, unknown>>).find((t) => t.tool === 'stripe/list_invoices');
  assert.ok(tool, 'stripe/list_invoices must appear in results');
  const ru = tool.recentlyUsed as { callCount: number; lastUsedMs: number } | undefined;
  assert.ok(ru && typeof ru === 'object', 'recentlyUsed must be an object');
  assert.ok(ru.lastUsedMs >= before, `lastUsedMs (${ru.lastUsedMs}) must be >= before (${before})`);
  assert.ok(ru.lastUsedMs <= after + 100, `lastUsedMs (${ru.lastUsedMs}) must be near after (${after})`);
});
