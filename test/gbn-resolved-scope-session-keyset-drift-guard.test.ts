/**
 * GBN drift guard: freeze cast:resolved exact key set for scope+session combos.
 *
 * GBM (PR #1514) froze cast:resolved +scope without session. GU froze
 * cast:resolved base+session without scope. No test on main freezes the exact
 * key set when BOTH scope AND sessionId are present simultaneously.
 *
 * A regression silently injecting or dropping a key in the scope+session
 * resolved path would pass GBM, GU, GBE, and all prior tests.
 *
 * Frozen key sets (probed from src-stdio/aggregator.ts line ~1564):
 *
 *   BASE(scope+session):
 *     {cast, intent, latencyMs, resolved, resolvedBy, scope, sessionContext} — 7 keys
 *
 *   +explain:
 *     above + explanation — 8 keys
 *
 *   +focus:
 *     above (7) + focus — 8 keys (focus replaces nothing; catalogCombo suppressed via
 *     suggestionsCatalog:{} to keep the key set deterministic)
 *
 * Absence guards:
 *   scope w/o session → sessionContext absent
 *   session w/o scope → scope absent
 *
 * Source: src-stdio/aggregator.ts line ~1553 (dryRun path → cast:resolved body).
 *
 * Frozen 2026-09-26.
 *
 * CLAUDE.md compliance:
 *   - Public MCP surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:resolved
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

const RESOLVED_SCOPE_SESSION_KEYS: readonly string[] = [
  'cast', 'intent', 'latencyMs', 'resolved', 'resolvedBy', 'scope', 'sessionContext',
];

const RESOLVED_SCOPE_SESSION_EXPLAIN_KEYS: readonly string[] = [
  ...RESOLVED_SCOPE_SESSION_KEYS, 'explanation',
].sort() as string[];

const RESOLVED_SCOPE_SESSION_FOCUS_KEYS: readonly string[] = [
  ...RESOLVED_SCOPE_SESSION_KEYS, 'focus',
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

// Intent that scores above threshold against stripe/list_payments.
const INTENT = 'list stripe payments';

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gbn-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    // Prevent catalogCombo from appearing and making the key set non-deterministic.
    suggestionsCatalog: {},
  });
}

/** Call cast with dryRun:true, assert cast:resolved, return parsed body. */
async function resolved(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, dryRun: true, ...extra });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(
    body['cast'],
    'resolved',
    `expected cast:resolved, got cast="${String(body['cast'])}" — scope may have filtered out all matching tools`,
  );
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GBN-1: cast:resolved scope(servers)+session → exactly 7 frozen keys', async () => {
  const agg = makeAgg();
  const SESSION = 'gbn-1';
  // Warm session: one executed cast registers the session in the coordinator.
  await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
  const body = await resolved(agg, { scope: { servers: ['stripe'] }, sessionId: SESSION });
  const actual = Object.keys(body).sort();
  const expected = [...RESOLVED_SCOPE_SESSION_KEYS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:resolved scope(servers)+session keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBN-2: cast:resolved scope(categories)+session → same 7 frozen keys', async () => {
  const agg = makeAgg();
  const SESSION = 'gbn-2';
  await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
  const body = await resolved(agg, { scope: { categories: ['ecosystem'] }, sessionId: SESSION });
  const actual = Object.keys(body).sort();
  const expected = [...RESOLVED_SCOPE_SESSION_KEYS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:resolved scope(categories)+session keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBN-3: cast:resolved scope+session+explain → adds explanation (8 keys)', async () => {
  const agg = makeAgg();
  const SESSION = 'gbn-3';
  await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
  const body = await resolved(agg, {
    scope: { servers: ['stripe'] },
    sessionId: SESSION,
    explain: true,
  });
  const actual = Object.keys(body).sort();
  const expected = [...RESOLVED_SCOPE_SESSION_EXPLAIN_KEYS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:resolved scope+session+explain keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBN-4: cast:resolved scope+session+focus → adds focus (8 keys)', async () => {
  const agg = makeAgg();
  const SESSION = 'gbn-4';
  await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
  const body = await resolved(agg, {
    scope: { servers: ['stripe'] },
    sessionId: SESSION,
    focus: 'code',
  });
  const actual = Object.keys(body).sort();
  const expected = [...RESOLVED_SCOPE_SESSION_FOCUS_KEYS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:resolved scope+session+focus keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBN-5: absence guards — scope w/o session omits sessionContext; session w/o scope omits scope', async () => {
  const agg = makeAgg();
  const SESSION = 'gbn-5';
  await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });

  // scope only → no sessionContext
  const scopeOnly = await resolved(agg, { scope: { servers: ['stripe'] } });
  assert.ok(
    !Object.prototype.hasOwnProperty.call(scopeOnly, 'sessionContext'),
    'sessionContext must be absent when no sessionId is passed',
  );

  // session only → no scope
  const sessionOnly = await resolved(agg, { sessionId: SESSION });
  assert.ok(
    !Object.prototype.hasOwnProperty.call(sessionOnly, 'scope'),
    'scope must be absent when no scope param is passed',
  );
});
