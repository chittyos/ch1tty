/**
 * GEA drift guard: freeze cast:resolved exact top-level key set when a catalog
 * combo matches — the `catalogCombo` conditional field.
 *
 * Prior cast:resolved exact-key-set tests all deliberately use
 * `suggestionsCatalog: {}` to exclude catalog combos:
 *
 *   GU-3   no session, no focus  → {cast, intent, latencyMs, resolved, resolvedBy}
 *   GU-4   + session             → GU-3 + sessionContext
 *   GBM-*  + scope variants      → GU-3 + scope (+ optional extras)
 *   GCH-*  + focus variants      → GU-3 + focus (+ optional extras)
 *
 * EK froze the `catalogCombo` sub-object shape (3 keys: accomplishes, chain,
 * name) but never asserts the top-level key set of the response when
 * `catalogCombo` is present. A regression that:
 *   (a) adds an extra top-level field only in the catalog-matched path
 *       (e.g. accidentally injecting `chainContinuation`, which belongs in
 *        cast:plan / cast:executed but NOT in cast:resolved), or
 *   (b) silently drops `catalogCombo` from the response, or
 *   (c) injects `suggestions` (a cast:plan / cast:executed field — absent from
 *        the cast:resolved code path at aggregator.ts lines 1553–1580)
 * would pass every prior drift guard.
 *
 * Source (src-stdio/aggregator.ts lines 1553–1580, dryRun path):
 *   cast:resolved body =
 *     { cast, resolvedBy, intent, latencyMs,
 *       ...(focusName        ? { focus }        : {}),   // always present with catalogCombo
 *       ...(scopeAnnotation  ? { scope }         : {}),
 *       ...(explanation      ? { explanation }   : {}),
 *       resolved: { tool, score },
 *       ...(catalogCombo     ? { catalogCombo }  : {}),
 *       ...(resolvedSessionContext ? { sessionContext } : {}),
 *     }
 *
 * Key invariants (both frozen here):
 *   - catalogCombo can ONLY be non-null when focusName is truthy
 *     (aggregator line 1448: `const catalogCombo = focusName ? findCatalogCombo(…) : null`)
 *     → cast:resolved WITH catalogCombo ALWAYS has `focus` key.
 *   - cast:resolved has NO `suggestions` field (unlike cast:plan / cast:executed).
 *   - cast:resolved has NO `chainContinuation` or `alternatives` fields.
 *
 * GEA freezes:
 *
 *   GEA-1  focus + catalogCombo, no session, no scope →
 *          EXACTLY {cast, catalogCombo, focus, intent, latencyMs, resolved, resolvedBy}
 *          (EK asserts catalogCombo is present and its sub-keys are correct, but
 *           never deepEquals the full sorted top-level key list)
 *
 *   GEA-2  focus + catalogCombo + session →
 *          EXACTLY GEA-1 + sessionContext (8 keys total)
 *          (GU-4 froze cast:resolved + session without catalog; no test covers the
 *           three-way: dryRun ∧ catalog ∧ session)
 *
 *   GEA-3  focus + catalogCombo + scope →
 *          EXACTLY GEA-1 + scope (8 keys total)
 *          (GBM froze cast:resolved + scope without catalog; this closes
 *           the two-way: dryRun ∧ catalog ∧ scope)
 *
 *   GEA-4  focus + catalogCombo + scope + session →
 *          EXACTLY GEA-1 + scope + sessionContext (9 keys total)
 *          (closes the three-way: dryRun ∧ catalog ∧ scope ∧ session)
 *
 *   GEA-5  absence guard: `catalogCombo` ABSENT when focus is NOT active;
 *          confirms the catalogCombo key is strictly conditional on focus,
 *          not injected unconditionally by a regression
 *
 * Fixture: single neon server, 1-step combo starting at `neon/list_projects`.
 * Intent "list neon projects" reliably resolves to neon/list_projects.
 * KeywordOnlyCoordinator disables the brain route for determinism.
 * suggestionsCatalog has 'code' entry — matched by focus:'code'.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level cast:resolved
 *     key set, not the explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen exact key sets ─────────────────────────────────────────────────────

// GEA-1: cast:resolved WITH catalogCombo, no session, no scope.
// `focus` is always present when catalogCombo is present (same focusName requirement).
// `suggestions`, `chainContinuation`, and `alternatives` are absent — not part of
// the cast:resolved (dryRun) path.
const RESOLVED_CATALOG_BASE: readonly string[] = [
  'cast', 'catalogCombo', 'focus', 'intent', 'latencyMs', 'resolved', 'resolvedBy',
];

const RESOLVED_CATALOG_WITH_SESSION: readonly string[] = [
  ...RESOLVED_CATALOG_BASE, 'sessionContext',
];

const RESOLVED_CATALOG_WITH_SCOPE: readonly string[] = [
  ...RESOLVED_CATALOG_BASE, 'scope',
];

const RESOLVED_CATALOG_WITH_SCOPE_AND_SESSION: readonly string[] = [
  ...RESOLVED_CATALOG_BASE, 'scope', 'sessionContext',
];

// ── Inline fixtures ───────────────────────────────────────────────────────────

// Catalog with 'code' focus and a 2-step combo starting at neon/list_projects.
// The 2-step chain ensures chainContinuation would be set in plan/executed mode,
// allowing us to confirm it does NOT leak into cast:resolved.
const GEA_CATALOG = {
  code: {
    description: 'Neon database code tools',
    combos: [{
      name: 'neon-setup',
      chain: ['neon/list_projects', 'neon/create_project'],
      accomplishes: 'List existing Neon projects then create a new one',
      verified: true,
    }],
    prompts: [],
  },
};

const BASE_CONFIG: ServerConfig = {
  id: 'neon',
  name: 'Neon',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.tech/mcp',
  lazy: true,
};

// Intent that reliably resolves to neon/list_projects (first step of the combo).
const INTENT = 'list neon projects';

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gea-${Date.now()}-${++_seq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeBackend(): FixtureBackend {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'List all neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '["proj-1","proj-2"]' }] },
      },
      {
        name: 'create_project',
        description: 'Create a new neon database project',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        response: { content: [{ type: 'text', text: '{"id":"proj-new"}' }] },
      },
    ],
    prompts: [],
    resources: [],
  });
  return backend;
}

// Aggregator with focus:'code' and GEA_CATALOG — triggers catalogCombo on cast:resolved.
function makeAgg(): Aggregator {
  const path = dlq();
  return new Aggregator([BASE_CONFIG], {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: GEA_CATALOG,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  } as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

// Aggregator WITHOUT focus — catalogCombo will always be null (requires focusName).
function makeAggNoFocus(): Aggregator {
  const path = dlq();
  return new Aggregator([BASE_CONFIG], {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: GEA_CATALOG,
    // No `focus`: focusName will be null → catalogCombo will be null
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  } as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

/** Assert exact sorted key set with a descriptive failure message. */
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

/** Call cast with dryRun:true and assert the result is cast:resolved. */
async function castResolved(
  agg: Aggregator,
  extras: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  // Warm the session if sessionId is present so coordinator.hasSession is true.
  if (typeof extras['sessionId'] === 'string') {
    await agg.callTool('ch1tty/cast', { intent: INTENT, dryRun: true, sessionId: extras['sessionId'] });
  }
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, dryRun: true, ...extras });
  assert.equal((result as { isError?: unknown }).isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(
    body['cast'],
    'resolved',
    `expected cast:resolved, got cast="${String(body['cast'])}" — intent may not have matched or focusName was not set`,
  );
  return body;
}

// ── GEA-1: focus + catalogCombo, no session, no scope ────────────────────────

test('GEA-1: cast:resolved WITH catalogCombo (no session, no scope) has EXACTLY {cast, catalogCombo, focus, intent, latencyMs, resolved, resolvedBy}', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg);
    // Verify catalogCombo IS present — confirms fixture correctly triggers catalog match.
    assert.ok(
      'catalogCombo' in body,
      `catalogCombo must be present; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assertExactKeys(body, RESOLVED_CATALOG_BASE, 'GEA-1 focus+catalogCombo, no session, no scope');
  } finally {
    await agg.shutdown();
  }
});

// ── GEA-2: focus + catalogCombo + session ────────────────────────────────────

test('GEA-2: cast:resolved WITH catalogCombo + session has EXACTLY GEA-1 set + sessionContext', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, { sessionId: 'gea-session-2' });
    assert.ok(
      'catalogCombo' in body,
      `catalogCombo must be present in session call; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assertExactKeys(body, RESOLVED_CATALOG_WITH_SESSION, 'GEA-2 focus+catalogCombo+session');
    assert.ok(
      typeof body['sessionContext'] === 'object' && body['sessionContext'] !== null,
      'sessionContext must be a non-null object',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEA-3: focus + catalogCombo + scope ──────────────────────────────────────

test('GEA-3: cast:resolved WITH catalogCombo + scope has EXACTLY GEA-1 set + scope', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, { scope: { servers: ['neon'] } });
    assert.ok(
      'catalogCombo' in body,
      `catalogCombo must be present with scope; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assertExactKeys(body, RESOLVED_CATALOG_WITH_SCOPE, 'GEA-3 focus+catalogCombo+scope');
    assert.ok(typeof body['scope'] === 'object', 'scope must be an object');
  } finally {
    await agg.shutdown();
  }
});

// ── GEA-4: focus + catalogCombo + scope + session ────────────────────────────

test('GEA-4: cast:resolved WITH catalogCombo + scope + session has EXACTLY GEA-1 set + scope + sessionContext', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, { scope: { servers: ['neon'] }, sessionId: 'gea-session-4' });
    assert.ok(
      'catalogCombo' in body,
      `catalogCombo must be present with scope+session; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assertExactKeys(body, RESOLVED_CATALOG_WITH_SCOPE_AND_SESSION, 'GEA-4 focus+catalogCombo+scope+session');
    assert.ok(typeof body['scope'] === 'object', 'scope must be an object');
    assert.ok(
      typeof body['sessionContext'] === 'object' && body['sessionContext'] !== null,
      'sessionContext must be a non-null object',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEA-5: absence guard — catalogCombo absent when focus is NOT active ───────

test('GEA-5: `catalogCombo` absent from cast:resolved when focus is NOT active', async () => {
  // catalogCombo = focusName ? findCatalogCombo(…) : null
  // Without focus, focusName is null → catalogCombo is always null → key absent.
  const agg = makeAggNoFocus();
  try {
    const body = await castResolved(agg);
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'catalogCombo'),
      false,
      `catalogCombo must NOT appear in cast:resolved when focus is not active; ` +
      `got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    // Also confirm `focus` is absent (no focusName → no focus key either).
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'focus'),
      false,
      'focus key must also be absent when focus is not active',
    );
  } finally {
    await agg.shutdown();
  }
});
