/**
 * GZ drift guard: freeze prompts item exact key set and description presence
 * in cast:executed and cast:plan responses.
 *
 * EO and EP are the prior coverage:
 *   EO: cast:plan prompts items — PERMITTED {arguments, description, name, score};
 *       REQUIRED {name, score}. Description and arguments are PERMITTED but NOT REQUIRED.
 *   EP: cast:executed and cast:discovered prompts items — same PERMITTED/REQUIRED sets.
 *
 * Gap: description and arguments are only asserted when present (permitted but not required).
 * The source (src-stdio/aggregator.ts line ~1399–1404) always includes all 4 fields:
 *   related.prompts = scoredPrompts.map((p) => ({
 *     name: p.name, description: p.description,
 *     arguments: p.arguments, score: p.score,
 *   }));
 *
 * Additionally, allPrompts() (line ~1957–1961) always supplies description (non-empty string)
 * via `[${config.name}] ${p.description || p.name}` — the p.name fallback ensures description
 * is always non-empty. arguments is present exactly when the prompt definition has arguments.
 *
 * A refactor removing description from the map() call would:
 *   — pass EO/EP (description is PERMITTED, not REQUIRED)
 *   — be caught by GZ (GZ-1/2: description presence assertion)
 *
 * A refactor removing arguments from the map() call would:
 *   — pass EO/EP (arguments is PERMITTED, not REQUIRED)
 *   — be caught by GZ (GZ-3/5: exact key set includes arguments)
 *
 * GZ-1  cast:executed prompts item.description is always a non-empty string.
 *        (EO/EP assert typeof === 'string' when present; GZ-1 asserts presence AND non-emptiness.)
 *
 * GZ-2  cast:plan prompts item.description is always a non-empty string.
 *        (Same gap in cast:plan path.)
 *
 * GZ-3  cast:executed prompts items WITH arguments — exact key set is
 *        {arguments, description, name, score}.
 *        (EO/EP only check PERMITTED set; GZ-3 freezes the exact 4-key set for prompts
 *        that have arguments defined.)
 *
 * GZ-4  cast:executed prompts items WITHOUT arguments — exact key set is
 *        {description, name, score}.
 *        (When arguments is undefined in the source, JSON serialization omits it; the
 *        frozen 3-key set confirms no unexpected keys appear either.)
 *
 * GZ-5  cast:plan prompts items WITH arguments — exact key set is
 *        {arguments, description, name, score}.
 *        (Same gap in cast:plan path.)
 *
 * Fixtures and paths:
 *   All tests: single 'gz-svc' server fixture, intent 'list catalog entries'.
 *   Server has one tool (scores 1.0 → cast:executed), one prompt WITH arguments
 *   (scores 0.67), and one prompt WITHOUT arguments (scores 0.67).
 *   GZ-2/5 use confirm:true → cast:plan.
 *
 * Actual shapes probed 2026-09-21:
 *   prompts item with arguments:    {arguments:[…], description:'…', name:'…', score:0.67}
 *   prompts item without arguments: {description:'…', name:'…', score:0.67}
 *
 * Source: src-stdio/aggregator.ts lines ~1399–1404 (prompts map), ~1957–1961 (allPrompts).
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (prompts item shape, not explanation)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Frozen exact key sets for a prompts[] item ────────────────────────────────

// When the prompt definition has arguments, all 4 fields are present after JSON round-trip.
const PROMPTS_ITEM_WITH_ARGS_EXACT: readonly string[] = ['arguments', 'description', 'name', 'score'];

// When the prompt definition has no arguments, arguments is undefined → omitted by JSON.stringify.
const PROMPTS_ITEM_NO_ARGS_EXACT: readonly string[] = ['description', 'name', 'score'];

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gz-${Date.now()}-${++_seq}.jsonl`);
}

/**
 * Aggregator with a single 'gz-svc' server:
 *   — one tool that scores 1.0 on intent 'list catalog entries'
 *   — one prompt WITH arguments (scores 0.67)
 *   — one prompt WITHOUT arguments (scores 0.67)
 *
 * Intent 'list catalog entries' (terms: [list, catalog, entries]):
 *   tool 'gz-svc/list_catalog_entries': haystack includes all 3 terms → score 1.0 → cast:executed
 *   prompt 'gz-svc/catalog-query-guide': 'catalog'✓ 'entries'✓ → score 0.67 > 0.1
 *   prompt 'gz-svc/catalog-index-explorer': 'catalog'✓ 'entries'✓ → score 0.67 > 0.1
 */
function makeGzAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('gz-svc', {
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
        // no arguments field → undefined after JSON round-trip
      },
    ],
  });
  return new Aggregator(
    [
      {
        id: 'gz-svc',
        name: 'GZ Service',
        type: 'remote',
        access: 'readwrite',
        category: 'search',
        endpoint: 'https://gz.example/mcp',
        lazy: true,
      } as ServerConfig,
    ],
    { backendFactory: () => backend, embedEnabled: false, ledgerDlqPath: dlq() },
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GZ-1: cast:executed prompts item.description is always a non-empty string', async () => {
  // allPrompts() always sets description via `[${config.name}] ${p.description || p.name}`.
  // EO/EP check typeof === 'string' only when present; GZ-1 asserts presence AND non-emptiness.
  const agg = makeGzAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list catalog entries' });
    assert.equal(result.isError, undefined, 'cast:executed must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'executed', `expected cast:executed, got cast:${String(body['cast'])}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'cast:executed must include at least one prompts item');
    for (const item of prompts) {
      assert.equal(typeof item['description'], 'string',
        `prompts item.description must be a string, got ${typeof item['description']}`);
      assert.ok((item['description'] as string).length > 0,
        'prompts item.description must be non-empty');
    }
  } finally {
    await agg.shutdown();
  }
});

test('GZ-2: cast:plan prompts item.description is always a non-empty string', async () => {
  const agg = makeGzAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list catalog entries', confirm: true });
    assert.equal(result.isError, undefined, 'cast:plan must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'plan', `expected cast:plan, got cast:${String(body['cast'])}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'cast:plan must include at least one prompts item');
    for (const item of prompts) {
      assert.equal(typeof item['description'], 'string',
        `prompts item.description must be a string, got ${typeof item['description']}`);
      assert.ok((item['description'] as string).length > 0,
        'prompts item.description must be non-empty');
    }
  } finally {
    await agg.shutdown();
  }
});

test('GZ-3: cast:executed prompts items WITH arguments have exactly {arguments, description, name, score}', async () => {
  const agg = makeGzAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list catalog entries' });
    assert.equal(result.isError, undefined, 'cast:executed must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'executed', `expected cast:executed, got cast:${String(body['cast'])}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'cast:executed must include at least one prompts item');

    const withArgs = prompts.filter((item) => 'arguments' in item);
    assert.ok(withArgs.length > 0,
      'cast:executed must have at least one prompts item with arguments (fixture defines one with arguments)');

    const sorted = [...PROMPTS_ITEM_WITH_ARGS_EXACT].sort();
    for (const item of withArgs) {
      const keys = Object.keys(item).sort();
      assert.deepEqual(
        keys,
        sorted,
        `cast:executed prompts item (with arguments) has wrong key set: expected ${JSON.stringify(sorted)} got ${JSON.stringify(keys)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GZ-4: cast:executed prompts items WITHOUT arguments have exactly {description, name, score}', async () => {
  const agg = makeGzAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list catalog entries' });
    assert.equal(result.isError, undefined, 'cast:executed must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'executed', `expected cast:executed, got cast:${String(body['cast'])}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'cast:executed must include at least one prompts item');

    const withoutArgs = prompts.filter((item) => !('arguments' in item));
    assert.ok(withoutArgs.length > 0,
      'cast:executed must have at least one prompts item without arguments (fixture defines one without)');

    const sorted = [...PROMPTS_ITEM_NO_ARGS_EXACT].sort();
    for (const item of withoutArgs) {
      const keys = Object.keys(item).sort();
      assert.deepEqual(
        keys,
        sorted,
        `cast:executed prompts item (without arguments) has wrong key set: expected ${JSON.stringify(sorted)} got ${JSON.stringify(keys)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GZ-5: cast:plan prompts items WITH arguments have exactly {arguments, description, name, score}', async () => {
  const agg = makeGzAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list catalog entries', confirm: true });
    assert.equal(result.isError, undefined, 'cast:plan must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'plan', `expected cast:plan, got cast:${String(body['cast'])}`);
    const prompts = body['prompts'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(prompts) && prompts.length > 0, 'cast:plan must include at least one prompts item');

    const withArgs = prompts.filter((item) => 'arguments' in item);
    assert.ok(withArgs.length > 0,
      'cast:plan must have at least one prompts item with arguments (fixture defines one with arguments)');

    const sorted = [...PROMPTS_ITEM_WITH_ARGS_EXACT].sort();
    for (const item of withArgs) {
      const keys = Object.keys(item).sort();
      assert.deepEqual(
        keys,
        sorted,
        `cast:plan prompts item (with arguments) has wrong key set: expected ${JSON.stringify(sorted)} got ${JSON.stringify(keys)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});
