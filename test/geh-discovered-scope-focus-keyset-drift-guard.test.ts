/**
 * GEH drift guard: freeze cast:discovered exact top-level key set when scope
 * and focus are BOTH active simultaneously.
 *
 * Prior discovered exact-keyset coverage:
 *   GBC (PR #1500) : froze cast:discovered base key set (6 keys)
 *   GBH (PR #1509) : froze discovered conditional keys — scope, explain, session
 *                    individually. GBH-4 confirmed scope(servers)+no-focus = 7 keys.
 *   GBS (PR #1520) : froze discovered when scope+session are both active.
 *   GCI (PR #1541) : froze discovered when focus is active (with/without catalog,
 *                    with/without session). Confirmed `focus` key is NEVER present
 *                    in cast:discovered even when focus is active.
 *
 * Gap: No test on main freezes the exact key set when BOTH scope AND focus are
 * active simultaneously on the cast:discovered path. Two regressions are possible:
 *
 *   (a) A code change adds a `focus` key to discovered when scope+focus are combined
 *       (mirroring plan/executed/resolved which DO carry `focus`). Currently absent;
 *       a silent injection would pass all prior tests.
 *
 *   (b) The scope param somehow suppresses suggestion resources (from listSuggestionResources)
 *       that the cast scoring normally surfaces when focus+catalog are active.
 *       Currently scope only filters the tool registry — prompts and resources are
 *       NOT scope-filtered (aggregator.ts ~line 1228). A regression changing this
 *       would silently drop `resources` from the discovered body.
 *
 * Source (src-stdio/aggregator.ts ~lines 1228–1244 and 1416–1444):
 *   - Scope filters: TOOLS only (not prompts, not resources)
 *   - cast:discovered body =
 *       { cast, resolvedBy, intent, latencyMs,
 *         ...(scopeAnnotation  ? { scope }           : {}),
 *         ...(explanation      ? { explanation }      : {}),
 *         hint,
 *         ...related,   // prompts and/or resources — NOT scope-filtered
 *         ...(discoveredSessionContext ? { sessionContext } : {}),
 *         ...(focusSuggestions        ? { suggestions }    : {}),
 *       }
 *   - listAllResources() includes listSuggestionResources() which registers
 *     ch1tty://suggestions/* entries. These score against intent keywords and
 *     appear as `resources` when the catalog is non-empty. Scope does NOT
 *     suppress them.
 *
 * GEH closes the scope+focus gap, parallel to GBS (scope+session):
 *
 *   GEH-1  scope(servers) + focus (no catalog, no session)
 *            → base + scope (7 keys); `focus` absent (confirms no leakage)
 *
 *   GEH-2  scope(servers) + focus + catalog (no session)
 *            → base + scope + resources + suggestions (9 keys); `focus` absent
 *            Catalog adds listSuggestionResources() entries that score >0.1
 *            against intent. Scope does NOT filter them out.
 *
 *   GEH-3  scope(servers) + focus + catalog + session
 *            → base + scope + resources + sessionContext + suggestions (10 keys)
 *
 *   GEH-4  scope(servers) + focus (no catalog, session)
 *            → base + scope + sessionContext (8 keys)
 *
 *   GEH-5  Absence guard: `focus` key NEVER present when scope+focus both active
 *
 * Fixture: billing server, one tool (non-matching keywords), one prompt (matching
 * keywords), intent 'find invoice pdf' — reliably triggers cast:discovered.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - Public MCP surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level
 *     cast:discovered key set, not the explanation sub-object)
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

const BASE: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'prompts', 'resolvedBy',
];

// scope only (no catalog): base + scope.
const SCOPE_ONLY: readonly string[] = [...BASE, 'scope'];

// scope + focus + catalog (no session): base + scope + resources + suggestions.
const SCOPE_FOCUS_CATALOG: readonly string[] = [...BASE, 'resources', 'scope', 'suggestions'];

// scope + focus + catalog + session: base + scope + resources + sessionContext + suggestions.
const SCOPE_FOCUS_CATALOG_SESSION: readonly string[] = [
  ...BASE, 'resources', 'scope', 'sessionContext', 'suggestions',
];

// scope + focus (no catalog) + session: base + scope + sessionContext.
const SCOPE_FOCUS_SESSION: readonly string[] = [...BASE, 'scope', 'sessionContext'];

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

const INTENT = 'find invoice pdf';
const SCOPE_SERVERS = { servers: ['billing'] };

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-geh-${Date.now()}-${++_seq}.jsonl`);
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

function assertExactKeys(body: Record<string, unknown>, expected: readonly string[], label: string): void {
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
  sessionId: string | undefined,
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  if (sessionId) {
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId });
  }
  const result = await agg.callTool('ch1tty/cast', {
    intent: INTENT,
    ...(sessionId ? { sessionId } : {}),
    ...extras,
  });
  assert.equal((result as { isError?: unknown }).isError, undefined, 'cast must not return isError');
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

// ── GEH-1: scope(servers) + focus (no catalog, no session) → base + scope ────

test('GEH-1: scope+focus (no catalog, no session) → base + scope (7 keys); `focus` absent', async () => {
  const agg = new Aggregator(BASE_CONFIGS, {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
    focus: 'billing',
    focusProfiles: { profiles: { billing: BILLING_FOCUS_PROFILE } },
    suggestionsCatalog: {},
  });
  try {
    const body = await castDiscovered(agg, undefined, { scope: SCOPE_SERVERS });
    assertExactKeys(body, SCOPE_ONLY, 'GEH-1 scope+focus, no-catalog, no-session');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'focus'),
      false,
      'GEH-1: `focus` must be absent from cast:discovered even when scope+focus are both active',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      false,
      'GEH-1: `suggestions` must be absent when catalog has no entry for active focus',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEH-2: scope(servers) + focus + catalog (no session) → base + scope + resources + suggestions ──

test('GEH-2: scope+focus+catalog (no session) → base + scope + resources + suggestions (9 keys); `focus` absent', async () => {
  const agg = new Aggregator(BASE_CONFIGS, {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
    focus: 'billing',
    focusProfiles: { profiles: { billing: BILLING_FOCUS_PROFILE } },
    suggestionsCatalog: BILLING_CATALOG,
  });
  try {
    const body = await castDiscovered(agg, undefined, { scope: SCOPE_SERVERS });
    assertExactKeys(body, SCOPE_FOCUS_CATALOG, 'GEH-2 scope+focus+catalog, no-session');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'focus'),
      false,
      'GEH-2: `focus` must be absent even when scope+focus+catalog are all active',
    );
    assert.equal(typeof body['suggestions'], 'object', 'GEH-2: suggestions must be an object');
    assert.notEqual(body['suggestions'], null, 'GEH-2: suggestions must not be null');
    assert.ok(
      Object.prototype.hasOwnProperty.call(body, 'scope'),
      'GEH-2: scope must be present when scope param is passed',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEH-3: scope(servers) + focus + catalog + session → 10 keys ───────────────

test('GEH-3: scope+focus+catalog+session → base + scope + resources + sessionContext + suggestions (10 keys)', async () => {
  const agg = new Aggregator(BASE_CONFIGS, {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
    focus: 'billing',
    focusProfiles: { profiles: { billing: BILLING_FOCUS_PROFILE } },
    suggestionsCatalog: BILLING_CATALOG,
  });
  try {
    const body = await castDiscovered(agg, 'geh-session-3', { scope: SCOPE_SERVERS });
    assertExactKeys(body, SCOPE_FOCUS_CATALOG_SESSION, 'GEH-3 scope+focus+catalog+session');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'focus'),
      false,
      'GEH-3: `focus` must remain absent with scope+focus+catalog+session',
    );
    assert.equal(typeof body['sessionContext'], 'object', 'GEH-3: sessionContext must be an object');
    assert.notEqual(body['sessionContext'], null, 'GEH-3: sessionContext must not be null');
  } finally {
    await agg.shutdown();
  }
});

// ── GEH-4: scope(servers) + focus (no catalog, session) → base + scope + sessionContext ──

test('GEH-4: scope+focus (no catalog, session) → base + scope + sessionContext (8 keys)', async () => {
  const agg = new Aggregator(BASE_CONFIGS, {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
    focus: 'billing',
    focusProfiles: { profiles: { billing: BILLING_FOCUS_PROFILE } },
    suggestionsCatalog: {},
  });
  try {
    const body = await castDiscovered(agg, 'geh-session-4', { scope: SCOPE_SERVERS });
    assertExactKeys(body, SCOPE_FOCUS_SESSION, 'GEH-4 scope+focus, no-catalog, session');
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'focus'),
      false,
      'GEH-4: `focus` must be absent with scope+focus+session but no catalog',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'suggestions'),
      false,
      'GEH-4: `suggestions` absent when catalog is empty',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEH-5: absence guard — `focus` key never present, even with scope+focus ──

test('GEH-5: absence guard — `focus` key NEVER present in cast:discovered with scope+focus', async () => {
  // Also verifies scope annotation is correctly structured.
  const agg = new Aggregator(BASE_CONFIGS, {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlq()),
    focus: 'billing',
    focusProfiles: { profiles: { billing: BILLING_FOCUS_PROFILE } },
    suggestionsCatalog: BILLING_CATALOG,
  });
  try {
    const body = await castDiscovered(agg, 'geh-session-5', { scope: SCOPE_SERVERS });
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'focus'),
      false,
      'GEH-5: `focus` must NEVER appear in cast:discovered regardless of active focus or scope',
    );
    // Scope annotation present and correctly shaped.
    const scope = body['scope'] as Record<string, unknown>;
    assert.ok(scope !== null && typeof scope === 'object', 'GEH-5: scope must be an object');
    assert.deepEqual(scope['servers'], ['billing'], 'GEH-5: scope.servers must match param');
    assert.equal(
      Object.prototype.hasOwnProperty.call(scope, 'categories'),
      false,
      'GEH-5: scope.categories must be absent when only servers were passed',
    );
  } finally {
    await agg.shutdown();
  }
});
