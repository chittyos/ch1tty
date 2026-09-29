/**
 * GBP drift guard: freeze cast:plan exact key set when scope is set without session.
 *
 * Prior plan exact-keyset coverage:
 *   GBD (PR #1501): froze cast:plan base key set (no scope, no session)
 *   GBF (PR #1506): froze cast:plan conditional keys (focus, explain, no scope)
 *   GBO (PR #1516): froze cast:plan key set with scope+session simultaneously
 *
 * Gap: No test on main freezes the exact key set when scope IS present but
 * sessionId is NOT. GBO-5's absence guard checks sessionContext is absent in
 * the scope-only path, but does not freeze the full key set of that path.
 * A regression silently injecting a key (e.g. sessionContext, resources, prompts)
 * when scope is passed without session would pass GBD, GBF, GBO, and all
 * prior tests.
 *
 * Frozen key sets (probed from src-stdio/aggregator.ts cast:plan confirm path):
 *
 *   BASE(scope, no session):
 *     {alternatives, args, cast, hint, intent, latencyMs, resolved, resolvedBy,
 *      scope} — 9 keys
 *     NOTE: sessionContext absent (no sessionId passed)
 *     NOTE: resources absent (suggestionsCatalog:{} suppresses suggestion
 *     resources; FixtureBackend returns no resources from the stripe server)
 *
 *   +explain:
 *     above + explanation — 10 keys
 *
 *   +focus:
 *     above (9) + focus — 10 keys
 *     (catalogCombo suppressed via suggestionsCatalog:{} to keep key set
 *     deterministic even when focus activates focusSuggestions)
 *
 * Absence guards:
 *   scope only → sessionContext absent
 *   scope only → resources absent (catalog suppressed)
 *
 * Source: src/aggregator.ts (confirm path → cast:plan body).
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

const PLAN_SCOPE_ONLY_KEYS: readonly string[] = [
  'alternatives', 'args', 'cast', 'hint', 'intent', 'latencyMs',
  'resolved', 'resolvedBy', 'scope',
];

const PLAN_SCOPE_ONLY_EXPLAIN_KEYS: readonly string[] = [
  ...PLAN_SCOPE_ONLY_KEYS, 'explanation',
].sort() as string[];

const PLAN_SCOPE_ONLY_FOCUS_KEYS: readonly string[] = [
  ...PLAN_SCOPE_ONLY_KEYS, 'focus',
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
  return join(tmpdir(), `gbp-test-${process.pid}-${++_seq}.jsonl`);
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

test('GBP-1: cast:plan scope(servers) without session → exactly 9 frozen keys', async () => {
  const agg = makeAgg();
  const body = await plan(agg, { scope: { servers: ['stripe'] } });
  const actual = Object.keys(body).sort();
  const expected = [...PLAN_SCOPE_ONLY_KEYS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:plan scope(servers) keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBP-2: cast:plan scope(categories) without session → same 9 frozen keys', async () => {
  const agg = makeAgg();
  const body = await plan(agg, { scope: { categories: ['ecosystem'] } });
  const actual = Object.keys(body).sort();
  const expected = [...PLAN_SCOPE_ONLY_KEYS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:plan scope(categories) keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBP-3: cast:plan scope+explain without session → adds explanation (10 keys)', async () => {
  const agg = makeAgg();
  const body = await plan(agg, { scope: { servers: ['stripe'] }, explain: true });
  const actual = Object.keys(body).sort();
  const expected = [...PLAN_SCOPE_ONLY_EXPLAIN_KEYS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:plan scope+explain keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBP-4: cast:plan scope+focus without session → adds focus (10 keys)', async () => {
  const agg = makeAgg();
  const body = await plan(agg, { scope: { servers: ['stripe'] }, focus: 'code' });
  const actual = Object.keys(body).sort();
  const expected = [...PLAN_SCOPE_ONLY_FOCUS_KEYS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:plan scope+focus keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBP-5: absence guards — scope without session omits sessionContext and resources', async () => {
  const agg = makeAgg();
  const body = await plan(agg, { scope: { servers: ['stripe'] } });

  assert.ok(
    !Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
    'sessionContext must be absent from cast:plan when no sessionId is passed',
  );
  assert.ok(
    !Object.prototype.hasOwnProperty.call(body, 'resources'),
    'resources must be absent from cast:plan when suggestionsCatalog is empty and fixture returns no resources',
  );
  assert.ok(
    Object.prototype.hasOwnProperty.call(body, 'scope'),
    'scope must be present in cast:plan when scope param is passed',
  );
});
