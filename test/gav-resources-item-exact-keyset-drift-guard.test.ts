/**
 * GAV drift guard: freeze resources[] item exact key set across cast modes.
 *
 * EO (cast:plan) and EP (cast:executed/discovered) each check resources items
 * using PERMITTED+REQUIRED:
 *   PERMITTED: { uri, name, description, mimeType, score }
 *   REQUIRED:  { uri, name, score }
 *
 * PERMITTED+REQUIRED leaves two symmetric gaps, both passing silently:
 *
 *   1. DROP gap: a regression removing `description: r.description` from the
 *      resources item construction would silently pass EO/EP even when the
 *      source resource HAS description. description is PERMITTED but not
 *      REQUIRED, so its absence never fails the EO/EP checks.
 *
 *   2. INJECT gap: a regression unconditionally injecting `description: ''`
 *      or `mimeType: null` for sources that have neither field would silently
 *      pass EO/EP (those keys ARE in PERMITTED so no unexpected-key failure).
 *
 * Actual construction (src-stdio/aggregator.ts line ~1407):
 *   related.resources = scoredResources.map((r) => ({
 *     uri: r.uri, name: r.name, description: r.description,
 *     mimeType: r.mimeType, score: r.score,
 *   }));
 *
 * JSON behavior: JSON.stringify drops keys whose value is undefined.
 * When a source resource has no description or mimeType field, those values
 * are undefined and the serialized+parsed resources item has only 3 keys
 * {name, score, uri}. When the source HAS description and mimeType, the
 * serialized item has exactly 5 keys {description, mimeType, name, score, uri}.
 * description and mimeType are independently optional (ResourceEntry); the
 * four-key cases (description only / mimeType only) also produce exact key sets.
 *
 * Coordinator note: cast:discovered tests inject KeywordOnlyCoordinator to
 * stub the brain/Ollama router. Without the stub, embedEnabled:false disables
 * EmbeddingBrain but the default coordinator can still call a configured Ollama
 * router — if reachable, it may select the sole tool and return cast:executed
 * instead. The stub mirrors the pattern used by EP and GAG-4 for discovered-path
 * tests and ensures deterministic keyword-only resolution.
 *
 * Invariants frozen by GAV:
 *
 *   GAV-1  cast:executed: when source resource has description AND mimeType,
 *          every resources item has EXACTLY {description, mimeType, name, score, uri}.
 *          (DROP gap: EO/EP would silently pass if description/mimeType were
 *           removed from construction — they're PERMITTED but not REQUIRED.)
 *
 *   GAV-2  cast:discovered: same 5-key guarantee when source has both optional fields.
 *          (EP analogous DROP gap on discovered path; coordinator stubbed for
 *           deterministic keyword routing.)
 *
 *   GAV-3  cast:plan (confirm:true): same 5-key guarantee when source has both.
 *          (EO DROP gap on plan path.)
 *
 *   GAV-4  when source resource has NO description and NO mimeType, the resources
 *          item has EXACTLY {name, score, uri} — exactly the 3 required keys, no
 *          more, no less. Item found by URI, not positional index, to avoid fragility
 *          from catalog-prepended items. (INJECT gap: EO/EP would silently pass if
 *          a regression injected default values for absent optional fields.)
 *
 *   GAV-5  resources item description and mimeType echo the source string values
 *          exactly — not coerced, not truncated, not defaulted. Item found by URI.
 *          (No prior test asserts value equality for these optional fields.)
 *
 *   GAV-6  when source resource has description but NO mimeType, the item has
 *          EXACTLY {description, name, score, uri} (4 keys; mimeType absent).
 *          (description and mimeType are independently optional; a regression
 *           conditionalizing one on the presence of the other would pass
 *           GAV-1–5 silently.)
 *
 *   GAV-7  when source resource has mimeType but NO description, the item has
 *          EXACTLY {mimeType, name, score, uri} (4 keys; description absent).
 *          (Symmetric to GAV-6 for the mimeType field.)
 *
 * Source: src-stdio/aggregator.ts line ~1407
 *
 * Frozen 2026-09-24.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (resources item shape,
 *     not the explanation sub-object)
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

// When source resource has BOTH description and mimeType.
const RESOURCE_ITEM_FULL_KEYS: readonly string[] = [
  'description', 'mimeType', 'name', 'score', 'uri',
];

// When source resource has NEITHER description NOR mimeType.
const RESOURCE_ITEM_BASE_KEYS: readonly string[] = [
  'name', 'score', 'uri',
];

// When source resource has description but NO mimeType.
const RESOURCE_ITEM_DESC_ONLY_KEYS: readonly string[] = [
  'description', 'name', 'score', 'uri',
];

// When source resource has mimeType but NO description.
const RESOURCE_ITEM_MIME_ONLY_KEYS: readonly string[] = [
  'mimeType', 'name', 'score', 'uri',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gav-${Date.now()}-${++_seq}.jsonl`);
}

// Stubs the brain/Ollama router so cast mode is determined by keyword scoring
// alone. Without this, embedEnabled:false disables EmbeddingBrain but a
// configured Ollama router can still run, making cast:discovered non-deterministic.
class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// Intent: "list neon database projects"
// Scoring terms (length > 2): list, neon, database, projects (4 terms)
const INTENT = 'list neon database projects';

function makeConfig(serverId: string, endpoint: string): ServerConfig[] {
  return [
    {
      id: serverId,
      name: `GAV ${serverId}`,
      type: 'remote',
      access: 'readwrite',
      category: 'code',
      endpoint,
      lazy: true,
    },
  ];
}

function makeAgg(
  serverId: string,
  tools: unknown[],
  resources: unknown[],
  stub = false,
): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer(serverId, { tools, prompts: [], resources });
  const path = dlq();
  return new Aggregator(makeConfig(serverId, `https://${serverId}.fixture.test/mcp`), {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    // Empty catalog: prevents suggestion items from competing with fixture
    // items in the resources .slice(0, 5) cut (aggregator.ts line ~1337).
    suggestionsCatalog: {},
    ...(stub ? { coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path) } : {}),
  });
}

function assertExactKeys(
  items: unknown[],
  expected: readonly string[],
  label: string,
): void {
  assert.ok(Array.isArray(items) && items.length > 0, `${label}: must be a non-empty array`);
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as Record<string, unknown>;
    const actual = Object.keys(item).sort();
    const sorted = [...expected].sort();
    assert.deepEqual(
      actual,
      sorted,
      `${label}: resources[${i}] exact key set mismatch.\n` +
      `  expected: ${JSON.stringify(sorted)}\n` +
      `  actual:   ${JSON.stringify(actual)}`,
    );
  }
}

/** Find a resources item by its URI. Fails the test if not found. */
function findByUri(
  resources: unknown[],
  uri: string,
  label: string,
): Record<string, unknown> {
  const item = resources.find((r) => (r as Record<string, unknown>)['uri'] === uri);
  assert.ok(item !== undefined,
    `${label}: could not find resources item with uri="${uri}"; ` +
    `got uris: ${JSON.stringify(resources.map((r) => (r as Record<string, unknown>)['uri']))}`);
  return item as Record<string, unknown>;
}

/**
 * Compute the namespaced URI that listAllResources() assigns to a backend
 * resource. src-stdio/aggregator.ts line ~1872: `uri: \`${config.id}://${r.uri}\``
 */
function nsUri(serverId: string, uri: string): string {
  return `${serverId}://${uri}`;
}

async function castBody(
  agg: Aggregator,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, ...extra });
  assert.equal(result.isError, undefined, 'cast must not return isError');
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── Shared fixture definitions ────────────────────────────────────────────────

const EXEC_TOOL = {
  name: 'list_neon_db_projects',
  description: 'List neon database projects',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '["p1"]' }] },
};

// Tool with 0/4 term overlap — triggers cast:discovered when used alone
const DISC_TOOL = {
  name: 'write_bytes_to_disk',
  description: 'Write bytes to a disk file',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  response: { content: [{ type: 'text', text: '{"ok":true}' }] },
};

const FULL_RESOURCE = {
  uri: 'neon://projects/list',
  name: 'Neon DB Projects',
  description: 'List neon database projects overview',
  mimeType: 'application/json',
};

// ── GAV-1: cast:executed 5-key set when source has both optional fields ───────

test('GAV-1: cast:executed resources item has exactly {description,mimeType,name,score,uri} when source has both optional fields', async () => {
  const agg = makeAgg('gav1', [EXEC_TOOL], [FULL_RESOURCE]);
  try {
    const body = await castBody(agg);
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    assertExactKeys(body['resources'] as unknown[], RESOURCE_ITEM_FULL_KEYS, 'cast:executed resources');
  } finally {
    await agg.shutdown();
  }
});

// ── GAV-2: cast:discovered 5-key set when source has both optional fields ─────

test('GAV-2: cast:discovered resources item has exactly {description,mimeType,name,score,uri} when source has both optional fields', async () => {
  // stub=true: KeywordOnlyCoordinator disables Ollama router so 0-overlap tool
  // reliably produces best===undefined and triggers cast:discovered.
  const agg = makeAgg('gav2', [DISC_TOOL], [FULL_RESOURCE], true);
  try {
    const body = await castBody(agg);
    assert.equal(body['cast'], 'discovered',
      `expected cast:discovered, got ${body['cast']} — fixture may not trigger discovered path`);
    assertExactKeys(body['resources'] as unknown[], RESOURCE_ITEM_FULL_KEYS, 'cast:discovered resources');
  } finally {
    await agg.shutdown();
  }
});

// ── GAV-3: cast:plan 5-key set when source has both optional fields ───────────

test('GAV-3: cast:plan (confirm:true) resources item has exactly {description,mimeType,name,score,uri} when source has both optional fields', async () => {
  const agg = makeAgg('gav3', [EXEC_TOOL], [FULL_RESOURCE]);
  try {
    const body = await castBody(agg, { confirm: true });
    assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
    assertExactKeys(body['resources'] as unknown[], RESOURCE_ITEM_FULL_KEYS, 'cast:plan resources');
  } finally {
    await agg.shutdown();
  }
});

// ── GAV-4: 3-key base set when source has no description or mimeType ──────────

test('GAV-4: resources item has exactly {name,score,uri} when source resource has no description or mimeType', async () => {
  // ResourceEntry allows description and mimeType to be absent.
  // JSON.stringify drops undefined values, so the serialised item for a
  // bare resource has exactly the 3 required keys {name, score, uri}.
  // Item is found by its URI to avoid positional fragility from catalog-prepended
  // items (listSuggestionResources may add matching catalog resources first).
  const BARE_URI = 'neon://projects/bare';
  const bareResource = { uri: BARE_URI, name: 'Neon Database Projects' };
  const agg = makeAgg('gav4', [EXEC_TOOL], [bareResource]);
  try {
    const body = await castBody(agg);
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0,
      'resources must be non-empty to test the bare-item shape');
    const item = findByUri(resources, nsUri('gav4', BARE_URI), 'GAV-4');
    const actual = Object.keys(item).sort();
    const expected = [...RESOURCE_ITEM_BASE_KEYS].sort();
    assert.deepEqual(
      actual,
      expected,
      `bare resource item must have exactly ${JSON.stringify(expected)} ` +
      `(JSON.stringify drops undefined); got ${JSON.stringify(actual)}. ` +
      `A regression injecting default values for absent optional fields ` +
      `would silently pass EO/EP's PERMITTED check.`,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(item, 'description'), false,
      'description must be absent when source resource has no description',
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(item, 'mimeType'), false,
      'mimeType must be absent when source resource has no mimeType',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAV-5: description and mimeType echo source string values exactly ─────────

test('GAV-5: resources item description and mimeType echo source resource string values exactly', async () => {
  const FULL_URI = 'neon://projects/full';
  const srcDescription = 'List neon database projects overview';
  const srcMimeType = 'application/vnd.neon+json';
  const fullResource = {
    uri: FULL_URI,
    name: 'Neon DB Projects',
    description: srcDescription,
    mimeType: srcMimeType,
  };
  const agg = makeAgg('gav5', [EXEC_TOOL], [fullResource]);
  try {
    const body = await castBody(agg);
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be non-empty');
    const item = findByUri(resources, nsUri('gav5', FULL_URI), 'GAV-5');
    assert.equal(typeof item['description'], 'string',
      'resources item.description must be typeof string when source provides a string');
    assert.equal(item['description'], srcDescription,
      'resources item.description must echo the source value exactly');
    assert.equal(typeof item['mimeType'], 'string',
      'resources item.mimeType must be typeof string when source provides a string');
    assert.equal(item['mimeType'], srcMimeType,
      'resources item.mimeType must echo the source value exactly');
  } finally {
    await agg.shutdown();
  }
});

// ── GAV-6: 4-key set when source has description but no mimeType ─────────────

test('GAV-6: resources item has exactly {description,name,score,uri} when source has description but no mimeType', async () => {
  // description and mimeType are independently optional. A regression that
  // conditionalizes one on the presence of the other would pass GAV-1–5 but
  // fail this test (which has description present, mimeType absent).
  const DESC_ONLY_URI = 'neon://projects/desc-only';
  const descOnlyResource = {
    uri: DESC_ONLY_URI,
    name: 'Neon DB Projects',
    description: 'List neon database projects overview',
    // no mimeType
  };
  const agg = makeAgg('gav6', [EXEC_TOOL], [descOnlyResource]);
  try {
    const body = await castBody(agg);
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0,
      'resources must be non-empty');
    const item = findByUri(resources, nsUri('gav6', DESC_ONLY_URI), 'GAV-6');
    const actual = Object.keys(item).sort();
    const expected = [...RESOURCE_ITEM_DESC_ONLY_KEYS].sort();
    assert.deepEqual(actual, expected,
      `description-only resource item must have exactly ${JSON.stringify(expected)}; ` +
      `got ${JSON.stringify(actual)}`);
    assert.equal(Object.prototype.hasOwnProperty.call(item, 'mimeType'), false,
      'mimeType must be absent when source resource has no mimeType');
  } finally {
    await agg.shutdown();
  }
});

// ── GAV-7: 4-key set when source has mimeType but no description ─────────────

test('GAV-7: resources item has exactly {mimeType,name,score,uri} when source has mimeType but no description', async () => {
  // Symmetric to GAV-6 for the mimeType field.
  const MIME_ONLY_URI = 'neon://projects/mime-only';
  const mimeOnlyResource = {
    uri: MIME_ONLY_URI,
    name: 'Neon DB Projects',
    // no description
    mimeType: 'application/json',
  };
  const agg = makeAgg('gav7', [EXEC_TOOL], [mimeOnlyResource]);
  try {
    const body = await castBody(agg);
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0,
      'resources must be non-empty');
    const item = findByUri(resources, nsUri('gav7', MIME_ONLY_URI), 'GAV-7');
    const actual = Object.keys(item).sort();
    const expected = [...RESOURCE_ITEM_MIME_ONLY_KEYS].sort();
    assert.deepEqual(actual, expected,
      `mimeType-only resource item must have exactly ${JSON.stringify(expected)}; ` +
      `got ${JSON.stringify(actual)}`);
    assert.equal(Object.prototype.hasOwnProperty.call(item, 'description'), false,
      'description must be absent when source resource has no description');
  } finally {
    await agg.shutdown();
  }
});
