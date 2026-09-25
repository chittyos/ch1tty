/**
 * GBH drift guard: freeze cast:discovered conditional top-level key set.
 *
 * Prior tests freeze cast:discovered field value types (EF) and the exact
 * base key set on PR #1500 (GBC, not yet merged). GBG (PR #1507) freezes
 * the `suggestions` conditional. No test on main freezes the other
 * conditional keys that activate via explain/session/scope parameters.
 *
 * A regression that always includes `explanation`, always includes
 * `sessionContext`, adds an extra annotation key, or leaks `suggestions`
 * in the base path would pass all prior tests silently.
 *
 * Actual shapes (keyword route, billing fixture, empty catalog,
 * probed 2026-09-25):
 *
 *   cast:discovered (no session, no focus, no explain, no scope)
 *     → {cast, hint, intent, latencyMs, prompts, resolvedBy}
 *       (6 keys)
 *
 *   cast:discovered (explain:true)
 *     → base + explanation  (7 keys)
 *
 *   cast:discovered (sessionId set, prior call exists)
 *     → base + sessionContext  (7 keys)
 *
 *   cast:discovered (scope:{servers:[...]})
 *     → base + scope  (7 keys)
 *
 * Source: src-stdio/aggregator.ts lines ~1428–1443 (cast:discovered body):
 *   { cast: 'discovered', resolvedBy, intent, latencyMs,
 *     ...(scopeAnnotation ? { scope } : {}),
 *     ...(explanation ? { explanation } : {}),
 *     hint: '...',
 *     ...related,          // prompts and/or resources
 *     ...(discoveredSessionContext ? { sessionContext } : {}),
 *     ...(focusSuggestions ? { suggestions } : {}) }
 *
 * GBH freezes:
 *
 *   GBH-1  cast:discovered base (no session, no focus, no explain, no scope)
 *          has EXACTLY 6 keys:
 *          {cast, hint, intent, latencyMs, prompts, resolvedBy}.
 *
 *   GBH-2  cast:discovered WITH explain:true adds exactly `explanation`
 *          — base+1=7 keys.
 *
 *   GBH-3  cast:discovered WITH sessionId (after a prior call to seed
 *          the coordinator) adds exactly `sessionContext` — base+1=7 keys.
 *
 *   GBH-4  cast:discovered WITH scope:{servers:[...]} adds exactly `scope`
 *          — base+1=7 keys.
 *
 *   GBH-5  cast:discovered base does NOT contain `focus`, `suggestions`,
 *          `resources`, `catalogCombo`, or `chainContinuation`.
 *
 * Frozen 2026-09-25.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (top-level
 *     cast:discovered key set, not the explanation sub-object structure)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen exact key sets ──────────────────────────────────────────────────────

// Base: cast:discovered with empty catalog, no focus, no session, no explain.
// Billing fixture has 1 tool (subscription — no overlap with intent "invoice")
// and 1 prompt (retrieve_invoice — matches "invoice"). No resources.
// related spreads { prompts: [...] } → prompts present, resources absent.
const DISCOVERED_KEYS_BASE: readonly string[] = [
  'cast', 'hint', 'intent', 'latencyMs', 'prompts', 'resolvedBy',
];

const DISCOVERED_KEYS_WITH_EXPLAIN: readonly string[] = [
  ...DISCOVERED_KEYS_BASE, 'explanation',
];

const DISCOVERED_KEYS_WITH_SESSION: readonly string[] = [
  ...DISCOVERED_KEYS_BASE, 'sessionContext',
];

const DISCOVERED_KEYS_WITH_SCOPE: readonly string[] = [
  ...DISCOVERED_KEYS_BASE, 'scope',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Keyword-only coordinator — no brain routing, keeps scoring deterministic.
class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const BASE_CONFIGS: ServerConfig[] = [{
  id: 'billing',
  name: 'Billing',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://billing.test/mcp',
  lazy: true,
}];

const INTENT = 'find invoice';

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gbh-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  // Tool with NO keyword overlap with INTENT ("invoice" vs "subscription")
  // Prompt WITH keyword overlap ("invoice")
  // → search returns best=null → cast:discovered path
  backend.defineServer('billing', {
    tools: [{
      name: 'create_subscription',
      description: 'create a new recurring subscription plan',
      inputSchema: { type: 'object' },
      response: { content: [{ type: 'text', text: 'ok' }] },
    }],
    prompts: [
      { name: 'retrieve_invoice', description: 'retrieve and format an invoice for a customer' },
    ],
    resources: [],
  });
  const path = dlq();
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: {},
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

async function castDiscovered(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, ...extra });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text', 'content[0] must be type:text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(
    body['cast'],
    'discovered',
    `expected cast:discovered, got cast="${String(body['cast'])}"`,
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
    `${label}: top-level keys must be exactly ${JSON.stringify(exp)}; got ${JSON.stringify(actual)}`,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GBH-1: cast:discovered base (no focus, no session, no explain, no scope) has EXACTLY 6 keys', async () => {
  const agg = makeAgg();
  try {
    const body = await castDiscovered(agg);
    assertExactKeys(body, DISCOVERED_KEYS_BASE, 'GBH-1');
  } finally {
    await agg.shutdown();
  }
});

test('GBH-2: cast:discovered WITH explain:true adds exactly `explanation` (base+1=7 keys)', async () => {
  const agg = makeAgg();
  try {
    const body = await castDiscovered(agg, { explain: true });
    assertExactKeys(body, DISCOVERED_KEYS_WITH_EXPLAIN, 'GBH-2');
  } finally {
    await agg.shutdown();
  }
});

test('GBH-3: cast:discovered WITH sessionId adds exactly `sessionContext` (base+1=7 keys)', async () => {
  const agg = makeAgg();
  try {
    const SESSION = 'gbh-test-session-1';
    // Seed the session with a prior call so coordinator.hasSession(SESSION) is true
    await agg.callTool('ch1tty/cast', { intent: INTENT, sessionId: SESSION });
    const body = await castDiscovered(agg, { sessionId: SESSION });
    assertExactKeys(body, DISCOVERED_KEYS_WITH_SESSION, 'GBH-3');
    assert.ok(
      typeof body['sessionContext'] === 'object' && body['sessionContext'] !== null,
      'sessionContext must be an object',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GBH-4: cast:discovered WITH scope:{servers:[...]} adds exactly `scope` (base+1=7 keys)', async () => {
  const agg = makeAgg();
  try {
    const body = await castDiscovered(agg, { scope: { servers: ['billing'] } });
    assertExactKeys(body, DISCOVERED_KEYS_WITH_SCOPE, 'GBH-4');
    const scope = body['scope'] as Record<string, unknown>;
    assert.ok(
      typeof scope === 'object' && scope !== null,
      'scope must be an object',
    );
    assert.ok(
      Array.isArray(scope['servers']),
      'scope.servers must be an array',
    );
  } finally {
    await agg.shutdown();
  }
});

test('GBH-5: cast:discovered base does NOT contain focus, suggestions, resources, catalogCombo, or chainContinuation', async () => {
  const agg = makeAgg();
  try {
    const body = await castDiscovered(agg);
    const absent = ['focus', 'suggestions', 'resources', 'catalogCombo', 'chainContinuation'];
    for (const key of absent) {
      assert.ok(
        !Object.prototype.hasOwnProperty.call(body, key),
        `"${key}" must be absent in cast:discovered base (no focus, no scope, no catalog match)`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});
