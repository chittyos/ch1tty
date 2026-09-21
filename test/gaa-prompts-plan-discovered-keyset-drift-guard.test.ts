/**
 * GAA drift guard: freeze cast:plan prompts items WITHOUT arguments exact key set
 * and cast:discovered prompts items exact key sets (with and without arguments).
 *
 * GZ froze prompts item shapes in cast:executed (GZ-3/4) and cast:plan (GZ-5),
 * but covered only the WITH-arguments case for cast:plan (GZ-5), and did not cover
 * cast:discovered prompts items at all.
 *
 * EO covers cast:plan prompts with PERMITTED {arguments, description, name, score} and
 * REQUIRED {name, score} — description and arguments are PERMITTED but NOT REQUIRED.
 * EP covers cast:discovered prompts with the same PERMITTED/REQUIRED sets.
 *
 * GAA closes the remaining gaps:
 *
 *   GAA-1  cast:plan prompts items WITHOUT arguments — exact key set is
 *           {description, name, score} (no arguments, no extra keys).
 *           GZ-5 froze the WITH-arguments variant for cast:plan; the WITHOUT-arguments
 *           mirror was not frozen. A refactor that accidentally injects an 'arguments'
 *           key (undefined-valued, serialised as null or present) would pass GZ.
 *
 *   GAA-2  cast:discovered prompts item.description is always a non-empty string.
 *           EP asserts typeof === 'string' only when present (PERMITTED); the source
 *           allPrompts() line ~1957 always produces non-empty description via the
 *           `[${config.name}] ${p.description || p.name}` fallback. A refactor
 *           removing the fallback would pass EP silently.
 *
 *   GAA-3  cast:discovered prompts items WITH arguments — exact key set is
 *           {arguments, description, name, score}. EP only checks PERMITTED set.
 *
 *   GAA-4  cast:discovered prompts items WITHOUT arguments — exact key set is
 *           {description, name, score}. EP only checks PERMITTED set.
 *
 *   GAA-5  cast:discovered prompts item.arguments, when present, is an array
 *           (not a string, not a plain object). EP checks typeof only when
 *           arguments is the string literal — it never checks the Array.isArray
 *           constraint, so a refactor emitting arguments as a plain object would
 *           pass EP.
 *
 * Fixtures and paths:
 *
 *   GAA-1 uses the same 'gaa-plan' server fixture as GZ (one tool + one prompt WITH
 *   args + one prompt WITHOUT args), intent 'list catalog entries', confirm:true → cast:plan.
 *
 *   GAA-2..5 use a 'gaa-disc' fixture where the tool's description shares no keywords
 *   with the discovered intent, so best === undefined → cast:discovered. The server has
 *   one prompt WITH arguments and one prompt WITHOUT arguments; both score > 0 on the
 *   intent 'review catalog documentation guide'.
 *
 * Actual shapes probed 2026-09-21:
 *   cast:plan   prompts without args: {description:'…', name:'…', score:…}
 *   cast:disc   prompts with args:    {arguments:[…], description:'…', name:'…', score:…}
 *   cast:disc   prompts without args: {description:'…', name:'…', score:…}
 *
 * Source: src/aggregator.ts
 *   prompts map: lines ~1399–1404  (related.prompts construction)
 *   cast:plan path: line ~1617      (confirm:true branch)
 *   cast:discovered path: line ~1439 (best===undefined branch)
 *   allPrompts(): lines ~1957–1961  (always-non-empty description via fallback)
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (prompts item shape, not explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen exact key sets for a prompts[] item ────────────────────────────────

const PROMPTS_ITEM_WITH_ARGS_EXACT: readonly string[] = ['arguments', 'description', 'name', 'score'];
const PROMPTS_ITEM_NO_ARGS_EXACT: readonly string[] = ['description', 'name', 'score'];

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gaa-${Date.now()}-${++_seq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

/**
 * Aggregator for cast:plan tests (GAA-1).
 * Server 'gaa-plan' has:
 *   - tool 'list_catalog_entries': scores ~1.0 on 'list catalog entries' → cast:plan target
 *   - prompt WITH args 'catalog-query-guide': scores on 'catalog entries' → related
 *   - prompt WITHOUT args 'catalog-index-explorer': scores on 'catalog entries' → related
 *
 * Fixture replicates the GZ server structure so test is independent of GZ's branch.
 */
function makePlanAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('gaa-plan', {
    tools: [
      {
        name: 'list_catalog_entries',
        description: 'List catalog entries and query filters',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{"entries":[]}' }] },
      },
    ],
    prompts: [
      {
        name: 'catalog-query-guide',
        description: 'Guide for querying catalog entries',
        arguments: [{ name: 'filter', description: 'Entry filter', required: false }],
      },
      {
        name: 'catalog-index-explorer',
        description: 'Explore catalog index and entries',
        // no arguments field → undefined, omitted by JSON.stringify
      },
    ],
  });
  return new Aggregator(
    [
      {
        id: 'gaa-plan',
        name: 'GAA Plan Service',
        type: 'remote',
        access: 'readwrite',
        category: 'search',
        endpoint: 'https://gaa-plan.example/mcp',
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
 * Aggregator for cast:discovered tests (GAA-2..5).
 * Server 'gaa-disc' has:
 *   - tool 'process_files': description uses 'process file system operations' —
 *     no overlap with the discovered intent 'review catalog documentation guide'
 *     (terms: review, catalog, documentation, guide) → score ~0 → best === undefined
 *   - prompt WITH args 'catalog-review-guide': description includes all 4 intent
 *     terms → scores high → appears in cast:discovered
 *   - prompt WITHOUT args 'catalog-doc-index': description includes 'catalog',
 *     'documentation' → scores > threshold → appears in cast:discovered
 *
 * Discovered intent: 'review catalog documentation guide'
 */
function makeDiscoveredAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('gaa-disc', {
    tools: [
      {
        name: 'process_files',
        description: 'Process file system operations and directory paths',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        response: { content: [{ type: 'text', text: '{"ok":true}' }] },
      },
    ],
    prompts: [
      {
        name: 'catalog-review-guide',
        description: 'Guide for reviewing catalog documentation entries',
        arguments: [{ name: 'section', description: 'Documentation section', required: false }],
      },
      {
        name: 'catalog-doc-index',
        description: 'Index of catalog documentation topics',
        // no arguments → will appear WITHOUT arguments in cast:discovered
      },
    ],
  });
  return new Aggregator(
    [
      {
        id: 'gaa-disc',
        name: 'GAA Discovered Service',
        type: 'remote',
        access: 'readwrite',
        category: 'documents',
        endpoint: 'https://gaa-disc.example/mcp',
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

test('GAA-1: cast:plan prompts items WITHOUT arguments have exactly {description, name, score}', async () => {
  // GZ-5 froze the WITH-arguments case for cast:plan; this test freezes the WITHOUT-arguments mirror.
  // A refactor accidentally injecting 'arguments: undefined' (serialised as null or present) would
  // pass GZ-5 but be caught here.
  const agg = makePlanAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list catalog entries', confirm: true });
    assert.equal(result.isError, undefined, 'cast:plan must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'plan', `expected cast:plan, got cast:${String(body['cast'])}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'cast:plan must include at least one prompts item');

    const withoutArgs = prompts.filter((item) => !('arguments' in item));
    assert.ok(withoutArgs.length > 0,
      'cast:plan must have at least one prompts item without arguments (fixture defines one without)');

    const sorted = [...PROMPTS_ITEM_NO_ARGS_EXACT].sort();
    for (const item of withoutArgs) {
      const keys = Object.keys(item).sort();
      assert.deepEqual(
        keys,
        sorted,
        `cast:plan prompts item (without arguments) has wrong key set: expected ${JSON.stringify(sorted)}, got ${JSON.stringify(keys)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAA-2: cast:discovered prompts item.description is always a non-empty string', async () => {
  // EP asserts description only when present (PERMITTED). allPrompts() always produces non-empty
  // description via the `[${config.name}] ${p.description || p.name}` fallback. GAA-2 asserts
  // that all prompts items in cast:discovered have description present AND non-empty.
  const agg = makeDiscoveredAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'review catalog documentation guide' });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'discovered',
      `expected cast:discovered, got cast:${String(body['cast'])} — check that tool 'process_files' ` +
      `does not score on intent 'review catalog documentation guide'`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'cast:discovered must include at least one prompts item');
    for (const item of prompts) {
      assert.equal(typeof item['description'], 'string',
        `prompts item.description must be a string, got ${typeof item['description']}`);
      assert.ok((item['description'] as string).length > 0, 'prompts item.description must be non-empty');
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAA-3: cast:discovered prompts items WITH arguments have exactly {arguments, description, name, score}', async () => {
  // EP uses PERMITTED set for cast:discovered prompts items. GAA-3 freezes the exact key set
  // for items that have arguments defined — no extra keys, no missing required key.
  const agg = makeDiscoveredAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'review catalog documentation guide' });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'discovered', `expected cast:discovered, got cast:${String(body['cast'])}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'cast:discovered must include at least one prompts item');

    const withArgs = prompts.filter((item) => 'arguments' in item);
    assert.ok(withArgs.length > 0,
      'cast:discovered must have at least one prompts item with arguments (fixture defines one with arguments)');

    const sorted = [...PROMPTS_ITEM_WITH_ARGS_EXACT].sort();
    for (const item of withArgs) {
      const keys = Object.keys(item).sort();
      assert.deepEqual(
        keys,
        sorted,
        `cast:discovered prompts item (with arguments) has wrong key set: expected ${JSON.stringify(sorted)}, got ${JSON.stringify(keys)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAA-4: cast:discovered prompts items WITHOUT arguments have exactly {description, name, score}', async () => {
  // Mirror of GAA-3 for prompts items without arguments in cast:discovered.
  const agg = makeDiscoveredAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'review catalog documentation guide' });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'discovered', `expected cast:discovered, got cast:${String(body['cast'])}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'cast:discovered must include at least one prompts item');

    const withoutArgs = prompts.filter((item) => !('arguments' in item));
    assert.ok(withoutArgs.length > 0,
      'cast:discovered must have at least one prompts item without arguments (fixture defines one without)');

    const sorted = [...PROMPTS_ITEM_NO_ARGS_EXACT].sort();
    for (const item of withoutArgs) {
      const keys = Object.keys(item).sort();
      assert.deepEqual(
        keys,
        sorted,
        `cast:discovered prompts item (without arguments) has wrong key set: expected ${JSON.stringify(sorted)}, got ${JSON.stringify(keys)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAA-5: cast:discovered prompts item.arguments, when present, is an array', async () => {
  // EP checks typeof only when arguments is present; it does not check Array.isArray.
  // The source always produces arguments as an array (from the prompt definition). A refactor
  // emitting arguments as a plain object {name, description, required} would pass EP.
  const agg = makeDiscoveredAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'review catalog documentation guide' });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'discovered', `expected cast:discovered, got cast:${String(body['cast'])}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'cast:discovered must include at least one prompts item');

    const withArgs = prompts.filter((item) => 'arguments' in item);
    assert.ok(withArgs.length > 0,
      'cast:discovered must have at least one prompts item with arguments (fixture defines one)');
    for (const item of withArgs) {
      assert.ok(Array.isArray(item['arguments']),
        `prompts item.arguments must be an Array, got ${typeof item['arguments']}`);
    }
  } finally {
    await agg.shutdown();
  }
});
