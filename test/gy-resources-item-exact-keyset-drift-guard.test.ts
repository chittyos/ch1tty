/**
 * GY drift guard: freeze resources item exact key set in cast:executed,
 * cast:plan, and cast:discovered responses.
 *
 * EO and EP are the prior coverage:
 *   EO: cast:plan resources items — PERMITTED {description, mimeType, name, score, uri};
 *       REQUIRED {name, score, uri}. Description and mimeType are PERMITTED but NOT REQUIRED.
 *   EP: cast:executed and cast:discovered resources items — same PERMITTED/REQUIRED sets.
 *
 * Gap: description and mimeType are only asserted when present (permitted but not required).
 * The source (src-stdio/aggregator.ts line ~1407–1413) always includes both:
 *   related.resources = scoredResources.map((r) => ({
 *     uri: r.uri, name: r.name, description: r.description,
 *     mimeType: r.mimeType, score: r.score,
 *   }));
 *
 * And listSuggestionResources() (line ~1802) always supplies description (non-empty string)
 * and mimeType ('application/json') for every catalog entry.
 *
 * A refactor removing description or mimeType from the map() call would:
 *   — pass EO/EP (description/mimeType are PERMITTED, not REQUIRED)
 *   — be caught by GY (exact key set assertion)
 *
 * GY-1  cast:executed resources items have EXACTLY {description, mimeType, name, score, uri}.
 *        (EO/EP PERMITTED but not REQUIRED; a removal of description/mimeType passes both.)
 *
 * GY-2  cast:plan (confirm:true) resources items have EXACTLY {description, mimeType, name, score, uri}.
 *        (Same gap in cast:plan path.)
 *
 * GY-3  cast:discovered resources items have EXACTLY {description, mimeType, name, score, uri}.
 *        (Same gap in cast:discovered path — empty tool registry, intent matches only resources.)
 *
 * GY-4  resources item.description is always a non-empty string across all cast paths.
 *        (EO/EP check typeof === 'string' when present; GY-4 asserts presence AND non-emptiness.)
 *
 * GY-5  resources item.mimeType is always 'application/json' for catalog resources.
 *        (EO/EP check typeof === 'string' when present; GY-5 asserts the exact MIME type
 *        supplied by listSuggestionResources(), never just 'a string'.)
 *
 * Fixtures and paths:
 *   GY-1/2/4/5: 3-tool stripe fixture, intent 'list stripe payments'
 *               → finance/market/realestate catalog resources score 0.33 (1/3 terms)
 *   GY-3:       empty tool registry, intent 'suggestions catalog index'
 *               → catalog index + profiles score 0.33–1.0; no tools → cast:discovered
 *
 * Actual shapes probed 2026-09-21:
 *   cast:executed resources items:  {description:'…', mimeType:'application/json', name:'…', score:0.33, uri:'ch1tty://…'}
 *   cast:plan resources items:      identical item shapes
 *   cast:discovered resources items: identical item shapes
 *
 * Source: src-stdio/aggregator.ts lines ~1407–1413 (resources map), ~1802 (listSuggestionResources).
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (resources item shape, not explanation)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen exact key set for a resources[] item ───────────────────────────────

// All 5 fields are always present: uri/name from the resource source, score from
// the scorer, description/mimeType from listSuggestionResources() which always
// populates them (description: non-empty string, mimeType: 'application/json').
const RESOURCES_ITEM_EXACT: readonly string[] = ['description', 'mimeType', 'name', 'score', 'uri'];

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gy-${Date.now()}-${++_seq}.jsonl`);
}

/** 3-tool stripe aggregator — same fixture as GW/GX. Catalog resources score on 'list stripe payments'. */
function makeStripeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(
    [{ id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true } as ServerConfig],
    { backendFactory: () => backend, embedEnabled: false, ledgerDlqPath: dlq() },
  );
}

/** Empty-tool aggregator — no tools; catalog resources matched by intent triggers cast:discovered. */
function makeEmptyAgg(): Aggregator {
  const backend = new FixtureBackend();
  return new Aggregator(
    [] as ServerConfig[],
    { backendFactory: () => backend, embedEnabled: false, ledgerDlqPath: dlq() },
  );
}

function assertExactResourceItemKeys(items: unknown[], context: string): void {
  const sorted = [...RESOURCES_ITEM_EXACT].sort();
  for (const item of items) {
    const keys = Object.keys(item as object).sort();
    assert.deepEqual(
      keys,
      sorted,
      `${context}: resources item has wrong key set: expected ${JSON.stringify(sorted)} got ${JSON.stringify(keys)}`,
    );
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GY-1: cast:executed resources items have exactly {description, mimeType, name, score, uri}', async () => {
  const agg = makeStripeAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list stripe payments' });
    assert.equal(result.isError, undefined, 'cast:executed must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'executed', `expected cast:executed, got cast:${String(body['cast'])}`);
    const resources = body['resources'] as unknown[] | undefined;
    assert.ok(Array.isArray(resources) && resources.length > 0, 'cast:executed must include at least one resource item');
    assertExactResourceItemKeys(resources, 'cast:executed');
  } finally {
    await agg.shutdown();
  }
});

test('GY-2: cast:plan resources items have exactly {description, mimeType, name, score, uri}', async () => {
  const agg = makeStripeAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list stripe payments', confirm: true });
    assert.equal(result.isError, undefined, 'cast:plan must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'plan', `expected cast:plan, got cast:${String(body['cast'])}`);
    const resources = body['resources'] as unknown[] | undefined;
    assert.ok(Array.isArray(resources) && resources.length > 0, 'cast:plan must include at least one resource item');
    assertExactResourceItemKeys(resources, 'cast:plan');
  } finally {
    await agg.shutdown();
  }
});

test('GY-3: cast:discovered resources items have exactly {description, mimeType, name, score, uri}', async () => {
  // No tools registered → no tool matches → cast:discovered when resources match.
  // Intent 'suggestions catalog index' scores > 0.1 against catalog resources.
  const agg = makeEmptyAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'suggestions catalog index' });
    assert.equal(result.isError, undefined, 'cast:discovered must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'discovered', `expected cast:discovered, got cast:${String(body['cast'])}`);
    const resources = body['resources'] as unknown[] | undefined;
    assert.ok(Array.isArray(resources) && resources.length > 0, 'cast:discovered must include at least one resource item');
    assertExactResourceItemKeys(resources, 'cast:discovered');
  } finally {
    await agg.shutdown();
  }
});

test('GY-4: resources item.description is always a non-empty string across cast:executed, cast:plan, and cast:discovered', async () => {
  // EO/EP assert typeof === 'string' when present; GY-4 asserts presence + non-emptiness on all cast paths.
  const assertDescriptions = (resources: Array<Record<string, unknown>>, path: string): void => {
    assert.ok(Array.isArray(resources) && resources.length > 0, `${path}: test requires at least one resource`);
    for (const item of resources) {
      assert.equal(typeof item['description'], 'string', `${path}: resources item.description must be a string`);
      assert.ok((item['description'] as string).length > 0, `${path}: resources item.description must be non-empty`);
    }
  };

  // cast:executed
  const aggEx = makeStripeAgg();
  try {
    const r = await aggEx.callTool('ch1tty/cast', { intent: 'list stripe payments' });
    const body = JSON.parse((r.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'executed', `expected cast:executed, got cast:${String(body['cast'])}`);
    assertDescriptions(body['resources'] as Array<Record<string, unknown>>, 'cast:executed');
  } finally {
    await aggEx.shutdown();
  }

  // cast:plan
  const aggPlan = makeStripeAgg();
  try {
    const r = await aggPlan.callTool('ch1tty/cast', { intent: 'list stripe payments', confirm: true });
    const body = JSON.parse((r.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'plan', `expected cast:plan, got cast:${String(body['cast'])}`);
    assertDescriptions(body['resources'] as Array<Record<string, unknown>>, 'cast:plan');
  } finally {
    await aggPlan.shutdown();
  }

  // cast:discovered
  const aggDisc = makeEmptyAgg();
  try {
    const r = await aggDisc.callTool('ch1tty/cast', { intent: 'suggestions catalog index' });
    const body = JSON.parse((r.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'discovered', `expected cast:discovered, got cast:${String(body['cast'])}`);
    assertDescriptions(body['resources'] as Array<Record<string, unknown>>, 'cast:discovered');
  } finally {
    await aggDisc.shutdown();
  }
});

test('GY-5: resources item.mimeType is always \'application/json\' for catalog resources across cast:executed, cast:plan, and cast:discovered', async () => {
  // listSuggestionResources() hard-codes mimeType: 'application/json' for all catalog entries.
  // EO/EP only assert typeof === 'string' when present; GY-5 freezes the exact MIME value on all cast paths.
  const assertMimeTypes = (resources: Array<Record<string, unknown>>, path: string): void => {
    assert.ok(Array.isArray(resources) && resources.length > 0, `${path}: test requires at least one resource`);
    for (const item of resources) {
      assert.equal(item['mimeType'], 'application/json', `${path}: catalog resource item.mimeType must be 'application/json'`);
    }
  };

  // cast:executed
  const aggEx = makeStripeAgg();
  try {
    const r = await aggEx.callTool('ch1tty/cast', { intent: 'list stripe payments' });
    const body = JSON.parse((r.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'executed', `expected cast:executed, got cast:${String(body['cast'])}`);
    assertMimeTypes(body['resources'] as Array<Record<string, unknown>>, 'cast:executed');
  } finally {
    await aggEx.shutdown();
  }

  // cast:plan
  const aggPlan = makeStripeAgg();
  try {
    const r = await aggPlan.callTool('ch1tty/cast', { intent: 'list stripe payments', confirm: true });
    const body = JSON.parse((r.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'plan', `expected cast:plan, got cast:${String(body['cast'])}`);
    assertMimeTypes(body['resources'] as Array<Record<string, unknown>>, 'cast:plan');
  } finally {
    await aggPlan.shutdown();
  }

  // cast:discovered
  const aggDisc = makeEmptyAgg();
  try {
    const r = await aggDisc.callTool('ch1tty/cast', { intent: 'suggestions catalog index' });
    const body = JSON.parse((r.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'discovered', `expected cast:discovered, got cast:${String(body['cast'])}`);
    assertMimeTypes(body['resources'] as Array<Record<string, unknown>>, 'cast:discovered');
  } finally {
    await aggDisc.shutdown();
  }
});
