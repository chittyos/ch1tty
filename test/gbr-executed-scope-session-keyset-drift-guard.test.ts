/**
 * GBR drift guard: freeze cast:executed exact key set for scope+session combos.
 *
 * Prior executed exact-keyset coverage:
 *   GV  (PR series): froze cast:executed base key set (no scope, no session)
 *   GVF (PR #1505) : froze cast:executed conditional keys (focus, explain, no scope)
 *   GBQ (PR #1518) : froze cast:executed exact key set when scope param is set (no session)
 *
 * Gap: No test on main freezes the exact key set when BOTH scope AND sessionId
 * are present simultaneously in a cast:executed call. A regression silently
 * injecting or dropping a key in that combined path would pass GV, GVF, GBQ,
 * and all prior tests.
 *
 * GBR closes that gap — parallel to GBO (plan scope+session) and GBN (resolved
 * scope+session):
 *
 *   GBR-1  scope(servers) + sessionId  → EXACTLY base + scope + sessionContext (11 keys)
 *   GBR-2  scope(categories) + sessionId → same 11 keys, different scope shape
 *   GBR-3  scope + session + explain   → base + scope + sessionContext + explanation (12 keys)
 *   GBR-4  scope + session + focus     → base + scope + sessionContext + focus + suggestions (13 keys)
 *   GBR-5  absence guards:
 *             scope w/o sessionId → sessionContext absent
 *             sessionId w/o scope → scope absent
 *
 * Source: src-stdio/aggregator.ts (cast:executed body).
 *
 * Frozen 2026-09-26.
 *
 * CLAUDE.md compliance:
 *   - Public MCP surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:executed
 *     key set, not the explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// Base: same as GV-1.
const EXECUTED_BASE_KEYS: readonly string[] = [
  'cast', 'resolvedBy', 'intent', 'latencyMs', 'latencyBreakdown',
  'resolved', 'score', 'alternatives', 'resources',
];

// scope + sessionContext both present.
const EXECUTED_SCOPE_SESSION_KEYS: readonly string[] = [
  ...EXECUTED_BASE_KEYS, 'scope', 'sessionContext',
];

// + explain.
const EXECUTED_SCOPE_SESSION_EXPLAIN_KEYS: readonly string[] = [
  ...EXECUTED_SCOPE_SESSION_KEYS, 'explanation',
].sort() as string[];

// + focus (per-call) — suggestions appears alongside focus in executed mode.
const EXECUTED_SCOPE_SESSION_FOCUS_KEYS: readonly string[] = [
  ...EXECUTED_SCOPE_SESSION_KEYS, 'focus', 'suggestions',
].sort() as string[];

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_CONFIGS: ServerConfig[] = [
  {
    id: 'stripe',
    name: 'Stripe',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://stripe.com/mcp',
    lazy: true,
  },
];

const INTENT = 'list stripe payments';

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gbr-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

/** Warm session then call cast (no confirm) + assert cast:executed, return parsed body. */
async function executed(
  agg: Aggregator,
  sessionId: string,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  // Warm the session so sessionContext appears when sessionId is passed.
  await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId });
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId, ...extra });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'executed', `expected cast:executed, got cast="${String(body['cast'])}"`);
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GBR-1: cast:executed scope(servers)+session → exactly base + scope + sessionContext (11 keys)', async () => {
  const agg = makeAgg();
  const body = await executed(agg, 'gbr-1', { scope: { servers: ['stripe'] } });
  const actual = Object.keys(body).sort();
  const expected = [...EXECUTED_SCOPE_SESSION_KEYS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:executed scope(servers)+session keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBR-2: cast:executed scope(categories)+session → same 11 frozen keys', async () => {
  const agg = makeAgg();
  const body = await executed(agg, 'gbr-2', { scope: { categories: ['ecosystem'] } });
  const actual = Object.keys(body).sort();
  const expected = [...EXECUTED_SCOPE_SESSION_KEYS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:executed scope(categories)+session keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBR-3: cast:executed scope+session+explain → adds explanation (12 keys)', async () => {
  const agg = makeAgg();
  const body = await executed(agg, 'gbr-3', { scope: { servers: ['stripe'] }, explain: true });
  const actual = Object.keys(body).sort();
  const expected = [...EXECUTED_SCOPE_SESSION_EXPLAIN_KEYS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:executed scope+session+explain keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBR-4: cast:executed scope+session+focus → adds focus + suggestions (13 keys)', async () => {
  const agg = makeAgg();
  const body = await executed(agg, 'gbr-4', { scope: { categories: ['ecosystem'] }, focus: 'finance' });
  const actual = Object.keys(body).sort();
  const expected = [...EXECUTED_SCOPE_SESSION_FOCUS_KEYS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:executed scope+session+focus keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBR-5: absence guards — scope w/o session omits sessionContext; session w/o scope omits scope', async () => {
  const agg = makeAgg();
  const SESSION = 'gbr-5';
  await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });

  // scope only (no sessionId) → sessionContext absent
  const scopeOnly = await (async () => {
    const result = await agg.callTool('ch1tty/cast', { intent: INTENT, scope: { servers: ['stripe'] } });
    const content = (result as { content: Array<{ type: string; text?: string }> }).content;
    return JSON.parse(content[0]!.text!) as Record<string, unknown>;
  })();
  assert.equal(scopeOnly['cast'], 'executed', `GBR-5 scopeOnly must be cast:executed, got "${String(scopeOnly['cast'])}"`);
  assert.ok(
    !Object.prototype.hasOwnProperty.call(scopeOnly, 'sessionContext'),
    'sessionContext must be absent when scope is set but no sessionId is passed',
  );

  // sessionId only (no scope) → scope absent
  const sessionOnly = await (async () => {
    const result = await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
    const content = (result as { content: Array<{ type: string; text?: string }> }).content;
    return JSON.parse(content[0]!.text!) as Record<string, unknown>;
  })();
  assert.equal(sessionOnly['cast'], 'executed', `GBR-5 sessionOnly must be cast:executed, got "${String(sessionOnly['cast'])}"`);
  assert.ok(
    !Object.prototype.hasOwnProperty.call(sessionOnly, 'scope'),
    'scope must be absent when sessionId is set but no scope param is passed',
  );
});
