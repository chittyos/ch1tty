/**
 * GEJ drift guard: freeze cast:plan exact top-level key set when scope,
 * focus, and explain are ALL present simultaneously — the 3-way and maximal
 * 4-way (+ sessionId) combinations that no prior test covers.
 *
 * Prior plan exact-keyset coverage:
 *
 *   GBD  froze base plan key set (no conditionals).
 *   GBF  froze plan conditional keys (+explain, +focus) without scope.
 *   GBP  froze plan + scope-only key set:
 *          scope+explain → base + scope + explanation (10 keys)
 *          scope+focus   → base + scope + focus       (10 keys)
 *          BUT NOT scope+focus+explain simultaneously.
 *   GBO  froze plan + scope+session combos:
 *          scope+session+explain → base + scope + sessionContext + explanation (11 keys)
 *          scope+session+focus   → base + scope + sessionContext + focus       (11 keys)
 *          BUT NOT scope+session+focus+explain (maximal).
 *   GEG  froze plan + focus+explain (no scope):
 *          focus+explain        → base + focus + explanation         (10 keys)
 *          focus+explain+session → base + focus + explanation + sessionContext (11 keys)
 *
 * Remaining gap: no test freezes the exact key set when scope + focus +
 * explain appear together. A regression that:
 *   (a) drops `explanation` when both scope and focus are active (treating
 *       the three as mutually exclusive in some combination), or
 *   (b) injects an unexpected key (e.g. `resolvedFromCatalog`, `resources`,
 *       or a spurious `scopeHint`) only when all three are present,
 * would pass GBP, GBO, and GEG silently.
 *
 * Actual cast:plan body construction (aggregator.ts ~line 1599):
 *   {
 *     cast: 'plan',
 *     resolvedBy, intent, latencyMs,
 *     ...(focusName   ? { focus: focusName } : {}),
 *     ...(scopeAnnot  ? { scope }            : {}),
 *     ...(explanation ? { explanation }       : {}),
 *     resolved: { tool, server, category, description, score, inputSchema },
 *     ...(catalogCombo ? { resolvedFromCatalog } : {}),
 *     ...(chainContinuation ? { chainContinuation } : {}),
 *     alternatives,
 *     ...related,
 *     ...(planSessionContext ? { sessionContext } : {}),
 *     ...(focusSuggestions   ? { suggestions }   : {}),
 *     args, hint,
 *   }
 *
 * GEJ freezes:
 *
 *   GEJ-1  scope + focus + explain (no session) → EXACTLY
 *          {alternatives, args, cast, explanation, focus, hint, intent,
 *           latencyMs, resolved, resolvedBy, scope} — 11 keys.
 *          (GBP base-9 + focus + explanation; confirms all three conditional
 *           fields coexist and no fourth key leaks in.)
 *
 *   GEJ-2  scope + session + focus + explain (maximal) → EXACTLY
 *          GEJ-1 set PLUS sessionContext — 12 keys.
 *          (GBO maximal gap: scope+session+focus+explain was never frozen.)
 *
 *   GEJ-3  scope + focus (no explain) → EXACTLY base + scope + focus,
 *          NO `explanation` key — symmetric absence guard alongside GEJ-1.
 *
 *   GEJ-4  scope + explain (no focus) → EXACTLY base + scope + explanation,
 *          NO `focus` key — already frozen by GBP; repeated here as the
 *          symmetric absence guard for focus alongside GEJ-1.
 *
 *   GEJ-5  explanation is a non-null object and focus is a non-empty string
 *          equal to the active profile name in the 3-way combination.
 *
 * Fixture: stripe only (list_payments, get_balance, create_payment_intent).
 * Focus profile: 'payments' → boosting stripe server tools.
 * Intent: "list stripe payments" reliably resolves to stripe/list_payments.
 * Catalog isolation: suggestionsCatalog:{} prevents catalog-resource injection
 * and keeps key sets deterministic (focusSuggestions null → no suggestions key).
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:plan
 *     key set, not explanation sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// Base (no focus, no scope, no explain, no session): from GCJ-1.
const PLAN_KEYS_BASE: readonly string[] = [
  'alternatives', 'args', 'cast', 'hint', 'intent', 'latencyMs', 'resolved', 'resolvedBy',
];

// GEJ-1: scope + focus + explain (no session) — base + scope + focus + explanation.
const PLAN_SCOPE_FOCUS_EXPLAIN_KEYS: readonly string[] = [
  ...PLAN_KEYS_BASE, 'explanation', 'focus', 'scope',
];

// GEJ-2: maximal — base + scope + sessionContext + focus + explanation.
const PLAN_SCOPE_SESSION_FOCUS_EXPLAIN_KEYS: readonly string[] = [
  ...PLAN_KEYS_BASE, 'explanation', 'focus', 'scope', 'sessionContext',
];

// GEJ-3: scope + focus (no explain) — base + scope + focus.
const PLAN_SCOPE_FOCUS_KEYS: readonly string[] = [
  ...PLAN_KEYS_BASE, 'focus', 'scope',
];

// GEJ-4: scope + explain (no focus) — base + scope + explanation.
const PLAN_SCOPE_EXPLAIN_KEYS: readonly string[] = [
  ...PLAN_KEYS_BASE, 'explanation', 'scope',
];

// ── Fixtures ──────────────────────────────────────────────────────────────────

const STRIPE_CFG: ServerConfig = {
  id: 'stripe',
  name: 'Stripe',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://stripe.com/mcp',
  lazy: true,
};

const FOCUS_PROFILES = {
  profiles: {
    payments: {
      description: 'Payment tools',
      categories: ['ecosystem' as const],
      servers: ['stripe'],
      boost: 0.5,
    },
  },
};

const INTENT = 'list stripe payments';

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gej-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator([STRIPE_CFG], {
    focusProfiles: FOCUS_PROFILES,
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    suggestionsCatalog: {},
  });
}

async function plan(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: INTENT,
    confirm: true,
    ...extra,
  });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(
    body['cast'],
    'plan',
    `expected cast:plan, got cast="${String(body['cast'])}" — scope may have filtered all matching tools`,
  );
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
    `${label}: exact key set mismatch.\n  expected: ${JSON.stringify(exp)}\n  actual:   ${JSON.stringify(actual)}`,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GEJ-1: cast:plan scope+focus+explain (no session) → EXACTLY base + scope + focus + explanation (11 keys)', async () => {
  const agg = makeAgg();
  try {
    const body = await plan(agg, {
      scope: { servers: ['stripe'] },
      focus: 'payments',
      explain: true,
    });
    assertExactKeys(body, PLAN_SCOPE_FOCUS_EXPLAIN_KEYS, 'GEJ-1 plan+scope+focus+explain (no session)');
  } finally {
    await agg.shutdown();
  }
});

test('GEJ-2: cast:plan scope+session+focus+explain (maximal) → EXACTLY base + scope + sessionContext + focus + explanation (12 keys)', async () => {
  const agg = makeAgg();
  try {
    const SID = 'gej-session-2';
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SID });
    const body = await plan(agg, {
      scope: { servers: ['stripe'] },
      sessionId: SID,
      focus: 'payments',
      explain: true,
    });
    assertExactKeys(body, PLAN_SCOPE_SESSION_FOCUS_EXPLAIN_KEYS, 'GEJ-2 plan+scope+session+focus+explain (maximal)');
  } finally {
    await agg.shutdown();
  }
});

test('GEJ-3: cast:plan scope+focus WITHOUT explain → EXACTLY base + scope + focus, NO explanation key', async () => {
  const agg = makeAgg();
  try {
    const body = await plan(agg, {
      scope: { servers: ['stripe'] },
      focus: 'payments',
    });
    assertExactKeys(body, PLAN_SCOPE_FOCUS_KEYS, 'GEJ-3 plan+scope+focus (no explain)');
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'explanation must be absent when explain is not set',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEJ-4: cast:plan scope+explain WITHOUT focus → EXACTLY base + scope + explanation, NO focus key', async () => {
  const agg = makeAgg();
  try {
    const body = await plan(agg, {
      scope: { servers: ['stripe'] },
      explain: true,
    });
    assertExactKeys(body, PLAN_SCOPE_EXPLAIN_KEYS, 'GEJ-4 plan+scope+explain (no focus)');
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'focus'),
      'focus must be absent when no focus param is passed',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEJ-5: explanation is a non-null object and focus equals active profile name in the 3-way combination', async () => {
  const agg = makeAgg();
  try {
    const body = await plan(agg, {
      scope: { servers: ['stripe'] },
      focus: 'payments',
      explain: true,
    });
    const exp = body['explanation'];
    assert.ok(
      exp !== null && typeof exp === 'object',
      `GEJ-5: explanation must be a non-null object; got ${typeof exp} (${JSON.stringify(exp)})`,
    );
    assert.equal(
      body['focus'],
      'payments',
      `GEJ-5: focus must equal "payments"; got ${JSON.stringify(body['focus'])}`,
    );
    assert.ok(
      typeof body['focus'] === 'string' && (body['focus'] as string).length > 0,
      'GEJ-5: focus must be a non-empty string',
    );
  } finally {
    await agg.shutdown();
  }
});
