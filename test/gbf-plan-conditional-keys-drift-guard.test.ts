/**
 * GBF drift guard: freeze cast:plan conditional top-level key set.
 *
 * Prior tests cover cast:plan field VALUE TYPES (GK) and cast:plan sessionContext
 * value types (GS), but no test on main freezes the exact top-level key set or
 * the conditional additions activated by focus/session/explain parameters.
 *
 * A regression that accidentally always includes `focus`, always includes
 * `explanation`, adds an extra annotation key, or leaks `scope` / `suggestions`
 * / `resolvedFromCatalog` / `chainContinuation` in the base path would pass all
 * prior tests silently.
 *
 * Actual shapes (keyword route, stripe fixture, empty catalog, confirm:true,
 * probed 2026-09-25):
 *
 *   cast:plan (no session, no focus, no explain, empty catalog)
 *     → {alternatives, args, cast, hint, intent, latencyMs, resolved, resolvedBy}
 *       (8 keys)
 *
 *   cast:plan (no session, focus:'finance', no explain, empty catalog)
 *     → base + focus  (9 keys)
 *
 *   cast:plan (no session, focus:'finance', explain:true, empty catalog)
 *     → base + focus + explanation  (10 keys)
 *
 *   cast:plan (sessionId, no focus, no explain, empty catalog)
 *     → base + sessionContext  (9 keys)
 *
 * Source: src-stdio/aggregator.ts line ~1599 (cast:plan body construction):
 *   { cast: 'plan', resolvedBy, intent, latencyMs,
 *     ...(focusName ? { focus } : {}),
 *     ...(scopeAnnotation ? { scope } : {}),
 *     ...(explanation ? { explanation } : {}),
 *     resolved: {...},
 *     ...(catalogCombo ? { resolvedFromCatalog } : {}),
 *     ...(chainContinuation ? { chainContinuation } : {}),
 *     alternatives,
 *     ...related,
 *     ...(planSessionContext ? { sessionContext } : {}),
 *     ...(focusSuggestions ? { suggestions } : {}),
 *     args: toolArgs,
 *     hint: '...' }
 *
 * GBF freezes:
 *
 *   GBF-1  cast:plan base (no focus, no session, no explain, empty catalog)
 *          has EXACTLY 8 keys:
 *          {alternatives, args, cast, hint, intent, latencyMs, resolved, resolvedBy}.
 *          (No test on main freezes the cast:plan exact top-level key set;
 *           a regression promoting a sub-field or leaking an annotation key
 *           at the root would pass all prior tests silently.)
 *
 *   GBF-2  cast:plan WITH focus:'finance' adds exactly `focus` — base+1=9 keys.
 *          (GK never asserts focus adds exactly one key and nothing else.)
 *
 *   GBF-3  cast:plan WITH focus AND explain:true adds exactly `focus` +
 *          `explanation` — base+2=10 keys. No test covers the combined
 *          focus+explain conditional case for plan mode.
 *
 *   GBF-4  cast:plan WITH sessionId (no focus) adds exactly `sessionContext` —
 *          base+1=9 keys. GS froze sessionContext value types; no test freezes
 *          that sessionContext is the ONLY extra key added by the session path.
 *
 *   GBF-5  cast:plan WITHOUT focus/scope/catalogCombo/chainContinuation does
 *          NOT contain `scope`, `suggestions`, `resolvedFromCatalog`, or
 *          `chainContinuation`. These conditional keys are absent in the common
 *          base execution path; no prior test asserts their absence.
 *
 * Frozen 2026-09-25.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:plan
 *     key set, not the explanation sub-object structure)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ──────────────────────────────────────────────────────

// Base: cast:plan with empty catalog, no focus, no session, no explain.
// Stripe fixture has 3 tools → alternatives non-empty. No prompts/resources
// in the stripe fixture → related spreads nothing → no prompts/resources keys.
const PLAN_KEYS_BASE: readonly string[] = [
  'alternatives', 'args', 'cast', 'hint', 'intent', 'latencyMs', 'resolved', 'resolvedBy',
];

const PLAN_KEYS_WITH_FOCUS: readonly string[] = [
  ...PLAN_KEYS_BASE, 'focus',
];

const PLAN_KEYS_WITH_FOCUS_AND_EXPLAIN: readonly string[] = [
  ...PLAN_KEYS_BASE, 'explanation', 'focus',
];

const PLAN_KEYS_WITH_SESSION: readonly string[] = [
  ...PLAN_KEYS_BASE, 'sessionContext',
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
  return join(tmpdir(), `ch1tty-gbf-${Date.now()}-${++_seq}.jsonl`);
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

async function castPlan(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true, ...extra });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'plan', `expected cast:plan, got cast="${String(body['cast'])}"`);
  return body;
}

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

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GBF-1: cast:plan base (no focus, no session, no explain) has EXACTLY 8 keys', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg);
    assertExactKeys(body, PLAN_KEYS_BASE, 'GBF-1');
  } finally {
    await agg.shutdown();
  }
});

test('GBF-2: cast:plan WITH focus:"finance" adds exactly `focus` (base+1=9 keys)', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, { focus: 'finance' });
    assertExactKeys(body, PLAN_KEYS_WITH_FOCUS, 'GBF-2');
    assert.equal(body['focus'], 'finance', 'focus field must equal the requested profile name');
  } finally {
    await agg.shutdown();
  }
});

test('GBF-3: cast:plan WITH focus AND explain:true has EXACTLY base + focus + explanation (10 keys)', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, { focus: 'finance', explain: true });
    assertExactKeys(body, PLAN_KEYS_WITH_FOCUS_AND_EXPLAIN, 'GBF-3');
  } finally {
    await agg.shutdown();
  }
});

test('GBF-4: cast:plan WITH sessionId (no focus) has EXACTLY base + sessionContext (9 keys)', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gbf-test-session-1';
    await agg.callTool('ch1tty/cast', { intent: INTENT, confirm: true, sessionId: SESSION });
    const body = await castPlan(agg, { sessionId: SESSION });
    assertExactKeys(body, PLAN_KEYS_WITH_SESSION, 'GBF-4');
  } finally {
    await agg.shutdown();
  }
});

test('GBF-5: cast:plan base does NOT contain scope, suggestions, resolvedFromCatalog, or chainContinuation', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg);
    const absent = ['scope', 'suggestions', 'resolvedFromCatalog', 'chainContinuation'];
    for (const key of absent) {
      assert.ok(
        !Object.prototype.hasOwnProperty.call(body, key),
        `"${key}" must be absent in cast:plan base (no focus, no scope param, no catalog match)`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});
