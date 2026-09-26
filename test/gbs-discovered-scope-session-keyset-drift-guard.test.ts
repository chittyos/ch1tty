/**
 * GBS drift guard: freeze cast:discovered exact key set for scope+session combos.
 *
 * Prior discovered exact-keyset coverage:
 *   GBC (PR #1500) : froze cast:discovered base key set (no scope, no session)
 *   GBH (PR #1509) : froze cast:discovered conditional keys — including
 *                    GBH-4 which confirms scope(servers)+no-session adds exactly
 *                    `scope` (base+1=7 keys). Also froze explain-only and
 *                    session-only additions (each +1 key).
 *
 * Gap: No test on main freezes the exact key set when BOTH scope AND sessionId
 * are present simultaneously in a cast:discovered call. A regression silently
 * injecting or dropping a key in that combined path would pass GBC, GBH, and
 * all prior tests.
 *
 * GBS closes that gap — parallel to GBR (executed scope+session), GBN (resolved
 * scope+session), and GBL (no_match scope+session):
 *
 *   GBS-1  scope(servers) + sessionId  → EXACTLY base + scope + sessionContext (8 keys)
 *   GBS-2  scope(categories) + sessionId → same 8 keys, different scope shape
 *   GBS-3  scope + session + explain → base + scope + sessionContext + explanation (9 keys)
 *   GBS-4  absence guard: scope w/o sessionId → sessionContext absent
 *   GBS-5  absence guard: sessionId w/o scope → scope absent
 *
 * cast:chain_executed does NOT include scope in its response (aggregator.ts
 * ~line 1527–1548 has no scopeAnnotation spread) — no chain_executed gap exists.
 *
 * Source: src-stdio/aggregator.ts lines ~1428–1443 (cast:discovered body).
 *
 * Frozen 2026-09-26.
 *
 * CLAUDE.md compliance:
 *   - Public MCP surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level
 *     cast:discovered key set, not the explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// Base set (GBC-1 / GBH-1): {cast, hint, intent, latencyMs, prompts, resolvedBy}
const DISCOVERED_BASE_KEYS: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'prompts', 'resolvedBy',
];

// scope + sessionContext both present.
const DISCOVERED_SCOPE_SESSION_KEYS: readonly string[] = [
  ...DISCOVERED_BASE_KEYS, 'scope', 'sessionContext',
];

// + explain.
const DISCOVERED_SCOPE_SESSION_EXPLAIN_KEYS: readonly string[] = [
  ...DISCOVERED_SCOPE_SESSION_KEYS, 'explanation',
].sort() as string[];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Keyword-only coordinator — keeps scoring deterministic.
class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// Billing fixture: one tool ("subscription" keywords) that does NOT match the
// intent "find invoice", and one prompt ("retrieve_invoice") that DOES — so
// cast fires cast:discovered rather than cast:executed.
const BASE_CONFIGS: ServerConfig[] = [{
  id: 'billing',
  name: 'Billing',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://billing.test/mcp',
  lazy: true,
}];

// Intent chosen so no tool keyword matches but the prompt keyword does.
const INTENT = 'find invoice';

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gbs-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('billing', {
    tools: [{
      name: 'manage_subscription',
      description: 'Manage billing subscriptions for the account',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '{"subscriptions":[]}' }] },
    }],
    prompts: [{
      name: 'retrieve_invoice',
      description: 'Retrieve invoice history and details for a billing period',
    }],
    resources: [],
  });
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
  });
}

/**
 * Warm the session with one prior call so sessionContext becomes non-null,
 * then invoke cast with the given extra params.
 * Asserts the result is cast:discovered and returns the parsed body.
 */
async function discovered(
  agg: Aggregator,
  sessionId: string,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  // Warm so coordinator has session state.
  await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId });
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId, ...extra });
  assert.equal((result as { isError?: unknown }).isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(
    body['cast'],
    'discovered',
    `expected cast:discovered, got cast="${String(body['cast'])}"`,
  );
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GBS-1: cast:discovered scope(servers)+session → exactly base + scope + sessionContext (8 keys)', async () => {
  const agg = makeAgg();
  const body = await discovered(agg, 'gbs-1', { scope: { servers: ['billing'] } });
  const actual = Object.keys(body).sort();
  const expected = [...DISCOVERED_SCOPE_SESSION_KEYS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:discovered scope(servers)+session keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
  await agg.shutdown();
});

test('GBS-2: cast:discovered scope(categories)+session → same 8 frozen keys', async () => {
  const agg = makeAgg();
  const body = await discovered(agg, 'gbs-2', { scope: { categories: ['ecosystem'] } });
  const actual = Object.keys(body).sort();
  const expected = [...DISCOVERED_SCOPE_SESSION_KEYS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:discovered scope(categories)+session keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
  await agg.shutdown();
});

test('GBS-3: cast:discovered scope+session+explain → adds explanation (9 keys)', async () => {
  const agg = makeAgg();
  const body = await discovered(agg, 'gbs-3', { scope: { servers: ['billing'] }, explain: true });
  const actual = Object.keys(body).sort();
  const expected = [...DISCOVERED_SCOPE_SESSION_EXPLAIN_KEYS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:discovered scope+session+explain keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
  await agg.shutdown();
});

test('GBS-4: absence guard — scope w/o sessionId omits sessionContext', async () => {
  const agg = makeAgg();
  // No sessionId — scope alone should NOT produce sessionContext.
  const result = await agg.callTool('ch1tty/cast', {
    intent: INTENT,
    scope: { servers: ['billing'] },
  });
  assert.equal((result as { isError?: unknown }).isError, undefined, 'GBS-4 must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'discovered', `GBS-4 must be cast:discovered, got "${String(body['cast'])}"`);
  assert.ok(
    Object.prototype.hasOwnProperty.call(body, 'scope'),
    'scope must be present when scope param is set',
  );
  assert.ok(
    !Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
    'sessionContext must be absent when no sessionId is passed',
  );
  await agg.shutdown();
});

test('GBS-5: absence guard — sessionId w/o scope omits scope', async () => {
  const agg = makeAgg();
  const SESSION = 'gbs-5';
  // Warm session.
  await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
  assert.equal((result as { isError?: unknown }).isError, undefined, 'GBS-5 must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'discovered', `GBS-5 must be cast:discovered, got "${String(body['cast'])}"`);
  assert.ok(
    Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
    'sessionContext must be present when sessionId is set and session is warmed',
  );
  assert.ok(
    !Object.prototype.hasOwnProperty.call(body, 'scope'),
    'scope must be absent when no scope param is passed',
  );
  await agg.shutdown();
});
