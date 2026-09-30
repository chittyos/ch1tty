/**
 * GBE drift guard: freeze cast:resolved exact top-level key set with conditional fields.
 *
 * GU froze cast:resolved exact top-level key sets for the base case (no session)
 * and with-session case — EXACTLY {cast, intent, latencyMs, resolved, resolvedBy}
 * and those plus sessionContext. However GU does NOT cover the additional
 * conditional fields that appear in cast:resolved:
 *
 *   focus        — present when a focus profile is active (focusName truthy)
 *   explanation  — present when explain:true is passed
 *   scope        — present when a scope annotation is set
 *   catalogCombo — present when a catalog combo matches the intent
 *
 * A regression accidentally emitting one of these in ALL responses (or preventing
 * them from appearing when they should) would pass GU silently.
 *
 * Actual shapes (keyword route, stripe fixture, dryRun:true, probed 2026-09-25):
 *
 *   cast:resolved (no session, no focus, no explain)
 *     → {cast, intent, latencyMs, resolved, resolvedBy}  ← GU-3 base
 *
 *   cast:resolved (no session, explain:true)
 *     → base + explanation  (6 keys)
 *
 *   cast:resolved (no session, focus:'finance')
 *     → base + focus        (6 keys)
 *
 *   cast:resolved (no session, focus:'finance', explain:true)
 *     → base + focus + explanation  (7 keys)
 *
 *   cast:resolved does NOT contain scope or catalogCombo in any of the above
 *
 * Source: src-stdio/aggregator.ts line ~1564 (dryRun path):
 *   { cast: 'resolved', resolvedBy, intent, latencyMs,
 *     ...(focusName ? { focus: focusName } : {}),
 *     ...(scopeAnnotation ? { scope: scopeAnnotation } : {}),
 *     ...(explanation ? { explanation } : {}),
 *     resolved: { tool, score },
 *     ...(catalogCombo ? { catalogCombo: {...} } : {}),
 *     ...(resolvedSessionContext ? { sessionContext: resolvedSessionContext } : {}) }
 *
 * GBE freezes:
 *
 *   GBE-1  cast:resolved WITH explain:true adds exactly `explanation` — base+1=6 keys.
 *          (GU covers base without explain; no test freezes the +explain set for resolved.)
 *
 *   GBE-2  cast:resolved WITH focus:'finance' adds exactly `focus` — base+1=6 keys.
 *          (GU covers base without focus; no test freezes the +focus set for resolved.)
 *
 *   GBE-3  cast:resolved WITH explain AND focus has EXACTLY 7 keys (base+focus+explanation).
 *          (No test covers the combined conditional case.)
 *
 *   GBE-4  cast:resolved does NOT contain scope or catalogCombo when not applicable.
 *          (Explicit absence guards for the two conditionals not covered by GBE-1/2/3.)
 *
 *   GBE-5  cast:resolved does NOT contain sessionContext when no sessionId given.
 *          (GU-5 covers no_match; no symmetric explicit absence guard for resolved.)
 *
 * Frozen 2026-09-25.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:resolved
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

const RESOLVED_KEYS_BASE: readonly string[] = [
  'cast', 'intent', 'latencyMs', 'resolved', 'resolvedBy',
];

const RESOLVED_KEYS_WITH_EXPLAIN: readonly string[] = [
  ...RESOLVED_KEYS_BASE, 'explanation',
];

const RESOLVED_KEYS_WITH_FOCUS: readonly string[] = [
  ...RESOLVED_KEYS_BASE, 'focus',
];

const RESOLVED_KEYS_WITH_EXPLAIN_AND_FOCUS: readonly string[] = [
  ...RESOLVED_KEYS_BASE, 'explanation', 'focus',
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
  return join(tmpdir(), `ch1tty-gbe-${Date.now()}-${++_seq}.jsonl`);
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
  assert.equal(body['cast'], 'resolved', `expected cast:resolved, got cast="${String(body['cast'])}"`);
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

test('GBE-1: cast:resolved WITH explain:true has EXACTLY base + explanation (6 keys)', async () => {
  const agg = makeAgg();
  try {
    const body = await resolved(agg, { explain: true });
    assertExactKeys(body, RESOLVED_KEYS_WITH_EXPLAIN, 'GBE-1');
  } finally {
    await agg.shutdown();
  }
});

test('GBE-2: cast:resolved WITH focus:"finance" has EXACTLY base + focus (6 keys)', async () => {
  const agg = makeAgg();
  try {
    const body = await resolved(agg, { focus: 'finance' });
    assertExactKeys(body, RESOLVED_KEYS_WITH_FOCUS, 'GBE-2');
    assert.equal(body['focus'], 'finance', 'focus field must equal the requested profile name');
  } finally {
    await agg.shutdown();
  }
});

test('GBE-3: cast:resolved WITH explain AND focus has EXACTLY 7 keys (base + explanation + focus)', async () => {
  const agg = makeAgg();
  try {
    const body = await resolved(agg, { explain: true, focus: 'finance' });
    assertExactKeys(body, RESOLVED_KEYS_WITH_EXPLAIN_AND_FOCUS, 'GBE-3');
  } finally {
    await agg.shutdown();
  }
});

test('GBE-4: cast:resolved does NOT contain scope or catalogCombo when not applicable', async () => {
  const agg = makeAgg();
  try {
    const body = await resolved(agg);
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'scope'),
      'scope must be absent in cast:resolved when no scope annotation is set',
    );
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'catalogCombo'),
      'catalogCombo must be absent in cast:resolved when no catalog combo matches',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GBE-5: cast:resolved does NOT contain sessionContext when no sessionId is given', async () => {
  const agg = makeAgg();
  try {
    const body = await resolved(agg);
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'sessionContext'),
      'sessionContext must be absent in cast:resolved when no sessionId is given',
    );
  } finally {
    await agg.shutdown();
  }
});
