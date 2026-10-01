/**
 * GEO drift guard: freeze cast:resolved (dryRun) exact top-level key set
 * when focus + catalogCombo + explain are all active simultaneously.
 *
 * GEA froze the resolved key set WITH focus+catalogCombo but WITHOUT explain:
 *   GEA-1  focus+catalogCombo, no session, no scope → 7 keys (no explanation)
 *   GEA-2  + session → 8 keys
 *   GEA-3  + scope   → 8 keys
 *   GEA-4  + scope+session → 9 keys
 *   GEA-5  absence: catalogCombo absent without focus
 *
 * GEE froze the resolved key set WITH explain, using suggestionsCatalog: {} to
 * EXCLUDE catalogCombo — so GEE freezes explain WITHOUT catalogCombo:
 *   GEE-1  no-focus, no-session, explain → 6 keys (no catalogCombo)
 *   GEE-3  focus, no-session, explain → 7 keys (no catalogCombo)
 *
 * Neither GEA nor GEE covers the intersection: focus + catalogCombo + explain
 * simultaneously. A regression that:
 *   (a) silently drops `explanation` when `catalogCombo` is present, or
 *   (b) silently drops `catalogCombo` when `explain: true` is passed, or
 *   (c) injects an extra key only in the three-way path
 * would pass all prior drift guards.
 *
 * Resolved body construction (aggregator.ts ~line 1564):
 *   { cast, resolvedBy, intent, latencyMs,
 *     ...(focusName   ? { focus }       : {}),
 *     ...(scopeAnnot  ? { scope }       : {}),
 *     ...(explanation ? { explanation } : {}),   ← controlled by explain param
 *     resolved: { tool, score },
 *     ...(catalogCombo ? { catalogCombo } : {}),  ← conditional on focusName
 *     ...(resolvedCtx  ? { sessionContext } : {}),
 *   }
 *
 * GEO freezes:
 *
 *   GEO-1  focus + catalogCombo + explain (no session, no scope) → EXACTLY
 *          {cast, catalogCombo, explanation, focus, intent, latencyMs, resolved, resolvedBy}
 *          = 8 keys  (GEA-1 base with explanation added)
 *
 *   GEO-2  focus + catalogCombo + explain + session → EXACTLY GEO-1 + sessionContext
 *          = 9 keys  (confirms all four optional fields compose with no surprises)
 *
 *   GEO-3  focus + catalogCombo + explain + scope → EXACTLY GEO-1 + scope
 *          = 9 keys  (closes the three-way: dryRun ∧ catalog ∧ explain ∧ scope)
 *
 *   GEO-4  absence guard: WITHOUT explain, explanation is ABSENT even when
 *          catalogCombo is present  (mirrors GEE-4 for the catalog-active path)
 *
 *   GEO-5  explanation sub-object in the catalog path is a non-null object with
 *          a string `method` key  (value-type guard, mirrors GEE-5)
 *
 * Fixture: FixtureBackend + focus:code + suggestionsCatalog with a 'code' combo
 * starting at neon/list_projects. Intent "list neon projects" reliably resolves
 * to neon/list_projects. KeywordOnlyCoordinator disables brain route for
 * determinism.
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level resolved
 *     key set presence/absence of `explanation`, not the sub-object fields)
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

// GEO-1: focus + catalogCombo + explain, no session, no scope.
const RESOLVED_CATALOG_EXPLAIN_BASE: readonly string[] = [
  'cast', 'catalogCombo', 'explanation', 'focus', 'intent', 'latencyMs', 'resolved', 'resolvedBy',
];

// GEO-2: + session
const RESOLVED_CATALOG_EXPLAIN_SESSION: readonly string[] = [
  ...RESOLVED_CATALOG_EXPLAIN_BASE, 'sessionContext',
];

// GEO-3: + scope
const RESOLVED_CATALOG_EXPLAIN_SCOPE: readonly string[] = [
  ...RESOLVED_CATALOG_EXPLAIN_BASE, 'scope',
];

// ── Inline fixtures ───────────────────────────────────────────────────────────

const GEO_CATALOG = {
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

const INTENT = 'list neon projects';

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-geo-${Date.now()}-${++_seq}.jsonl`);
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

function makeAgg(): Aggregator {
  const path = dlq();
  return new Aggregator([BASE_CONFIG], {
    backendFactory: () => makeBackend(),
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: GEO_CATALOG,
    focus: 'code',
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

// ── GEO-1: focus + catalogCombo + explain, no session, no scope ──────────────

test('GEO-1: cast:resolved WITH catalogCombo + explain (no session, no scope) has EXACTLY {cast, catalogCombo, explanation, focus, intent, latencyMs, resolved, resolvedBy}', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, { explain: true });
    assert.ok(
      'catalogCombo' in body,
      `catalogCombo must be present; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assert.ok(
      'explanation' in body,
      `explanation must be present when explain:true; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assertExactKeys(body, RESOLVED_CATALOG_EXPLAIN_BASE, 'GEO-1 focus+catalogCombo+explain, no session, no scope');
  } finally {
    await agg.shutdown();
  }
});

// ── GEO-2: focus + catalogCombo + explain + session ──────────────────────────

test('GEO-2: cast:resolved WITH catalogCombo + explain + session has EXACTLY GEO-1 set + sessionContext', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, { explain: true, sessionId: 'geo-session-2' });
    assert.ok(
      'catalogCombo' in body,
      `catalogCombo must be present with session; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assert.ok(
      'explanation' in body,
      `explanation must be present with session+explain; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assertExactKeys(body, RESOLVED_CATALOG_EXPLAIN_SESSION, 'GEO-2 focus+catalogCombo+explain+session');
    assert.ok(
      typeof body['sessionContext'] === 'object' && body['sessionContext'] !== null,
      'sessionContext must be a non-null object',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEO-3: focus + catalogCombo + explain + scope ────────────────────────────

test('GEO-3: cast:resolved WITH catalogCombo + explain + scope has EXACTLY GEO-1 set + scope', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, { explain: true, scope: { servers: ['neon'] } });
    assert.ok(
      'catalogCombo' in body,
      `catalogCombo must be present with scope; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assert.ok(
      'explanation' in body,
      `explanation must be present with scope+explain; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assertExactKeys(body, RESOLVED_CATALOG_EXPLAIN_SCOPE, 'GEO-3 focus+catalogCombo+explain+scope');
    assert.ok(typeof body['scope'] === 'object', 'scope must be an object');
  } finally {
    await agg.shutdown();
  }
});

// ── GEO-4: absence guard — explanation ABSENT when explain not passed ─────────

test('GEO-4: cast:resolved WITH catalogCombo but WITHOUT explain does NOT contain explanation', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg);
    assert.ok(
      'catalogCombo' in body,
      `catalogCombo must be present (without explain); got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(body, 'explanation'),
      false,
      `explanation must be absent when explain param is not set; got keys: ${JSON.stringify(Object.keys(body).sort())}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GEO-5: explanation sub-object in catalog path has string method key ───────

test('GEO-5: explanation sub-object in catalog+explain path has a string method key', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, { explain: true });
    const explanation = body['explanation'] as Record<string, unknown>;
    assert.ok(
      explanation !== null && typeof explanation === 'object' && !Array.isArray(explanation),
      'GEO-5: explanation must be a non-null, non-array object',
    );
    assert.equal(
      typeof explanation['method'],
      'string',
      `GEO-5: explanation.method must be a string; got ${typeof explanation['method']}`,
    );
    assert.ok(
      (explanation['method'] as string).length > 0,
      'GEO-5: explanation.method must be a non-empty string',
    );
  } finally {
    await agg.shutdown();
  }
});
