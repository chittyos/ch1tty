/**
 * GEI drift guard: freeze cast:discovered exact top-level key set when BOTH a
 * focus profile is active AND explain:true is set.
 *
 * Prior tests cover the two conditionals independently:
 *
 *   GBH-2 froze cast:discovered + explain:true WITHOUT focus active:
 *         EXACTLY {cast, explanation, hint, intent, latencyMs, prompts, resolvedBy} — 7 keys.
 *
 *   GCI-1 froze cast:discovered + focus active WITHOUT explain:
 *         EXACTLY {cast, hint, intent, latencyMs, prompts, resolvedBy} — 6 keys
 *         (same as base; cast:discovered does NOT add a `focus` key, unlike
 *          cast:executed / cast:resolved / cast:plan which all do).
 *
 * Neither test covers the combination: focus ∧ explain on cast:discovered.
 * A regression that:
 *   (a) drops `explanation` from the discovered response when focus is also active
 *       (treating them as mutually exclusive), or
 *   (b) injects an unexpected key only when both focus and explain are present,
 * would pass GBH-2 (no focus) and GCI-1 (no explain) silently.
 *
 * Actual cast:discovered body construction (aggregator.ts ~line 1416):
 *   {
 *     cast: 'discovered', resolvedBy, intent, latencyMs,
 *     ...(scopeAnnotation  ? { scope }       : {}),
 *     ...(explanation      ? { explanation } : {}),
 *     hint,
 *     ...related,                    // prompts and/or resources
 *     ...(discoveredSessionCtx ? { sessionContext } : {}),
 *     ...(focusSuggestions ? { suggestions } : {}),
 *   }
 *
 * Notable: `focus: focusName` is NOT spread in cast:discovered (unlike
 * cast:executed / cast:resolved / cast:plan). GEI confirms explanation
 * appears without `focus` leaking alongside it.
 *
 * GEI freezes:
 *
 *   GEI-1  cast:discovered + focus active + explain:true → EXACTLY
 *          {cast, explanation, hint, intent, latencyMs, prompts, resolvedBy} — 7 keys.
 *          (GBH-2 base set + focus profile active; confirms explanation survives
 *           the focus code path and `focus` key does NOT leak.)
 *
 *   GEI-2  cast:discovered + focus active + explain:true + sessionId → EXACTLY
 *          GEI-1 set PLUS sessionContext — 8 keys.
 *          (Confirms sessionContext adds alongside focus+explanation without
 *           displacing or blocking either.)
 *
 *   GEI-3  cast:discovered + focus active + explain:false → exactly GCI-1 base set,
 *          NO `explanation` key — absence guard.
 *
 *   GEI-4  `explanation` is present and is an object (not null, not a
 *          primitive) when explain:true is set with focus active.
 *
 *   GEI-5  `explanation` sub-object has a string `method` key when explain:true
 *          is set with focus active.
 *
 * Fixture: billing server (manage_subscription tool, retrieve_invoice prompt).
 * Intent: "find invoice pdf" — no keyword overlap with the tool → cast:discovered
 * (prompt keyword "invoice" matches but no tool matches).
 * Focus profile: 'billing' → boosting billing server tools.
 * Catalog isolation: suggestionsCatalog:{} prevents catalog injection.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:discovered
 *     key set, not explanation sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src-stdio/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// Base (GBH-1 / GCI-1): no focus, no explain, billing prompt matches intent.
const DISCOVERED_BASE: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'prompts', 'resolvedBy',
];

// focus active + explain:true: base + explanation (focus key does NOT appear).
const DISCOVERED_FOCUS_EXPLAIN: readonly string[] = [
  ...DISCOVERED_BASE, 'explanation',
];

// focus active + explain:true + sessionId: above + sessionContext.
const DISCOVERED_FOCUS_EXPLAIN_SESSION: readonly string[] = [
  ...DISCOVERED_BASE, 'explanation', 'sessionContext',
];

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BILLING_CFG: ServerConfig = {
  id: 'billing',
  name: 'Billing',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://billing.test/mcp',
  lazy: true,
};

const FOCUS_PROFILES = {
  profiles: {
    billing: {
      description: 'Billing and finance tools',
      categories: ['ecosystem' as const],
      servers: ['billing'],
      boost: 0.5,
    },
  },
};

// Intent has no keyword overlap with the tool ("subscription") but does match
// the prompt keyword "invoice" → reliably triggers cast:discovered.
const INTENT = 'find invoice pdf';

// Keyword-only coordinator: disables brain routing for deterministic scoring.
class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gei-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('billing', {
    tools: [{
      name: 'manage_subscription',
      description: 'Manage billing subscriptions for the account',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '{"subscriptions":[]}' }] },
    }],
    prompts: [{
      name: 'retrieve_invoice',
      description: 'Retrieve invoice history and details for a billing period',
    }],
    resources: [],
  });
  return new Aggregator([BILLING_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
    focus: 'billing',
    focusProfiles: FOCUS_PROFILES,
    suggestionsCatalog: {},
  });
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

async function discovered(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: INTENT,
    ...extra,
  });
  assert.equal((result as { isError?: unknown }).isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(
    body['cast'],
    'discovered',
    `expected cast:discovered, got cast="${String(body['cast'])}" (intent may have matched a tool)`,
  );
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GEI-1: cast:discovered + focus active + explain:true → EXACTLY base + explanation (7 keys, no `focus` key)', async () => {
  const agg = makeAgg();
  try {
    const body = await discovered(agg, { explain: true });
    assertExactKeys(body, DISCOVERED_FOCUS_EXPLAIN, 'GEI-1 discovered+focus+explain');
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'focus'),
      'GEI-1: `focus` key must be absent in cast:discovered (unlike cast:executed/resolved/plan)',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEI-2: cast:discovered + focus + explain + sessionId → EXACTLY base + explanation + sessionContext (8 keys)', async () => {
  const agg = makeAgg();
  try {
    const SID = 'gei-session-2';
    // Warm session so sessionContext is populated.
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SID });
    const body = await discovered(agg, { explain: true, sessionId: SID });
    assertExactKeys(body, DISCOVERED_FOCUS_EXPLAIN_SESSION, 'GEI-2 discovered+focus+explain+session');
  } finally {
    await agg.shutdown();
  }
});

test('GEI-3: cast:discovered + focus active WITHOUT explain → exactly base (6 keys), NO explanation key', async () => {
  const agg = makeAgg();
  try {
    const body = await discovered(agg);
    assertExactKeys(body, DISCOVERED_BASE, 'GEI-3 discovered+focus (no explain)');
    assert.ok(
      !Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'GEI-3: explanation must be absent when explain is not set',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEI-4: explanation is an object (not null, not primitive) when explain:true is set with focus active', async () => {
  const agg = makeAgg();
  try {
    const body = await discovered(agg, { explain: true });
    assert.ok(
      Object.prototype.hasOwnProperty.call(body, 'explanation'),
      'GEI-4: explanation must be present when explain:true is set',
    );
    const exp = body['explanation'];
    assert.ok(
      exp !== null && typeof exp === 'object' && !Array.isArray(exp),
      `GEI-4: explanation must be a non-null, non-array object; got ${typeof exp} (${JSON.stringify(exp)})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GEI-5: explanation sub-object has a string method key when explain:true is set with focus active', async () => {
  const agg = makeAgg();
  try {
    const body = await discovered(agg, { explain: true });
    const explanation = body['explanation'] as Record<string, unknown>;
    assert.ok(
      explanation !== null && typeof explanation === 'object' && !Array.isArray(explanation),
      'GEI-5: explanation must be a non-null, non-array object',
    );
    assert.equal(
      typeof explanation['method'],
      'string',
      `GEI-5: explanation.method must be a string; got ${typeof explanation['method']}`,
    );
    assert.ok(
      (explanation['method'] as string).length > 0,
      'GEI-5: explanation.method must be a non-empty string',
    );
  } finally {
    await agg.shutdown();
  }
});
