/**
 * GEI drift guard: freeze cast:executed exact top-level key set when
 * scope+focus+explain are simultaneously active — the 3-way and maximal
 * (all-four) combinations not covered by any prior test.
 *
 * Prior executed exact-keyset coverage:
 *   GV  : base key set (no scope, no focus, no explain, no session)
 *   GVF : conditional keys — focus and explain, no scope
 *   GBZ : focus active at process level (no scope, no session, no explain)
 *   GBQ : scope only (no session, no focus, no explain)
 *   GBR : scope+session; scope+session+explain; scope+session+focus
 *   GEH (open PRs): focus+explain; session+explain; session+focus+explain (no scope)
 *
 * Confirmed gap: no test on main or open PRs freezes the exact key set when
 * scope, focus, AND explain are simultaneously active. The maximal combination
 * (scope+session+focus+explain — all four) is entirely unguarded.
 *
 * Specific regressions GEI catches that prior tests miss:
 *   (a) Scope blocks or clobbers `explanation` injection when focus is also active.
 *   (b) Focus blocks or clobbers `scope` annotation when explain is also set.
 *   (c) Any of scope, focus, suggestions, or explanation drops silently when
 *       all four conditionals are active simultaneously (maximal path).
 *   (d) An unexpected extra key appears only under the combined load.
 *
 * Actual cast:executed body (aggregator.ts — independent conditional spreads):
 *   base: {cast, resolvedBy, intent, latencyMs, latencyBreakdown, resolved,
 *          score, alternatives, resources}
 *   ...(focusName      ? { focus }           : {})
 *   ...(scopeAnnot     ? { scope }           : {})
 *   ...(explanation    ? { explanation }     : {})
 *   ...(resolvedCtx    ? { sessionContext }  : {})
 *   ...(focusSuggestions ? { suggestions }  : {})
 *
 * GEI freezes:
 *
 *   GEI-1  scope+focus+explain (no session) → EXACTLY base + scope + focus +
 *          suggestions + explanation — 13 keys.
 *          (GBR-3 covers scope+session+explain; GBR-4 covers scope+session+focus;
 *           neither covers the three-way scope∧focus∧explain without session.)
 *
 *   GEI-2  scope+session+focus+explain (maximal — all four) → EXACTLY
 *          base + scope + sessionContext + focus + suggestions + explanation
 *          — 14 keys. (GBL-5 does this for cast:no_match; no executed test
 *          covers the maximal case.)
 *
 *   GEI-3  absence guard: maximal path does NOT inject resolvedFromCatalog,
 *          catalogCombo, or chainContinuation (expected absent under this
 *          fixture — non-catalog direct match, no chain continuation).
 *
 *   GEI-4  suggestions is an object with exactly {combos, prompts} when
 *          scope+focus+explain active — sub-object key-set freeze under the
 *          combined conditional load (extends GBZ-5 to this path).
 *
 *   GEI-5  explanation and scope are both non-null objects under the maximal
 *          path — type guards confirming neither drops to null when all four
 *          conditionals are simultaneously active.
 *
 * Fixture: stripe only (list_payments, get_balance, create_payment_intent).
 * Intent:  "list stripe payments" reliably resolves to stripe/list_payments.
 * Focus:   'finance' per-call — consistent with GBR-4 (no focusProfiles
 *          pre-configured; suggestions is generated for per-call focus).
 * Scope:   { servers: ['stripe'] }.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level
 *     cast:executed key set, not explanation sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// Base: from GV-1 / GBR.
const EXECUTED_BASE_KEYS: readonly string[] = [
  'cast', 'resolvedBy', 'intent', 'latencyMs', 'latencyBreakdown',
  'resolved', 'score', 'alternatives', 'resources',
];

// scope + focus + explain (no session): base + scope + focus + suggestions + explanation.
const EXECUTED_SCOPE_FOCUS_EXPLAIN_KEYS: readonly string[] = [
  ...EXECUTED_BASE_KEYS, 'scope', 'focus', 'suggestions', 'explanation',
].sort() as string[];

// scope + session + focus + explain (maximal): + sessionContext.
const EXECUTED_MAXIMAL_KEYS: readonly string[] = [
  ...EXECUTED_BASE_KEYS, 'scope', 'sessionContext', 'focus', 'suggestions', 'explanation',
].sort() as string[];

// ── Fixtures ──────────────────────────────────────────────────────────────────

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
  return join(tmpdir(), `ch1tty-gei-${Date.now()}-${++_seq}.jsonl`);
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

/** Call cast (no confirm) and assert cast:executed, return parsed body. */
async function castExecuted(
  agg: Aggregator,
  sessionId: string | undefined,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  if (sessionId) {
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId });
  }
  const result = await agg.callTool('ch1tty/cast', {
    intent: INTENT,
    ...(sessionId ? { sessionId } : {}),
    ...extra,
  });
  assert.equal((result as { isError?: unknown }).isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'executed', `expected cast:executed, got cast="${String(body['cast'])}"`);
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GEI-1: cast:executed scope+focus+explain (no session) → EXACTLY base+scope+focus+suggestions+explanation (13 keys)', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg, undefined, {
      scope: { servers: ['stripe'] },
      focus: 'finance',
      explain: true,
    });
    const actual = Object.keys(body).sort();
    const expected = [...EXECUTED_SCOPE_FOCUS_EXPLAIN_KEYS].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:executed scope+focus+explain keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEI-2: cast:executed scope+session+focus+explain (maximal) → EXACTLY base+scope+sessionContext+focus+suggestions+explanation (14 keys)', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg, 'gei-2', {
      scope: { servers: ['stripe'] },
      focus: 'finance',
      explain: true,
    });
    const actual = Object.keys(body).sort();
    const expected = [...EXECUTED_MAXIMAL_KEYS].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:executed maximal keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEI-3: maximal cast:executed does NOT inject resolvedFromCatalog, catalogCombo, or chainContinuation', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg, 'gei-3', {
      scope: { servers: ['stripe'] },
      focus: 'finance',
      explain: true,
    });
    for (const absent of ['resolvedFromCatalog', 'catalogCombo', 'chainContinuation']) {
      assert.ok(
        !Object.prototype.hasOwnProperty.call(body, absent),
        `${absent} must be absent in maximal cast:executed`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GEI-4: suggestions has exactly {combos, prompts} when scope+focus+explain active', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg, undefined, {
      scope: { servers: ['stripe'] },
      focus: 'finance',
      explain: true,
    });
    assert.ok(
      Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      'suggestions must be present when focus is active',
    );
    const sugg = body['suggestions'] as Record<string, unknown>;
    assert.ok(sugg !== null && typeof sugg === 'object', 'suggestions must be an object');
    const suggKeys = Object.keys(sugg).sort();
    assert.deepEqual(
      suggKeys,
      ['combos', 'prompts'],
      `suggestions must have exactly {combos, prompts}; got ${JSON.stringify(suggKeys)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEI-5: explanation and scope are non-null objects under the maximal path', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg, 'gei-5', {
      scope: { servers: ['stripe'] },
      focus: 'finance',
      explain: true,
    });
    const exp = body['explanation'];
    assert.ok(
      exp !== null && typeof exp === 'object',
      `explanation must be a non-null object; got ${typeof exp} (${JSON.stringify(exp)})`,
    );
    const sc = body['scope'];
    assert.ok(
      sc !== null && typeof sc === 'object',
      `scope must be a non-null object; got ${typeof sc} (${JSON.stringify(sc)})`,
    );
  } finally {
    await agg.shutdown();
  }
});
