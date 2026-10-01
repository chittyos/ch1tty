/**
 * GEM drift guard: freeze cast:discovered exact top-level key set when scope,
 * focus, AND explain are ALL active simultaneously (3-way and maximal 4-way).
 *
 * Prior discovered exact-keyset coverage:
 *
 *   GBC  : froze cast:discovered base key set (6 keys)
 *   GBH  : froze discovered conditional keys — scope, explain, session individually
 *          (GBH-4: scope+no-focus = 7 keys)
 *   GBS  : froze discovered when scope+session are both active
 *   GCI  : froze discovered when focus is active; confirmed `focus` key NEVER
 *          present in cast:discovered even when focus profile is loaded
 *   GEH  : froze discovered when scope+focus are both active (no explain)
 *          GEH-1: scope+focus → base + scope (7 keys, `focus` absent)
 *   GEJ  : froze discovered when focus+explain are both active (no scope)
 *          GEJ-1: focus+explain → base + explanation (7 keys, `focus` absent)
 *
 * Gap: No test on main freezes the exact key set when ALL THREE of scope, focus,
 * AND explain are simultaneously active on cast:discovered.
 *
 * Two regressions are possible in the 3-way intersection:
 *
 *   (a) The scope code path inadvertently suppresses `explanation` when focus is
 *       also active, treating scope as incompatible with the explain pipeline.
 *       GEH (scope+focus) and GEJ (focus+explain) would both still pass.
 *
 *   (b) A developer adds `focus: focusName` to the cast:discovered body when the
 *       scope filter confirms only in-focus servers are reachable, mirroring
 *       cast:executed / cast:resolved / cast:plan (which DO carry `focus`). Both
 *       GEH and GEJ tests pass (neither activates all three simultaneously), so
 *       this injection would be silent.
 *
 * Source (src-stdio/aggregator.ts):
 *
 *   cast:discovered body construction:
 *     {
 *       cast: 'discovered', resolvedBy, intent, latencyMs,
 *       ...(scopeAnnotation  ? { scope }         : {}),
 *       ...(explanation      ? { explanation }    : {}),
 *       hint,
 *       ...related,              // prompts and/or resources (NOT scope-filtered)
 *       ...(discoveredSessionCtx ? { sessionContext } : {}),
 *       ...(focusSuggestions     ? { suggestions }    : {}),
 *     }
 *
 *   Notable: `focus: focusName` is NOT spread here (unlike cast:executed /
 *   cast:resolved / cast:plan). GEM extends GEJ's confirmation of this absence
 *   into the 3-way scope+focus+explain combination.
 *
 *   Scope filters TOOLS only (not prompts, not resources, not suggestion
 *   resources). listSuggestionResources() entries are included regardless
 *   of scope; they appear as `resources` when catalog is non-empty and
 *   an entry's keywords score > 0.1 against intent.
 *
 * GEM freezes:
 *
 *   GEM-1  scope+focus+explain (no catalog, no session):
 *          EXACTLY {cast, explanation, hint, intent, latencyMs, prompts,
 *          resolvedBy, scope} — 8 keys.
 *          (GEH-1 base + scope + GEJ's explanation; `focus` absent.)
 *
 *   GEM-2  scope+focus+explain + sessionId (no catalog):
 *          EXACTLY GEM-1 PLUS sessionContext — 9 keys.
 *          (Confirms sessionContext slots in alongside scope+explanation
 *           without displacing either.)
 *
 *   GEM-3  scope+focus+explain + catalog (no session):
 *          EXACTLY GEM-1 PLUS resources + suggestions — 10 keys.
 *          (Catalog adds listSuggestionResources() entries that survive
 *           the scope filter and score against intent.)
 *
 *   GEM-4  scope+focus+explain + catalog + sessionId (maximal 4-way):
 *          EXACTLY GEM-1 PLUS explanation, resources, sessionContext,
 *          suggestions → 11 keys. The maximal cast:discovered key set.
 *
 *   GEM-5  Absence guard: `focus` key is ABSENT in all GEM variants.
 *          Regression guard against scope or 3-way logic leaking `focus`
 *          by analogy with cast:executed / cast:resolved / cast:plan.
 *
 * Fixture: billing server (manage_subscription tool, retrieve_invoice prompt).
 * Intent: "find invoice pdf" — no keyword overlap with the tool, "invoice"
 * matches the prompt keyword → reliably triggers cast:discovered.
 * Scope: { servers: ['billing'] } — single-server scope filter.
 * Focus profile: 'billing' → boosting billing server tools.
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - Public MCP surface: unchanged (test-only file, no aggregator edits)
 *   - buildCastExplanation metric freeze: not applicable (top-level
 *     cast:discovered key set, not explanation sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src-stdio/coordinator.js';
import type { FocusSuggestions } from '../src-stdio/suggestions.js';
import type { FocusProfile } from '../src-stdio/focus.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// GBC base: no scope, no focus, no explain, no session, no catalog.
const BASE: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'prompts', 'resolvedBy',
];

// GEM-1: scope + focus + explain (no catalog, no session).
const SCOPE_FOCUS_EXPLAIN: readonly string[] = [
  ...BASE, 'explanation', 'scope',
];

// GEM-2: scope + focus + explain + sessionId (no catalog).
const SCOPE_FOCUS_EXPLAIN_SESSION: readonly string[] = [
  ...SCOPE_FOCUS_EXPLAIN, 'sessionContext',
];

// GEM-3: scope + focus + explain + catalog (no session).
const SCOPE_FOCUS_EXPLAIN_CATALOG: readonly string[] = [
  ...SCOPE_FOCUS_EXPLAIN, 'resources', 'suggestions',
];

// GEM-4: scope + focus + explain + catalog + session (maximal 4-way).
const SCOPE_FOCUS_EXPLAIN_CATALOG_SESSION: readonly string[] = [
  ...SCOPE_FOCUS_EXPLAIN, 'resources', 'sessionContext', 'suggestions',
];

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BILLING_FOCUS_PROFILE: FocusProfile = {
  description: 'Billing and finance tools',
  categories: ['ecosystem'],
  servers: ['billing'],
  boost: 0.5,
};

const BILLING_CATALOG: Record<string, FocusSuggestions> = {
  billing: {
    description: 'Billing tools for invoice and subscription management.',
    combos: [{
      name: 'billing-subscription-list',
      chain: ['billing/manage_subscription'],
      accomplishes: 'List or manage active billing subscriptions.',
      verified: false,
    }],
    prompts: [{
      text: 'Retrieve invoice history',
      resolves_to: 'billing/retrieve_invoice',
    }],
  },
};

const BASE_CONFIGS: ServerConfig[] = [{
  id: 'billing',
  name: 'Billing',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://billing.test/mcp',
  lazy: true,
}];

// Intent: no keyword overlap with tool ("subscription"), "invoice" matches
// the prompt keyword → reliably triggers cast:discovered.
const INTENT = 'find invoice pdf';

// Scope: restrict to billing server only.
const SCOPE_SERVERS = { servers: ['billing'] };

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gem-${Date.now()}-${++_seq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeBackend(): FixtureBackend {
  const b = new FixtureBackend();
  b.defineServer('billing', {
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
  return b;
}

function makeAgg(catalog: Record<string, FocusSuggestions> = {}): Aggregator {
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
    focus: 'billing',
    focusProfiles: { profiles: { billing: BILLING_FOCUS_PROFILE } },
    suggestionsCatalog: catalog,
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

async function castDiscovered(
  agg: Aggregator,
  extras: Record<string, unknown> = {},
  sessionId?: string,
): Promise<Record<string, unknown>> {
  if (sessionId) {
    // Warm up the session so sessionContext is available on the next call.
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId });
  }
  const result = await agg.callTool('ch1tty/cast', {
    intent: INTENT,
    ...(sessionId ? { sessionId } : {}),
    ...extras,
  });
  assert.equal(
    (result as { isError?: unknown }).isError,
    undefined,
    'cast must not return isError',
  );
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(
    body['cast'],
    'discovered',
    `expected cast:discovered, got cast="${String(body['cast'])}"`,
  );
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GEM-1: cast:discovered + scope + focus + explain (no catalog, no session) → EXACTLY 8 keys; `focus` absent', async () => {
  const agg = makeAgg();
  try {
    const body = await castDiscovered(agg, { scope: SCOPE_SERVERS, explain: true });
    assertExactKeys(body, SCOPE_FOCUS_EXPLAIN, 'GEM-1');
    assert.ok(!('focus' in body), 'GEM-1: `focus` must NOT appear in cast:discovered');
  } finally {
    await agg.shutdown();
  }
});

test('GEM-2: cast:discovered + scope + focus + explain + sessionId → EXACTLY GEM-1 + sessionContext (9 keys)', async () => {
  const agg = makeAgg();
  try {
    const body = await castDiscovered(agg, { scope: SCOPE_SERVERS, explain: true }, 'gem-sess-2');
    assertExactKeys(body, SCOPE_FOCUS_EXPLAIN_SESSION, 'GEM-2');
    assert.ok(!('focus' in body), 'GEM-2: `focus` must NOT appear in cast:discovered');
  } finally {
    await agg.shutdown();
  }
});

test('GEM-3: cast:discovered + scope + focus + explain + catalog (no session) → EXACTLY GEM-1 + resources + suggestions (10 keys)', async () => {
  const agg = makeAgg(BILLING_CATALOG);
  try {
    const body = await castDiscovered(agg, { scope: SCOPE_SERVERS, explain: true });
    assertExactKeys(body, SCOPE_FOCUS_EXPLAIN_CATALOG, 'GEM-3');
    assert.ok(!('focus' in body), 'GEM-3: `focus` must NOT appear in cast:discovered');
  } finally {
    await agg.shutdown();
  }
});

test('GEM-4: cast:discovered + scope + focus + explain + catalog + session → maximal 11-key set', async () => {
  const agg = makeAgg(BILLING_CATALOG);
  try {
    const body = await castDiscovered(agg, { scope: SCOPE_SERVERS, explain: true }, 'gem-sess-4');
    assertExactKeys(body, SCOPE_FOCUS_EXPLAIN_CATALOG_SESSION, 'GEM-4');
    assert.ok(!('focus' in body), 'GEM-4: `focus` must NOT appear in cast:discovered');
  } finally {
    await agg.shutdown();
  }
});

test('GEM-5: absence guard — `focus` key is absent in all 4 scope+focus+explain variants', async () => {
  // Probe all 4 variants and collect any unexpected `focus` appearances.
  const variants = [
    { label: 'no-catalog/no-session',  extras: { scope: SCOPE_SERVERS, explain: true },              session: undefined,     catalog: {} },
    { label: 'no-catalog/with-session', extras: { scope: SCOPE_SERVERS, explain: true },              session: 'gem-5-sess-b', catalog: {} },
    { label: 'catalog/no-session',     extras: { scope: SCOPE_SERVERS, explain: true },              session: undefined,     catalog: BILLING_CATALOG },
    { label: 'catalog/with-session',   extras: { scope: SCOPE_SERVERS, explain: true },              session: 'gem-5-sess-d', catalog: BILLING_CATALOG },
  ];
  for (const { label, extras, session, catalog } of variants) {
    const agg = makeAgg(catalog);
    try {
      const body = await castDiscovered(agg, extras, session);
      assert.ok(
        !('focus' in body),
        `GEM-5 [${label}]: \`focus\` key must NEVER appear in cast:discovered — found it`,
      );
    } finally {
      await agg.shutdown();
    }
  }
});
