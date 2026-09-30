/**
 * GBQ drift guard: freeze cast:executed exact top-level key set when scope param is set.
 *
 * GV froze the exact key set for cast:executed base paths (no scope, no focus).
 * GV-5 guards that `scope` is ABSENT without a scope param. But NO test on main
 * freezes the exact key set when scope IS provided — a regression adding or
 * removing a key when scope is active would pass all prior tests silently.
 *
 * GBQ closes that gap for the scope-only axis (no session):
 *
 *   GBQ-1  scope(servers) → EXACTLY the GV-1 base set PLUS `scope`
 *   GBQ-2  scope(categories) → same set (different scope sub-object shape)
 *   GBQ-3  scope + explain → base + scope + explanation
 *   GBQ-4  per-call focus param + scope → base + scope + focus + suggestions
 *   GBQ-5  absence guards — scope absent when no scope param; sessionContext
 *            absent when scope is set but no sessionId
 *
 * Parallel to GBM (resolved scope-only), GBK (no_match scope-only), GBP (plan scope-only).
 * Complementary to GBR which will cover scope+session for cast:executed.
 *
 * Source: src-stdio/aggregator.ts lines 1648–1674 (cast:executed body).
 *
 * Frozen 2026-09-26.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:executed
 *     key set, not explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen key sets ───────────────────────────────────────────────────────────

// Base: same as GV-1. stripe fixture = 3 tools, 2 alternatives, resources from
// suggestions catalog. No prompts.
const EXECUTED_KEYS_BASE: readonly string[] = [
  'cast', 'resolvedBy', 'intent', 'latencyMs', 'latencyBreakdown',
  'resolved', 'score', 'alternatives', 'resources',
];

const EXECUTED_KEYS_WITH_SCOPE: readonly string[] = [
  ...EXECUTED_KEYS_BASE, 'scope',
];

const EXECUTED_KEYS_WITH_SCOPE_EXPLAIN: readonly string[] = [
  ...EXECUTED_KEYS_WITH_SCOPE, 'explanation',
];

const EXECUTED_KEYS_WITH_SCOPE_FOCUS: readonly string[] = [
  ...EXECUTED_KEYS_WITH_SCOPE, 'focus', 'suggestions',
];

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
  return join(tmpdir(), `ch1tty-gbq-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(opts: { focus?: string } = {}): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    ...(opts.focus ? { focus: opts.focus } : {}),
  });
}

async function executed(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, ...extra });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'executed', `expected cast:executed, got cast="${String(body['cast'])}"`);
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GBQ-1: cast:executed with scope(servers) has exactly base + scope', async () => {
  const agg = makeAgg();
  const body = await executed(agg, { scope: { servers: ['stripe'] } });
  const actual = Object.keys(body).sort();
  const expected = [...EXECUTED_KEYS_WITH_SCOPE].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:executed+scope(servers) keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBQ-2: cast:executed with scope(categories) has exactly base + scope', async () => {
  const agg = makeAgg();
  const body = await executed(agg, { scope: { categories: ['ecosystem'] } });
  const actual = Object.keys(body).sort();
  const expected = [...EXECUTED_KEYS_WITH_SCOPE].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:executed+scope(categories) keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBQ-3: cast:executed with scope + explain adds exactly explanation to scope set', async () => {
  const agg = makeAgg();
  const body = await executed(agg, { scope: { servers: ['stripe'] }, explain: true });
  const actual = Object.keys(body).sort();
  const expected = [...EXECUTED_KEYS_WITH_SCOPE_EXPLAIN].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:executed+scope+explain keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBQ-4: cast:executed with scope + focus (per-call) adds focus + suggestions to scope set', async () => {
  const agg = makeAgg();
  const body = await executed(agg, { scope: { categories: ['ecosystem'] }, focus: 'finance' });
  const actual = Object.keys(body).sort();
  const expected = [...EXECUTED_KEYS_WITH_SCOPE_FOCUS].sort();
  assert.deepEqual(
    actual,
    expected,
    `cast:executed+scope+focus keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
});

test('GBQ-5: scope absent without scope param; sessionContext absent when scope set but no sessionId', async () => {
  const agg = makeAgg();

  // No scope param → no scope key
  const bodyBase = await executed(agg);
  assert.ok(
    !Object.prototype.hasOwnProperty.call(bodyBase, 'scope'),
    'scope must be absent when no scope param is passed',
  );

  // scope param present, no sessionId → scope present, sessionContext absent
  const bodyScoped = await executed(agg, { scope: { servers: ['stripe'] } });
  assert.ok(
    Object.prototype.hasOwnProperty.call(bodyScoped, 'scope'),
    'scope must be present when scope param is passed',
  );
  assert.ok(
    !Object.prototype.hasOwnProperty.call(bodyScoped, 'sessionContext'),
    'sessionContext must be absent when scope is set but no sessionId',
  );
});
