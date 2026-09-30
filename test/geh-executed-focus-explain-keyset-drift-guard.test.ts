/**
 * GEH drift guard: freeze cast:executed exact top-level key set when BOTH a
 * focus profile is active AND explain:true is set.
 *
 * Prior tests cover the two conditionals independently:
 *
 *   GV-4 froze cast:executed + explain:true WITHOUT focus active:
 *        EXACTLY {alternatives, cast, explanation, intent, latencyBreakdown,
 *                 latencyMs, resolved, resolvedBy, score} (base 8 + explanation).
 *
 *   GBZ-1 froze cast:executed + focus active WITHOUT explain:
 *         EXACTLY {alternatives, cast, focus, intent, latencyBreakdown,
 *                  latencyMs, resolved, resolvedBy, score} (base 8 + focus).
 *
 *   GBZ-3 asserts that `explanation` is absent when explain is NOT set —
 *         it does NOT cover the case where explain IS set alongside focus.
 *
 * Neither test covers the combination: focus ∧ explain on cast:executed.
 * A regression that:
 *   (a) drops `explanation` from the executed response when focus is also active
 *       (treating them as mutually exclusive), or
 *   (b) injects an unexpected key (e.g. a leaked `focusHint` or `focusScore`)
 *       only when both focus and explain are present,
 * would pass GV-4 (no focus) and GBZ (no explain) silently.
 *
 * Actual cast:executed body construction (aggregator.ts ~line 1648/1658/1668):
 *   {
 *     cast: 'executed',
 *     resolvedBy, intent, latencyMs, latencyBreakdown, resolved, score,
 *     ...(focusName   ? { focus: focusName } : {}),
 *     ...(scopeAnnot  ? { scope }            : {}),
 *     ...(explanation ? { explanation }       : {}),
 *     alternatives,
 *     ...related,
 *     ...(execSessionContext ? { sessionContext } : {}),
 *     ...(focusSuggestions   ? { suggestions }   : {}),
 *   }
 *
 * GEH freezes:
 *
 *   GEH-1  cast:executed + focus active + explain:true → EXACTLY
 *          {alternatives, cast, explanation, focus, intent, latencyBreakdown,
 *           latencyMs, resolved, resolvedBy, score} — 10 keys.
 *          (GBZ base 9 + explanation; GV-4 base 9 + focus; confirms both
 *           conditional fields appear together and no third key leaks.)
 *
 *   GEH-2  cast:executed + focus active + explain:true + sessionId → EXACTLY
 *          GEH-1 set PLUS sessionContext — 11 keys.
 *          (Confirms sessionContext adds alongside focus+explanation without
 *           displacing or blocking either.)
 *
 *   GEH-3  cast:executed + focus active + explain:false → exactly GBZ base set,
 *          NO `explanation` key — confirms explanation is absent when explain
 *          is not set (absence guard alongside the presence guard in GEH-1).
 *
 *   GEH-4  `explanation` is present and is an object (not null, not string/array)
 *          when both focus and explain:true are set on cast:executed.
 *          (GEG-4 covered this for cast:plan; GEH-4 covers cast:executed.)
 *
 *   GEH-5  explanation sub-object has a `method` key of typeof 'string' and
 *          non-empty — the most stable field in every explanation sub-object.
 *          (GEE-5 covered this for cast:resolved; GEH-5 covers cast:executed
 *           on the focus+explain path.)
 *
 * Probed key sets (aggregator v4.1.0, 2026-09-30):
 *   executed + focus + explain:true      →  10 keys (confirmed)
 *   executed + focus + explain + session →  11 keys (confirmed)
 *   executed + focus + no explain        →   9 keys (EXECUTED_FOCUS_KEYS_BASE)
 *
 * Source: src-stdio/aggregator.ts lines ~1648–1670 (cast:executed body).
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level key set
 *     presence/absence of `explanation`, not the sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// Focus active, no explain, no session (from GBZ-1).
const EXECUTED_FOCUS_KEYS_BASE: readonly string[] = [
  'alternatives', 'cast', 'focus', 'intent', 'latencyBreakdown',
  'latencyMs', 'resolved', 'resolvedBy', 'score',
];

// focus active + explain:true: GBZ base + explanation (the gap GEH freezes).
const EXECUTED_FOCUS_EXPLAIN_KEYS: readonly string[] = [
  ...EXECUTED_FOCUS_KEYS_BASE, 'explanation',
];

// focus active + explain:true + sessionId.
const EXECUTED_FOCUS_EXPLAIN_SESSION_KEYS: readonly string[] = [
  ...EXECUTED_FOCUS_KEYS_BASE, 'explanation', 'sessionContext',
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
  return join(tmpdir(), `ch1tty-geh-${Date.now()}-${++_seq}.jsonl`);
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

async function executed(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: INTENT,
    ...extra,
  });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(
    body['cast'],
    'executed',
    `expected cast:executed, got cast="${String(body['cast'])}"`,
  );
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GEH-1: cast:executed + focus active + explain:true has EXACTLY base + focus + explanation (10 keys)', async () => {
  const agg = makeAgg();
  try {
    const body = await executed(agg, { focus: 'payments', explain: true });
    const actual = Object.keys(body).sort();
    const expected = [...EXECUTED_FOCUS_EXPLAIN_KEYS].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:executed+focus+explain top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEH-2: cast:executed + focus + explain + sessionId has EXACTLY base + focus + explanation + sessionContext (11 keys)', async () => {
  const agg = makeAgg();
  try {
    const SID = 'geh-session-2';
    // Warm session so sessionContext is populated.
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SID });
    const body = await executed(agg, { focus: 'payments', explain: true, sessionId: SID });
    const actual = Object.keys(body).sort();
    const expected = [...EXECUTED_FOCUS_EXPLAIN_SESSION_KEYS].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:executed+focus+explain+session top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEH-3: cast:executed + focus active + explain:false has EXACTLY GBZ base set — NO explanation key', async () => {
  const agg = makeAgg();
  try {
    const body = await executed(agg, { focus: 'payments', explain: false });
    const actual = Object.keys(body).sort();
    const expected = [...EXECUTED_FOCUS_KEYS_BASE].sort();
    assert.deepEqual(
      actual,
      expected,
      `cast:executed+focus+noexplain top-level keys must be exactly ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEH-4: cast:executed + focus active + explain:true — explanation is an object', async () => {
  const agg = makeAgg();
  try {
    const body = await executed(agg, { focus: 'payments', explain: true });
    assert.ok(
      'explanation' in body,
      'explanation key must be present when explain:true is passed',
    );
    const exp = body['explanation'];
    assert.ok(
      exp !== null && typeof exp === 'object' && !Array.isArray(exp),
      `explanation must be a plain object, got ${Array.isArray(exp) ? 'array' : typeof exp}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEH-5: cast:executed + focus active + explain:true — explanation.method is a non-empty string', async () => {
  const agg = makeAgg();
  try {
    const body = await executed(agg, { focus: 'payments', explain: true });
    const exp = body['explanation'] as Record<string, unknown>;
    assert.ok(exp !== null && typeof exp === 'object', 'explanation must be an object');
    assert.equal(
      typeof exp['method'],
      'string',
      `explanation.method must be typeof 'string', got ${typeof exp['method']}`,
    );
    assert.ok(
      (exp['method'] as string).length > 0,
      'explanation.method must be a non-empty string',
    );
  } finally {
    await agg.shutdown();
  }
});
