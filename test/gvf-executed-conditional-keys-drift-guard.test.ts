/**
 * GVF drift guard: freeze cast:executed exact top-level key set with conditional fields.
 *
 * GV froze the cast:executed top-level key sets for the base case (no session,
 * no focus, no explain), the with-session case, the with-explain case, and the
 * conditional-absence cases. However GV does NOT cover:
 *
 *   focus     — present when a focus profile is active (GV-5 asserts ABSENCE
 *               but never asserts the EXACT keyset when focus IS active)
 *
 * A regression accidentally adding an extra key when focus is active (e.g.
 * leaking `brainPath`, `focusRatio`, or `biasReason` at the top level) would
 * pass GV silently.
 *
 * GV also uses the live suggestions catalog (no `suggestionsCatalog` injection),
 * so its base keyset includes `resources` (suggestion catalog entries matching
 * 'list stripe payments' score above threshold). GVF uses an empty catalog via
 * `suggestionsCatalog: {}` — isolating these tests from routine catalog changes —
 * which changes the base set from 9 keys (GV) to 8 keys (GVF, no `resources`).
 *
 * Actual shapes (keyword route, stripe fixture, empty catalog, dryRun:false, probed 2026-09-25):
 *
 *   cast:executed (no session, no focus, no explain, empty catalog)
 *     → {alternatives, cast, intent, latencyBreakdown, latencyMs, resolved, resolvedBy, score}
 *       (8 keys — `resources` absent because listSuggestionResources() returns [] for empty catalog)
 *
 *   cast:executed (no session, focus:'finance', no explain, empty catalog)
 *     → base + focus  (9 keys)
 *
 *   cast:executed (no session, focus:'finance', explain:true, empty catalog)
 *     → base + focus + explanation  (10 keys)
 *
 *   cast:executed (sessionId, focus:'finance', no explain, empty catalog)
 *     → base + focus + sessionContext  (10 keys)
 *
 * Source: src-stdio/aggregator.ts line ~1648 (cast:executed body construction):
 *   { cast: 'executed', resolvedBy, intent, latencyMs, latencyBreakdown,
 *     ...(focusName ? { focus: focusName } : {}),
 *     ...(scopeAnnotation ? { scope: scopeAnnotation } : {}),
 *     ...(explanation ? { explanation } : {}),
 *     resolved, score,
 *     ...(catalogCombo ? { resolvedFromCatalog: {...} } : {}),
 *     ...(chainContinuation ? { chainContinuation } : {}),
 *     ...(alternatives.length > 0 ? { alternatives } : {}),
 *     ...related,
 *     ...(castSessionContext ? { sessionContext: castSessionContext } : {}),
 *     ...(focusSuggestions ? { suggestions: focusSuggestions } : {}) }
 *
 * GVF freezes:
 *
 *   GVF-1  cast:executed base with empty catalog has EXACTLY 8 keys.
 *          (Complements GV-1 which uses the live catalog and has `resources`;
 *           confirms empty catalog removes `resources` from executed responses.)
 *
 *   GVF-2  cast:executed WITH focus:'finance' adds exactly `focus` — base+1=9 keys.
 *          (GV-5 asserts focus ABSENT without focus param; no test freezes the
 *           exact keyset when focus IS active.)
 *
 *   GVF-3  cast:executed WITH focus AND explain:true adds exactly `focus` +
 *          `explanation` — base+2=10 keys.
 *          (No test covers the combined focus+explain conditional case for executed.)
 *
 *   GVF-4  cast:executed WITH focus AND sessionId adds exactly `focus` +
 *          `sessionContext` — base+2=10 keys.
 *          (GV-2 adds sessionContext without focus; no test covers the
 *           focus+session combination.)
 *
 *   GVF-5  cast:executed WITH focus active → `suggestions`, `scope`,
 *          `resolvedFromCatalog` ABSENT when no catalog combos match, no scope
 *          param, and match is direct (not catalog-routed).
 *
 * Frozen 2026-09-25.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:executed
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

// Base: cast:executed with empty catalog (no resources from suggestion catalog).
// Stripe fixture has 3 tools → 2 runner-ups → alternatives present.
// Empty catalog → no suggestion resources → no `resources` key.
const EXECUTED_KEYS_BASE_EMPTY_CATALOG: readonly string[] = [
  'alternatives', 'cast', 'intent', 'latencyBreakdown', 'latencyMs', 'resolved', 'resolvedBy', 'score',
];

const EXECUTED_KEYS_WITH_FOCUS: readonly string[] = [
  ...EXECUTED_KEYS_BASE_EMPTY_CATALOG, 'focus',
];

const EXECUTED_KEYS_WITH_FOCUS_AND_EXPLAIN: readonly string[] = [
  ...EXECUTED_KEYS_BASE_EMPTY_CATALOG, 'explanation', 'focus',
];

const EXECUTED_KEYS_WITH_FOCUS_AND_SESSION: readonly string[] = [
  ...EXECUTED_KEYS_BASE_EMPTY_CATALOG, 'focus', 'sessionContext',
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
  return join(tmpdir(), `ch1tty-gvf-${Date.now()}-${++_seq}.jsonl`);
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

test('GVF-1: cast:executed base with empty catalog has EXACTLY 8 keys (no resources)', async () => {
  const agg = makeAgg();
  try {
    const body = await executed(agg);
    assertExactKeys(body, EXECUTED_KEYS_BASE_EMPTY_CATALOG, 'GVF-1');
  } finally {
    await agg.shutdown();
  }
});

test('GVF-2: cast:executed WITH focus:"finance" adds exactly `focus` (base+1=9 keys)', async () => {
  const agg = makeAgg();
  try {
    const body = await executed(agg, { focus: 'finance' });
    assertExactKeys(body, EXECUTED_KEYS_WITH_FOCUS, 'GVF-2');
    assert.equal(body['focus'], 'finance', 'focus field must equal the requested profile name');
  } finally {
    await agg.shutdown();
  }
});

test('GVF-3: cast:executed WITH focus AND explain:true has EXACTLY base + focus + explanation (10 keys)', async () => {
  const agg = makeAgg();
  try {
    const body = await executed(agg, { focus: 'finance', explain: true });
    assertExactKeys(body, EXECUTED_KEYS_WITH_FOCUS_AND_EXPLAIN, 'GVF-3');
  } finally {
    await agg.shutdown();
  }
});

test('GVF-4: cast:executed WITH focus AND sessionId has EXACTLY base + focus + sessionContext (10 keys)', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gvf-test-session-1';
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION, focus: 'finance' });
    const body = await executed(agg, { focus: 'finance', sessionId: SESSION });
    assertExactKeys(body, EXECUTED_KEYS_WITH_FOCUS_AND_SESSION, 'GVF-4');
  } finally {
    await agg.shutdown();
  }
});

test('GVF-5: cast:executed WITH focus active does NOT contain suggestions, scope, or resolvedFromCatalog when not applicable', async () => {
  const agg = makeAgg();
  try {
    const body = await executed(agg, { focus: 'finance' });
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      'suggestions must be absent when catalog has no matching combos (empty catalog)',
    );
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'scope'),
      'scope must be absent when no scope param is passed',
    );
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'resolvedFromCatalog'),
      'resolvedFromCatalog must be absent when match is direct (not catalog-routed)',
    );
  } finally {
    await agg.shutdown();
  }
});
