/**
 * GBO drift guard: freeze cast:plan exact key set for scope+session combos.
 *
 * Prior plan exact-keyset coverage:
 *   GBD (PR #1501): froze cast:plan base key set (no scope, no session)
 *   GBF (PR #1506): froze cast:plan conditional keys (focus, explain, no scope)
 *
 * Gap: No test on main freezes the exact key set when BOTH scope AND sessionId
 * are present simultaneously in a cast:plan (confirm:true) call. A regression
 * silently injecting or dropping a key in the plan scope+session path would
 * pass GBD, GBF, and all prior tests.
 *
 * Frozen key sets (probed from src-stdio/aggregator.ts lines ~1595–1625):
 *
 *   BASE(scope+session):
 *     {alternatives, args, cast, hint, intent, latencyMs, resolved, resolvedBy,
 *      scope, sessionContext} — 10 keys
 *
 *   +explain:
 *     above + explanation — 11 keys
 *
 *   +focus:
 *     above (10) + focus — 11 keys
 *     (catalogCombo suppressed via suggestionsCatalog:{} to keep key set
 *     deterministic even when focus activates focusSuggestions)
 *
 * Absence guards:
 *   scope w/o session → sessionContext absent from plan response
 *   session w/o scope → scope absent from plan response
 *
 * Source: src-stdio/aggregator.ts lines ~1595–1625 (confirm path → cast:plan body).
 *
 * Frozen 2026-09-26.
 *
 * CLAUDE.md compliance:
 *   - Public MCP surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:plan
 *     key set, not the explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets (sorted alphabetically) ─────────────────────────────

const PLAN_SCOPE_SESSION_KEYS: readonly string[] = [
  'alternatives', 'args', 'cast', 'hint', 'intent', 'latencyMs',
  'resolved', 'resolvedBy', 'scope', 'sessionContext',
];

const PLAN_SCOPE_SESSION_EXPLAIN_KEYS: readonly string[] = [
  ...PLAN_SCOPE_SESSION_KEYS, 'explanation',
].sort() as string[];

const PLAN_SCOPE_SESSION_FOCUS_KEYS: readonly string[] = [
  ...PLAN_SCOPE_SESSION_KEYS, 'focus',
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
  return join(tmpdir(), `ch1tty-gbo-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    // Prevent catalogCombo/suggestions from appearing and making the key set
    // non-deterministic when focus is active.
    suggestionsCatalog: {},
  });
}

/** Call cast with confirm:true, assert cast:plan, return parsed body. */
async function plan(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true, ...extra });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(
    body['cast'],
    'plan',
    `expected cast:plan, got cast="${String(body['cast'])}" — scope may have filtered out all matching tools`,
  );
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GBO-1: cast:plan scope(servers)+session → exactly 10 frozen keys', async () => {
  const agg = makeAgg();
  const SESSION = 'gbo-1';
  // Warm session: one executed cast registers the session in the coordinator.
  await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
  const body = await plan(agg, { scope: { servers: ['stripe'] }, sessionId: SESSION });
  const actual = Object.keys(body).sort();
  const expected = [...PLAN_SCOPE_SESSION_KEYS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:plan scope(servers)+session keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBO-2: cast:plan scope(categories)+session → same 10 frozen keys', async () => {
  const agg = makeAgg();
  const SESSION = 'gbo-2';
  await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
  const body = await plan(agg, { scope: { categories: ['ecosystem'] }, sessionId: SESSION });
  const actual = Object.keys(body).sort();
  const expected = [...PLAN_SCOPE_SESSION_KEYS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:plan scope(categories)+session keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBO-3: cast:plan scope+session+explain → adds explanation (11 keys)', async () => {
  const agg = makeAgg();
  const SESSION = 'gbo-3';
  await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
  const body = await plan(agg, {
    scope: { servers: ['stripe'] },
    sessionId: SESSION,
    explain: true,
  });
  const actual = Object.keys(body).sort();
  const expected = [...PLAN_SCOPE_SESSION_EXPLAIN_KEYS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:plan scope+session+explain keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBO-4: cast:plan scope+session+focus → adds focus (11 keys)', async () => {
  const agg = makeAgg();
  const SESSION = 'gbo-4';
  await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
  const body = await plan(agg, {
    scope: { servers: ['stripe'] },
    sessionId: SESSION,
    focus: 'code',
  });
  const actual = Object.keys(body).sort();
  const expected = [...PLAN_SCOPE_SESSION_FOCUS_KEYS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:plan scope+session+focus keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBO-5: absence guards — scope w/o session omits sessionContext; session w/o scope omits scope', async () => {
  const agg = makeAgg();
  const SESSION = 'gbo-5';
  await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });

  // scope only → no sessionContext
  const scopeOnly = await plan(agg, { scope: { servers: ['stripe'] } });
  assert.ok(
    !Object.prototype.hasOwnProperty.call(scopeOnly, 'sessionContext'),
    'sessionContext must be absent from cast:plan when no sessionId is passed',
  );

  // session only → no scope
  const sessionOnly = await plan(agg, { sessionId: SESSION });
  assert.ok(
    !Object.prototype.hasOwnProperty.call(sessionOnly, 'scope'),
    'scope must be absent from cast:plan when no scope param is passed',
  );
});
