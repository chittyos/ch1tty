/**
 * GAB drift guard: freeze cast:plan resources exact key sets (with and without mimeType)
 * and cast:discovered resources exact key sets (with and without mimeType).
 *
 * EO froze cast:plan resources with PERMITTED {description, mimeType, name, score, uri} and
 * REQUIRED {name, score, uri}. EP froze cast:discovered resources with the same PERMITTED/REQUIRED
 * sets. Neither freezes the exact key set for items that omit mimeType (or description), so a
 * refactor injecting a null-valued mimeType key (serialised as null, not omitted) would pass
 * EO/EP silently.
 *
 * GAB closes the remaining gaps:
 *
 *   GAB-1  cast:plan resources WITH mimeType — exact key set is
 *           {description, mimeType, name, score, uri}. EO uses PERMITTED-only check.
 *
 *   GAB-2  cast:plan resources WITHOUT mimeType — exact key set is
 *           {description, name, score, uri}. A refactor emitting mimeType:null (JSON-present
 *           as null) for no-mimeType resources would pass EO but fail GAB-2.
 *
 *   GAB-3  cast:discovered resources WITH mimeType — exact key set is
 *           {description, mimeType, name, score, uri}. EP uses PERMITTED-only check.
 *
 *   GAB-4  cast:discovered resources WITHOUT mimeType — exact key set is
 *           {description, name, score, uri}. Same drift risk as GAB-2 for the :discovered path.
 *
 *   GAB-5  cast:discovered resources mimeType, when present, is a non-empty string.
 *           EP checks typeof === 'string' when present but does not check length > 0.
 *           A refactor emitting mimeType: '' would pass EP.
 *
 * Fixtures and paths:
 *
 *   GAB-1/2 use a 'gab-plan' server fixture (one tool + one resource WITH mimeType +
 *   one resource WITHOUT mimeType), intent 'list catalog resources', confirm:true → cast:plan.
 *
 *   GAB-3/4/5 use a 'gab-disc' fixture where the tool description shares no keywords
 *   with 'explore catalog documentation resources' → best === undefined → cast:discovered.
 *   The server has one resource WITH mimeType and one WITHOUT mimeType, both scoring
 *   on the discovered intent.
 *
 * Actual shapes probed 2026-09-21:
 *   cast:plan   resources with mimeType:    {description, mimeType, name, score, uri}
 *   cast:plan   resources without mimeType: {description, name, score, uri}
 *   cast:disc   resources with mimeType:    {description, mimeType, name, score, uri}
 *   cast:disc   resources without mimeType: {description, name, score, uri}
 *
 * Source: src-stdio/aggregator.ts
 *   resources map: lines ~1407–1413  (related.resources construction)
 *   cast:plan path: line ~1617        (confirm:true branch)
 *   cast:discovered path: line ~1439  (best===undefined branch)
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (resources item shape, not explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen exact key sets for a resources[] item ──────────────────────────────

const RESOURCES_ITEM_WITH_MIMETYPE_EXACT: readonly string[] = ['description', 'mimeType', 'name', 'score', 'uri'];
const RESOURCES_ITEM_NO_MIMETYPE_EXACT: readonly string[] = ['description', 'name', 'score', 'uri'];

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gab-${Date.now()}-${++_seq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

/**
 * Aggregator for cast:plan tests (GAB-1/2).
 * Server 'gab-plan' has:
 *   - tool 'list_catalog_resources': description 'List catalog resources by type and uri'
 *     → scores 3/3 on 'list catalog resources' → cast:plan target (confirm:true)
 *   - resource WITH mimeType 'catalog://resources/types': scores on intent → related
 *   - resource WITHOUT mimeType 'catalog://resources/list': scores on intent → related
 */
function makePlanAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('gab-plan', {
    tools: [
      {
        name: 'list_catalog_resources',
        description: 'List catalog resources by type and uri',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{"resources":[]}' }] },
      },
    ],
    resources: [
      {
        uri: 'catalog://resources/types',
        name: 'Catalog Resource Types',
        description: 'List of catalog resources by type',
        mimeType: 'application/json',
      },
      {
        uri: 'catalog://resources/list',
        name: 'Catalog Resources Listing',
        description: 'List of catalog resources',
        // no mimeType → will be absent from the serialised item
      },
    ],
  });
  return new Aggregator(
    [
      {
        id: 'gab-plan',
        name: 'GAB Plan Service',
        type: 'remote',
        access: 'readwrite',
        category: 'search',
        endpoint: 'https://gab-plan.example/mcp',
        lazy: true,
      } as ServerConfig,
    ],
    {
      backendFactory: () => backend,
      embedEnabled: false,
      ledgerDlqPath: dlq(),
      coordinator: new KeywordOnlyCoordinator(),
    },
  );
}

/**
 * Aggregator for cast:discovered tests (GAB-3/4/5).
 * Server 'gab-disc' has:
 *   - tool 'process_files': description 'Process file system directory paths' —
 *     no overlap with 'explore catalog documentation resources'
 *     (terms: explore, catalog, documentation, resources) → score 0 → best === undefined
 *   - resource WITH mimeType 'catalog://docs/explore': description includes all 4 intent
 *     terms → scores 1.0 → appears in cast:discovered
 *   - resource WITHOUT mimeType 'catalog://resources/explore': includes all 4 intent
 *     terms → scores 1.0 → appears in cast:discovered
 *
 * Discovered intent: 'explore catalog documentation resources'
 */
function makeDiscoveredAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('gab-disc', {
    tools: [
      {
        name: 'process_files',
        description: 'Process file system directory paths',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        response: { content: [{ type: 'text', text: '{"ok":true}' }] },
      },
    ],
    resources: [
      {
        uri: 'catalog://docs/explore',
        name: 'Catalog Documentation Explorer',
        description: 'Explore catalog documentation resources',
        mimeType: 'text/html',
      },
      {
        uri: 'catalog://resources/explore',
        name: 'Catalog Resources Explorer',
        description: 'Documentation about catalog resources to explore',
        // no mimeType → will be absent from the serialised item
      },
    ],
  });
  return new Aggregator(
    [
      {
        id: 'gab-disc',
        name: 'GAB Discovered Service',
        type: 'remote',
        access: 'readwrite',
        category: 'documents',
        endpoint: 'https://gab-disc.example/mcp',
        lazy: true,
      } as ServerConfig,
    ],
    {
      backendFactory: () => backend,
      embedEnabled: false,
      ledgerDlqPath: dlq(),
      coordinator: new KeywordOnlyCoordinator(),
    },
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GAB-1: cast:plan resources WITH mimeType have exactly {description, mimeType, name, score, uri}', async () => {
  // EO froze the PERMITTED set for cast:plan resources; GAB-1 freezes the exact key set
  // for items that include mimeType. A refactor injecting extra keys (e.g. a 'type' field)
  // would pass EO but be caught here.
  const agg = makePlanAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list catalog resources', confirm: true });
    assert.equal(result.isError, undefined, 'cast:plan must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'plan', `expected cast:plan, got cast:${String(body['cast'])}`);
    const resources = body['resources'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(resources) && resources.length > 0, 'cast:plan must include at least one resources item');

    const withMimeType = resources.filter((item) => 'mimeType' in item);
    assert.ok(withMimeType.length > 0,
      'cast:plan must have at least one resources item with mimeType (fixture defines one with mimeType)');

    const sorted = [...RESOURCES_ITEM_WITH_MIMETYPE_EXACT].sort();
    for (const item of withMimeType) {
      const keys = Object.keys(item).sort();
      assert.deepEqual(
        keys,
        sorted,
        `cast:plan resources item (with mimeType) has wrong key set: expected ${JSON.stringify(sorted)}, got ${JSON.stringify(keys)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAB-2: cast:plan resources WITHOUT mimeType have exactly {description, name, score, uri}', async () => {
  // EO froze the PERMITTED set for cast:plan resources but not the WITHOUT-mimeType exact key set.
  // A refactor emitting mimeType: null for no-mimeType resources would serialise as {"mimeType":null}
  // which passes EO (mimeType is in PERMITTED) but fails GAB-2.
  const agg = makePlanAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list catalog resources', confirm: true });
    assert.equal(result.isError, undefined, 'cast:plan must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'plan', `expected cast:plan, got cast:${String(body['cast'])}`);
    const resources = body['resources'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(resources) && resources.length > 0, 'cast:plan must include at least one resources item');

    const withoutMimeType = resources.filter((item) => !('mimeType' in item));
    assert.ok(withoutMimeType.length > 0,
      'cast:plan must have at least one resources item without mimeType (fixture defines one without)');

    const sorted = [...RESOURCES_ITEM_NO_MIMETYPE_EXACT].sort();
    for (const item of withoutMimeType) {
      const keys = Object.keys(item).sort();
      assert.deepEqual(
        keys,
        sorted,
        `cast:plan resources item (without mimeType) has wrong key set: expected ${JSON.stringify(sorted)}, got ${JSON.stringify(keys)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAB-3: cast:discovered resources WITH mimeType have exactly {description, mimeType, name, score, uri}', async () => {
  // EP uses PERMITTED set for cast:discovered resources items. GAB-3 freezes the exact key set
  // for items that have mimeType defined — no extra keys, no missing required key.
  const agg = makeDiscoveredAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'explore catalog documentation resources' });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'discovered',
      `expected cast:discovered, got cast:${String(body['cast'])} — check that tool 'process_files' ` +
      `does not score on intent 'explore catalog documentation resources'`);
    const resources = body['resources'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(resources) && resources.length > 0, 'cast:discovered must include at least one resources item');

    const withMimeType = resources.filter((item) => 'mimeType' in item);
    assert.ok(withMimeType.length > 0,
      'cast:discovered must have at least one resources item with mimeType (fixture defines one with mimeType)');

    const sorted = [...RESOURCES_ITEM_WITH_MIMETYPE_EXACT].sort();
    for (const item of withMimeType) {
      const keys = Object.keys(item).sort();
      assert.deepEqual(
        keys,
        sorted,
        `cast:discovered resources item (with mimeType) has wrong key set: expected ${JSON.stringify(sorted)}, got ${JSON.stringify(keys)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAB-4: cast:discovered resources WITHOUT mimeType have exactly {description, name, score, uri}', async () => {
  // Mirror of GAB-3 for resources without mimeType in cast:discovered.
  const agg = makeDiscoveredAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'explore catalog documentation resources' });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'discovered', `expected cast:discovered, got cast:${String(body['cast'])}`);
    const resources = body['resources'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(resources) && resources.length > 0, 'cast:discovered must include at least one resources item');

    const withoutMimeType = resources.filter((item) => !('mimeType' in item));
    assert.ok(withoutMimeType.length > 0,
      'cast:discovered must have at least one resources item without mimeType (fixture defines one without)');

    const sorted = [...RESOURCES_ITEM_NO_MIMETYPE_EXACT].sort();
    for (const item of withoutMimeType) {
      const keys = Object.keys(item).sort();
      assert.deepEqual(
        keys,
        sorted,
        `cast:discovered resources item (without mimeType) has wrong key set: expected ${JSON.stringify(sorted)}, got ${JSON.stringify(keys)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAB-5: cast:discovered resources mimeType, when present, is a non-empty string', async () => {
  // EP checks typeof === 'string' when mimeType is present but does not check length > 0.
  // A refactor emitting mimeType: '' (empty string) would pass EP but fail GAB-5.
  const agg = makeDiscoveredAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'explore catalog documentation resources' });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'discovered', `expected cast:discovered, got cast:${String(body['cast'])}`);
    const resources = body['resources'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(resources) && resources.length > 0, 'cast:discovered must include at least one resources item');

    const withMimeType = resources.filter((item) => 'mimeType' in item);
    assert.ok(withMimeType.length > 0,
      'cast:discovered must have at least one resources item with mimeType (fixture defines one)');
    for (const item of withMimeType) {
      assert.equal(typeof item['mimeType'], 'string',
        `resources item.mimeType must be a string, got ${typeof item['mimeType']}`);
      assert.ok((item['mimeType'] as string).length > 0, 'resources item.mimeType must be non-empty');
    }
  } finally {
    await agg.shutdown();
  }
});
