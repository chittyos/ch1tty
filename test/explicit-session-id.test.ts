/**
 * DD: explicit sessionId parameter on ch1tty/search, ch1tty/execute, ch1tty/cast.
 *
 * Stateless HTTP server-to-server callers that do not maintain long-lived MCP
 * transport sessions cannot participate in coordinator session tracking (sticky
 * focus, affinity, topTools) unless they pass an explicit session identifier.
 *
 * The sessionId param in args overrides the transport-derived sessionId so that
 * any caller can opt into session tracking by naming their session.
 *
 * Priority: args.sessionId > transport sessionId.
 *
 * Covered:
 *   1. search: args.sessionId → sticky focus is set, retrievable via coordinator
 *   2. search: subsequent call uses session-sticky focus set via explicit sessionId
 *   3. execute: args.sessionId → tool call recorded in coordinator topTools
 *   4. cast: args.sessionId → sticky focus persists, retrievable via coordinator
 *   5. cast sets focus via args.sessionId → subsequent search with same sessionId uses it
 *   6. args.sessionId overrides transport sessionId (tracking under the explicit id)
 *   7. sessionId param visible in ch1tty/search inputSchema
 *   8. sessionId param visible in ch1tty/execute and ch1tty/cast inputSchema
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
  return join(tmpdir(), `ch1tty-explicit-sid-${label}-${Date.now()}.jsonl`);
}

const STRIPE_CFG: ServerConfig = {
  id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite',
  category: 'ecosystem', endpoint: 'https://stripe.test/mcp',
};
const CONTEXT7_CFG: ServerConfig = {
  id: 'context7', name: 'Context7', type: 'remote', access: 'readwrite',
  category: 'search', endpoint: 'https://context7.test/mcp',
};

const FOCUS_PROFILES = {
  profiles: {
    finance: { description: 'Finance', categories: ['ecosystem'], servers: ['stripe'], boost: 0.5 },
  },
};

function makeAgg(label: string) {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', {
    tools: [{
      name: 'list_invoices',
      description: 'List Stripe invoices for billing and finance reporting',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '[]' }] },
    }],
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
  const coordinator = new KeywordOnlyCoordinator(FOCUS_PROFILES, { enabled: false }, dlq);
  const agg = new Aggregator([STRIPE_CFG, CONTEXT7_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq,
    coordinator,
    focusProfiles: FOCUS_PROFILES,
  });
  return { agg, coordinator };
}

function text(r: Awaited<ReturnType<Aggregator['callTool']>>): Record<string, unknown> {
  return JSON.parse((r.content[0] as { text: string }).text);
}

test('search: args.sessionId sets sticky focus via coordinator', async () => {
  const { agg, coordinator } = makeAgg('t1');
  await coordinator.onSessionStart('explicit-s1', 'http');
  await agg.callTool('ch1tty/search', { query: 'invoices', focus: 'finance', sessionId: 'explicit-s1' });
  assert.equal(coordinator.getSessionFocus('explicit-s1'), 'finance');
});

test('search: subsequent call with same args.sessionId inherits sticky focus', async () => {
  const { agg } = makeAgg('t2');
  // First call sets focus via args.sessionId (no transport session)
  await agg.callTool('ch1tty/search', { query: 'invoices', focus: 'finance', sessionId: 'sticky-s2' });
  // Second call omits focus but provides same sessionId — should inherit stored focus
  const r2 = await agg.callTool('ch1tty/search', { query: 'invoices', sessionId: 'sticky-s2' });
  assert.equal(text(r2).focus, 'finance');
});

test('execute: args.sessionId records tool call in coordinator topTools', async () => {
  const { agg, coordinator } = makeAgg('t3');
  await coordinator.onSessionStart('exec-s3', 'http');
  await agg.callTool('ch1tty/execute', { tool: 'stripe/list_invoices', sessionId: 'exec-s3' });
  const snap = coordinator.getSnapshot();
  const session = snap.sessions.find((s) => s.sessionId === 'exec-s3');
  assert.ok(session, 'session present in coordinator snapshot');
  assert.ok(session.topTools.includes('stripe/list_invoices'), 'tool recorded in topTools');
});

test('cast: args.sessionId sets sticky focus via coordinator', async () => {
  const { agg, coordinator } = makeAgg('t4');
  await coordinator.onSessionStart('cast-s4', 'http');
  await agg.callTool('ch1tty/cast', { intent: 'list my invoices', focus: 'finance', sessionId: 'cast-s4' });
  assert.equal(coordinator.getSessionFocus('cast-s4'), 'finance');
});

test('cast sets focus → subsequent search with same args.sessionId uses it', async () => {
  const { agg } = makeAgg('t5');
  // cast sets finance focus under explicit sessionId (no transport session)
  await agg.callTool('ch1tty/cast', { intent: 'list my invoices', focus: 'finance', sessionId: 'cross-s5' });
  // search with same sessionId — should pick up the stored focus
  const r = await agg.callTool('ch1tty/search', { query: 'invoices', sessionId: 'cross-s5' });
  assert.equal(text(r).focus, 'finance');
});

test('args.sessionId overrides transport sessionId for tracking', async () => {
  const { agg, coordinator } = makeAgg('t6');
  const transportSid = 'transport-s6';
  const explicitSid = 'explicit-s6';
  await coordinator.onSessionStart(transportSid, 'http');
  await coordinator.onSessionStart(explicitSid, 'http');
  // execute passes explicitSid in args; transport passes transportSid
  await agg.callTool('ch1tty/execute', { tool: 'stripe/list_invoices', sessionId: explicitSid }, transportSid);
  const snap = coordinator.getSnapshot();
  const explicitSession = snap.sessions.find((s) => s.sessionId === explicitSid);
  const transportSession = snap.sessions.find((s) => s.sessionId === transportSid);
  assert.ok(explicitSession?.topTools.includes('stripe/list_invoices'), 'tool under explicit sessionId');
  assert.deepEqual(transportSession?.topTools ?? [], [], 'transport session has no tool calls');
});

test('sessionId param visible in ch1tty/search inputSchema', async () => {
  const { agg } = makeAgg('t7');
  const { tools } = await agg.listAllTools();
  const searchTool = tools.find((t) => t.name === 'ch1tty/search');
  assert.ok(searchTool, 'search tool present');
  const props = (searchTool.inputSchema as { properties: Record<string, unknown> }).properties ?? {};
  assert.ok('sessionId' in props, 'sessionId property in search inputSchema');
  assert.equal((props['sessionId'] as { type: string }).type, 'string');
});

test('sessionId param visible in ch1tty/execute and ch1tty/cast inputSchema', async () => {
  const { agg } = makeAgg('t8');
  const { tools } = await agg.listAllTools();
  const executeTool = tools.find((t) => t.name === 'ch1tty/execute');
  const castTool = tools.find((t) => t.name === 'ch1tty/cast');
  assert.ok(executeTool && castTool, 'execute and cast tools present');
  const execProps = (executeTool.inputSchema as { properties: Record<string, unknown> }).properties ?? {};
  const castProps = (castTool.inputSchema as { properties: Record<string, unknown> }).properties ?? {};
  assert.ok('sessionId' in execProps, 'sessionId in execute schema');
  assert.ok('sessionId' in castProps, 'sessionId in cast schema');
});
