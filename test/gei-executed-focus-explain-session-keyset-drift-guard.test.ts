/**
 * GEI drift guard: freeze cast:executed exact top-level key set when focus,
 * explain, and session are ALL active simultaneously, with and without scope.
 *
 * Prior tests cover these conditionals in sub-combinations:
 *
 *   GVF-3  froze cast:executed + focus + explain (no session, no scope):
 *          EXACTLY {alternatives, cast, explanation, focus, intent,
 *                   latencyBreakdown, latencyMs, resolved, resolvedBy, score}
 *          — 10 keys.
 *
 *   GVF-4  froze cast:executed + focus + session (no explain, no scope):
 *          EXACTLY base + focus + sessionContext — 10 keys.
 *
 *   GEH    froze cast:executed + session + explain (no focus, no scope):
 *          EXACTLY base + explanation + sessionContext — 10 keys.
 *
 *   GBQ    froze cast:executed + scope (no focus, no explain, no session).
 *   GBR    froze cast:executed + scope + session (no focus, no explain).
 *
 * Gap: no test freezes the exact key set when focus AND explain AND session
 * are all active together (the triple combination), nor when scope is also
 * added (the quadruple: focus + explain + session + scope).
 *
 * A regression that:
 *   (a) drops `explanation` when both `focus` and `sessionContext` are present
 *       (treating focus+session as mutually exclusive with explain), or
 *   (b) injects a leaked field (e.g. `focusSessionAffinity`, `sessionFocusRatio`)
 *       only when all three are active simultaneously,
 * would pass GVF-3, GVF-4, GEH, GBQ, and GBR silently.
 *
 * Source (src-stdio/aggregator.ts ~line 1648 — cast:executed body):
 *   {
 *     cast: 'executed', resolvedBy, intent, latencyMs, latencyBreakdown,
 *     ...(focusName        ? { focus }        : {}),
 *     ...(scopeAnnotation  ? { scope }        : {}),
 *     ...(explanation      ? { explanation }  : {}),
 *     resolved, score,
 *     ...(catalogCombo     ? { resolvedFromCatalog } : {}),
 *     ...(chainContinuation ? { chainContinuation } : {}),
 *     ...(alternatives.length > 0 ? { alternatives } : {}),
 *     ...related,
 *     ...(castSessionContext ? { sessionContext } : {}),
 *     ...(focusSuggestions  ? { suggestions }    : {}),
 *   }
 *
 * Frozen key sets (probed 2026-09-30 via source inspection + GVF pattern):
 *   +focus+explain+session         → base-8 + explanation + focus + sessionContext = 11 keys
 *   +focus+explain+session+scope   → base-8 + explanation + focus + scope + sessionContext = 12 keys
 *
 * GEI freezes:
 *   GEI-1  +focus+explain+session (triple) → EXACTLY 11 keys
 *   GEI-2  +focus+explain+session+scope(servers) → EXACTLY 12 keys
 *   GEI-3  +focus+explain+session+scope(categories) → EXACTLY 12 keys (scope by category)
 *   GEI-4  absence guard: +focus+explain+session → no {resolvedFromCatalog,
 *          chainContinuation, suggestions, scope, resources} (non-catalog,
 *          no-catalog-suggestions, no-scope path is clean)
 *   GEI-5  value types: explanation=object, focus=string, sessionContext=object
 *
 * Catalog isolation: empty suggestionsCatalog passed explicitly — avoids any
 * CWD dependency and ensures suggestions/resources are absent.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level key set
 *     drift guard, not the explanation sub-object structure)
 *
 * Frozen 2026-09-30.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ──────────────────────────────────────────────────────

// GVF-1 base: cast:executed with empty catalog (no resources, alternatives
// present because stripe fixture has 3 tools → 2 alternatives).
const EXECUTED_BASE: readonly string[] = [
  'alternatives', 'cast', 'intent', 'latencyBreakdown', 'latencyMs',
  'resolved', 'resolvedBy', 'score',
];

const EXECUTED_FOCUS_EXPLAIN_SESSION: readonly string[] = [
  ...EXECUTED_BASE, 'explanation', 'focus', 'sessionContext',
];

const EXECUTED_FOCUS_EXPLAIN_SESSION_SCOPE: readonly string[] = [
  ...EXECUTED_BASE, 'explanation', 'focus', 'scope', 'sessionContext',
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
  return join(tmpdir(), `ch1tty-gei-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    suggestionsCatalog: {},
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

/** Exact key-set assertion: sorted actual keys must deep-equal sorted expected keys. */
function assertExactKeys(
  body: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(body).sort();
  const exp = [...expected].sort();
  assert.deepEqual(
    actual,
    exp,
    `${label}: top-level keys must be exactly ${JSON.stringify(exp)}; got ${JSON.stringify(actual)}`,
  );
}

// ── GEI-1: focus+explain+session → 11 keys ────────────────────────────────────

test('GEI-1: cast:executed +focus+explain+session has exactly 11 keys', async () => {
  const agg = makeAgg();
  try {
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: 'gei-warmup-1', focus: 'finance' });
    const body = await executed(agg, { focus: 'finance', explain: true, sessionId: 'gei-warmup-1' });
    assertExactKeys(body, EXECUTED_FOCUS_EXPLAIN_SESSION, 'GEI-1 +focus+explain+session');
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-2: focus+explain+session+scope(servers) → 12 keys ─────────────────────

test('GEI-2: cast:executed +focus+explain+session+scope(servers) has exactly 12 keys', async () => {
  const agg = makeAgg();
  try {
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: 'gei-warmup-2', focus: 'finance' });
    const body = await executed(agg, {
      focus: 'finance',
      explain: true,
      sessionId: 'gei-warmup-2',
      scope: { servers: ['stripe'] },
    });
    assertExactKeys(body, EXECUTED_FOCUS_EXPLAIN_SESSION_SCOPE, 'GEI-2 +focus+explain+session+scope(servers)');
    assert.equal(typeof body['scope'], 'object', 'scope must be an object');
    assert.notEqual(body['scope'], null, 'scope must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-3: focus+explain+session+scope(categories) → 12 keys ──────────────────

test('GEI-3: cast:executed +focus+explain+session+scope(categories) has exactly 12 keys', async () => {
  const agg = makeAgg();
  try {
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: 'gei-warmup-3', focus: 'finance' });
    const body = await executed(agg, {
      focus: 'finance',
      explain: true,
      sessionId: 'gei-warmup-3',
      scope: { categories: ['ecosystem'] },
    });
    assertExactKeys(body, EXECUTED_FOCUS_EXPLAIN_SESSION_SCOPE, 'GEI-3 +focus+explain+session+scope(categories)');
    assert.equal(typeof body['scope'], 'object', 'scope must be an object');
    assert.notEqual(body['scope'], null, 'scope must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-4: absence guard — no catalog/chain/suggestions/resources on clean path ─

test('GEI-4: cast:executed +focus+explain+session has no resolvedFromCatalog, chainContinuation, suggestions, scope, resources', async () => {
  const agg = makeAgg();
  try {
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: 'gei-warmup-4', focus: 'finance' });
    const body = await executed(agg, { focus: 'finance', explain: true, sessionId: 'gei-warmup-4' });
    for (const absent of ['resolvedFromCatalog', 'chainContinuation', 'suggestions', 'scope', 'resources']) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(body, absent),
        false,
        `GEI-4: ${absent} must be absent on non-catalog, no-scope, empty-catalog path`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GEI-5: value types for GEI-1 triple combo ─────────────────────────────────

test('GEI-5: cast:executed +focus+explain+session field types are correct', async () => {
  const agg = makeAgg();
  try {
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: 'gei-warmup-5', focus: 'finance' });
    const body = await executed(agg, { focus: 'finance', explain: true, sessionId: 'gei-warmup-5' });
    assert.equal(typeof body['focus'], 'string', 'focus must be a string');
    assert.ok((body['focus'] as string).length > 0, 'focus must be non-empty');
    assert.equal(typeof body['explanation'], 'object', 'explanation must be an object');
    assert.notEqual(body['explanation'], null, 'explanation must not be null');
    assert.equal(typeof body['sessionContext'], 'object', 'sessionContext must be an object');
    assert.notEqual(body['sessionContext'], null, 'sessionContext must not be null');
  } finally {
    await agg.shutdown();
  }
});
