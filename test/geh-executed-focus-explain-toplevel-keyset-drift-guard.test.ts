/**
 * GEH drift guard: freeze cast:executed exact top-level key set when BOTH a
 * focus profile is active AND explain:true is set.
 *
 * Prior tests cover the two conditionals independently and in other combos:
 *
 *   GV-4 froze cast:executed + explain:true WITHOUT focus active:
 *        EXACTLY {alternatives, cast, explanation, intent, latencyBreakdown,
 *                 latencyMs, resolved, resolvedBy, score} (base 8 + explanation).
 *
 *   GBZ-1 froze cast:executed + focus active WITHOUT explain, no catalog:
 *          EXACTLY {alternatives, cast, focus, intent, latencyBreakdown,
 *                   latencyMs, resolved, resolvedBy, score} (focus base 9 keys).
 *
 *   GCF-4 froze session + focus + explain (session present):
 *          EXACTLY {alternatives, cast, explanation, focus, intent,
 *                   latencyBreakdown, latencyMs, resolved, resolvedBy,
 *                   score, sessionContext} — but with session active.
 *
 * The gap: no test freezes the exact key set of cast:executed when focus IS
 * active, explain IS set, and there is NO session. A regression that:
 *   (a) drops `explanation` when a focus profile is active (treating them as
 *       mutually exclusive), or
 *   (b) injects an unexpected key (e.g. `focusScore`, `focusHint`,
 *       `focusBoost`, or a leaked internal annotation) only when both
 *       focus and explain are present,
 * would pass GV-4 (no focus), GBZ-1 (no explain), and GCF-4 (has session)
 * silently.
 *
 * No test freezes the exact key set when focus + explain + catalog are all
 * active simultaneously without a session either.
 *
 * Actual cast:executed body (aggregator.ts ~line 1648):
 *   {
 *     cast: 'executed',
 *     resolvedBy, intent, latencyMs, latencyBreakdown,
 *     resolved, score,
 *     ...(focusName    ? { focus: focusName }     : {}),
 *     ...(explanation  ? { explanation }          : {}),
 *     alternatives,
 *     ...(castSessionContext ? { sessionContext } : {}),
 *     ...(focusSuggestions  ? { suggestions }    : {}),
 *     ...(resolvedFromCatalog ? { resolvedFromCatalog } : {}),
 *     ...(chainContinuation  ? { chainContinuation }   : {}),
 *     ...(scopeAnnot         ? { scope }                : {}),
 *     ...(castResources.length > 0 ? { resources }     : {}),
 *   }
 *
 * GEH freezes:
 *
 *   GEH-1  cast:executed + focus active + explain:true (no session, no catalog)
 *          → EXACTLY {alternatives, cast, explanation, focus, intent,
 *            latencyBreakdown, latencyMs, resolved, resolvedBy, score} — 10 keys.
 *          (GBZ-1 base 9 + explanation; GV-4 base 8 + focus; confirms both
 *           conditional fields appear together and no third key leaks.)
 *
 *   GEH-2  cast:executed + focus + explain + sessionId → EXACTLY GEH-1 set
 *          PLUS sessionContext — 11 keys.
 *          (Confirms sessionContext adds alongside focus+explanation without
 *           displacing or blocking either; fills the no-session side of GCF-4.)
 *
 *   GEH-3  cast:executed + focus active WITHOUT explain → exactly the GBZ-1
 *          base set (9 keys), NO `explanation` key.
 *          (Absence guard: confirms that focus active alone does not inject
 *           explanation; symmetric to GEH-1's presence guard.)
 *
 *   GEH-4  `explanation` is an object (not null, not a primitive) when
 *          focus active + explain:true.
 *          (Type guard — explanation must survive the focus code path.)
 *
 *   GEH-5  cast:executed + focus + explain + catalog suggestions (no session)
 *          → EXACTLY {alternatives, cast, chainContinuation, explanation, focus,
 *            intent, latencyBreakdown, latencyMs, resolved, resolvedBy,
 *            resolvedFromCatalog, resources, score, suggestions} — 14 keys.
 *          (GBZ-2 covers focus + catalog WITHOUT explain (13 keys); GEH-5 adds
 *           explain and confirms it slots in alongside all catalog fields without
 *           dropping or displacing any of them.)
 *
 * Fixture: stripe only (list_payments, get_balance, create_payment_intent).
 * Focus profile: 'payments' → boosting stripe server tools.
 * Intent: "list stripe payments" reliably resolves to stripe/list_payments.
 * Catalog: injected only for GEH-5; empty ({}) for GEH-1 through GEH-4.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:executed
 *     key set, not the explanation sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// GBZ-1 focus base (no catalog, no explain, no session).
const EXECUTED_FOCUS_BASE: readonly string[] = [
  'alternatives', 'cast', 'focus', 'intent', 'latencyBreakdown',
  'latencyMs', 'resolved', 'resolvedBy', 'score',
];

// GEH-1: focus + explain, no session, no catalog (base + explanation).
const EXECUTED_FOCUS_EXPLAIN: readonly string[] = [
  ...EXECUTED_FOCUS_BASE, 'explanation',
];

// GEH-2: focus + explain + session (GEH-1 + sessionContext).
const EXECUTED_FOCUS_EXPLAIN_SESSION: readonly string[] = [
  ...EXECUTED_FOCUS_EXPLAIN, 'sessionContext',
];

// GEH-5: focus + explain + catalog, no session (GBZ-2 catalog set + explanation).
const EXECUTED_FOCUS_EXPLAIN_CATALOG: readonly string[] = [
  'alternatives', 'cast', 'chainContinuation', 'explanation', 'focus', 'intent',
  'latencyBreakdown', 'latencyMs', 'resolved', 'resolvedBy',
  'resolvedFromCatalog', 'resources', 'score', 'suggestions',
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

// Catalog with a chain starting at stripe/list_payments → triggers
// resolvedFromCatalog + chainContinuation on a resolved match.
const SUGGESTIONS_CATALOG = {
  payments: {
    description: 'Payments-focused combos',
    combos: [
      {
        name: 'List and get balance',
        chain: ['stripe/list_payments', 'stripe/get_balance'],
        accomplishes: 'list payments then check balance',
        verified: true,
      },
    ],
    prompts: [{ text: 'check stripe balance', resolves_to: 'stripe/get_balance' }],
  },
};

const INTENT = 'list stripe payments';

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-geh-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(opts: { withCatalog: boolean }): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator([STRIPE_CFG], {
    focusProfiles: FOCUS_PROFILES,
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    suggestionsCatalog: opts.withCatalog ? SUGGESTIONS_CATALOG : {},
  });
}

async function castExecuted(
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

test('GEH-1: cast:executed + focus active + explain:true (no session, no catalog) has EXACTLY 10-key focus+explain set', async () => {
  const agg = makeAgg({ withCatalog: false });
  try {
    const body = await castExecuted(agg, { focus: 'payments', explain: true });
    assertExactKeys(body, EXECUTED_FOCUS_EXPLAIN, 'GEH-1');
  } finally {
    await agg.shutdown();
  }
});

test('GEH-2: cast:executed + focus + explain + sessionId has EXACTLY focus+explain+sessionContext (11 keys)', async () => {
  const agg = makeAgg({ withCatalog: false });
  try {
    const SID = 'geh-session-2';
    // Warm session so sessionContext is populated.
    await agg.callTool('ch1tty/cast', { intent: INTENT, focus: 'payments', sessionId: SID });
    const body = await castExecuted(agg, { focus: 'payments', explain: true, sessionId: SID });
    assertExactKeys(body, EXECUTED_FOCUS_EXPLAIN_SESSION, 'GEH-2');
  } finally {
    await agg.shutdown();
  }
});

test('GEH-3: cast:executed + focus active WITHOUT explain has EXACTLY focus base set, no explanation key', async () => {
  const agg = makeAgg({ withCatalog: false });
  try {
    const body = await castExecuted(agg, { focus: 'payments' });
    assertExactKeys(body, EXECUTED_FOCUS_BASE, 'GEH-3');
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'explanation must be absent when explain is not set',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEH-4: explanation is an object (not null, not a primitive) when focus active + explain:true', async () => {
  const agg = makeAgg({ withCatalog: false });
  try {
    const body = await castExecuted(agg, { focus: 'payments', explain: true });
    assert.ok(
      Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'explanation must be present when explain:true is set',
    );
    const exp = body['explanation'];
    assert.ok(
      exp !== null && typeof exp === 'object',
      `explanation must be a non-null object; got ${typeof exp} (${JSON.stringify(exp)})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEH-5: cast:executed + focus + explain + catalog (no session) has EXACTLY 14-key focus+explain+catalog set', async () => {
  const agg = makeAgg({ withCatalog: true });
  try {
    const body = await castExecuted(agg, { focus: 'payments', explain: true });
    assertExactKeys(body, EXECUTED_FOCUS_EXPLAIN_CATALOG, 'GEH-5');
  } finally {
    await agg.shutdown();
  }
});
