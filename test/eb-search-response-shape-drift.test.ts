/**
 * EB: Drift guard — ch1tty/search response shape (both code paths).
 *
 * ch1tty/search has TWO distinct response shapes depending on whether a
 * query/filter is provided:
 *
 * ── Path A: Filtered search (query | server | category present) ──────────
 * Top-level always-present: matches, total, latencyMs, tools
 * Per-tool always-present:  tool, server, serverName, category, description, inputSchema
 * Conditional: score (when query given), focus (when focus active), inFocus on tool
 *              (when focus active AND tool in focus), mode:'partial' (OR-fallback)
 *
 * ── Path B: Discovery summary (no query, no server, no category) ─────────
 * Top-level always-present: hint, latencyMs, servers, totalTools
 *
 * No test previously froze the complete response shape for either path; individual
 * tests only spot-checked specific fields. This guard catches renames and removals
 * of top-level response fields that would silently break API clients.
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

const DLQ = join(tmpdir(), `ch1tty-eb-drift-${process.pid}-${Date.now()}.jsonl`);

/** Required fields on every search result response (filtered path). */
const SEARCH_RESULT_REQUIRED: readonly string[] = ['latencyMs', 'matches', 'tools', 'total'];

/** Required fields on every tool entry in search tools[]. */
const TOOL_ENTRY_REQUIRED: readonly string[] = [
  'category',
  'description',
  'inputSchema',
  'server',
  'serverName',
  'tool',
];

/** Required fields on the discovery summary path (no query/filter). */
const DISCOVERY_REQUIRED: readonly string[] = ['hint', 'latencyMs', 'servers', 'totalTools'];

function makeAggregator(focusName?: string): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks', FIXTURE_SERVERS.tasks);
  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
    { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
    { id: 'tasks', name: 'Tasks', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp', lazy: true },
  ];
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: DLQ,
    ...(focusName ? { focus: focusName } : {}),
  });
}

async function search(agg: Aggregator, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/search', args);
  assert.equal(result.isError, undefined, 'search must not return an error');
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── Path A: Filtered search top-level shape ────────────────────────────────

describe('ch1tty/search filtered response top-level shape', () => {
  test('required top-level keys present when a query is given', async () => {
    const agg = makeAggregator();
    try {
      const body = await search(agg, { query: 'database' });
      const actual = Object.keys(body).sort();
      const missing = SEARCH_RESULT_REQUIRED.filter((k) => !actual.includes(k));
      assert.deepEqual(missing, [], `Missing required top-level keys: ${missing.join(', ')}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('no unexpected top-level keys in a plain query search (no focus, no pagination)', async () => {
    const agg = makeAggregator();
    try {
      const body = await search(agg, { query: 'database' });
      const actual = Object.keys(body).sort();
      // Only these keys are permitted in a plain, unfocused, non-paginated query search.
      const PLAIN_QUERY_PERMITTED: readonly string[] = ['latencyMs', 'matches', 'tools', 'total'];
      const unexpected = actual.filter((k) => !PLAIN_QUERY_PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected top-level keys in plain query search (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Path A: Per-tool entry shape ──────────────────────────────────────────

describe('ch1tty/search tool entry shape', () => {
  test('required tool entry keys present on every result', async () => {
    const agg = makeAggregator();
    try {
      const body = await search(agg, { query: 'database' });
      const tools = body.tools as Record<string, unknown>[];
      assert.ok(Array.isArray(tools) && tools.length > 0, 'tools must be a non-empty array for required-key test');
      for (const entry of tools) {
        const missing = TOOL_ENTRY_REQUIRED.filter((k) => !(k in entry));
        assert.deepEqual(
          missing,
          [],
          `Tool entry ${entry['tool']} missing required keys: ${missing.join(', ')}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('no unexpected tool entry keys in unfocused query search (no recentlyUsed, no inFocus)', async () => {
    const agg = makeAggregator();
    try {
      const body = await search(agg, { query: 'database' });
      const tools = body.tools as Record<string, unknown>[];
      assert.ok(Array.isArray(tools) && tools.length > 0, 'tools must be non-empty');
      // In a query search with no focus/session: permitted = required + score.
      const QUERY_TOOL_PERMITTED: readonly string[] = [
        'category',
        'description',
        'inputSchema',
        'score',
        'server',
        'serverName',
        'tool',
      ];
      for (const entry of tools) {
        const unexpected = Object.keys(entry).filter((k) => !QUERY_TOOL_PERMITTED.includes(k));
        assert.deepEqual(
          unexpected,
          [],
          `Tool ${entry['tool']} has unexpected fields: ${unexpected.join(', ')}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Path A: Conditional score field ───────────────────────────────────────

describe('ch1tty/search score field', () => {
  test('score is a number on every tool entry when query is given', async () => {
    const agg = makeAggregator();
    try {
      const body = await search(agg, { query: 'database sql' });
      const tools = body.tools as Record<string, unknown>[];
      assert.ok(Array.isArray(tools) && tools.length > 0, 'need results for score test');
      for (const entry of tools) {
        assert.ok(
          'score' in entry && typeof entry['score'] === 'number',
          `Tool ${entry['tool']} must have a numeric score when query is given`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Path A: Conditional focus fields ─────────────────────────────────────

describe('ch1tty/search focus fields', () => {
  test('focus field present at top level when focus is active', async () => {
    const agg = makeAggregator('code');
    try {
      const body = await search(agg, { query: 'database' });
      assert.ok(
        'focus' in body && typeof body['focus'] === 'string',
        'focus field must be present and a string when a focus profile is active',
      );
      assert.equal(body['focus'], 'code', 'focus value must match the active profile name');
    } finally {
      await agg.shutdown();
    }
  });

  test('focus field absent at top level when no focus is active', async () => {
    const agg = makeAggregator();
    try {
      const body = await search(agg, { query: 'database' });
      assert.ok(!('focus' in body), 'focus field must be absent when no focus profile is active');
    } finally {
      await agg.shutdown();
    }
  });

  test('inFocus true on in-focus tool entries when focus is active', async () => {
    const agg = makeAggregator('code');
    try {
      const body = await search(agg, { query: 'database' });
      const tools = body.tools as Record<string, unknown>[];
      assert.ok(Array.isArray(tools) && tools.length > 0, 'need results for inFocus test');
      // 'neon' is category 'code' — must be in-focus under focus:code.
      const neonTools = tools.filter((t) => (t['server'] as string) === 'neon');
      assert.ok(neonTools.length > 0, 'Expected at least one neon tool in database results');
      for (const entry of neonTools) {
        assert.equal(entry['inFocus'], true, `neon tool ${entry['tool']} must have inFocus:true under focus:code`);
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('inFocus absent on out-of-focus tool entries', async () => {
    const agg = makeAggregator('code');
    try {
      // Use a broad server filter so out-of-focus tools are also returned.
      const body = await search(agg, { query: 'task' });
      const tools = body.tools as Record<string, unknown>[];
      // 'tasks' and 'stripe' are 'ecosystem' — not in code focus.
      const ooFocus = tools.filter((t) => (t['server'] as string) !== 'neon');
      for (const entry of ooFocus) {
        assert.ok(!('inFocus' in entry), `Out-of-focus tool ${entry['tool']} must NOT have inFocus field`);
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Path A: Structural invariants ─────────────────────────────────────────

describe('ch1tty/search structural invariants (filtered path)', () => {
  test('tools is always an array', async () => {
    const agg = makeAggregator();
    try {
      const body = await search(agg, { query: 'zzznomatchzzz' });
      assert.ok(Array.isArray(body['tools']), 'tools must always be an array, even with 0 matches');
    } finally {
      await agg.shutdown();
    }
  });

  test('matches equals tools.length', async () => {
    const agg = makeAggregator();
    try {
      const body = await search(agg, { query: 'database' });
      const tools = body.tools as unknown[];
      assert.equal(
        body['matches'],
        tools.length,
        `matches (${body['matches']}) must equal tools.length (${tools.length})`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('total >= matches', async () => {
    const agg = makeAggregator();
    try {
      const body = await search(agg, { query: 'database' });
      assert.ok(
        (body['total'] as number) >= (body['matches'] as number),
        `total (${body['total']}) must be >= matches (${body['matches']})`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('latencyMs is a non-negative number (filtered path)', async () => {
    const agg = makeAggregator();
    try {
      const body = await search(agg, { query: 'database' });
      assert.ok(
        typeof body['latencyMs'] === 'number' && (body['latencyMs'] as number) >= 0,
        `latencyMs must be a non-negative number, got ${body['latencyMs']}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Path B: Discovery summary shape (no query/filter) ─────────────────────

describe('ch1tty/search discovery response shape (no query, no filter)', () => {
  test('required discovery keys present when no query/filter given', async () => {
    const agg = makeAggregator();
    try {
      const body = await search(agg, {});
      const actual = Object.keys(body).sort();
      const missing = DISCOVERY_REQUIRED.filter((k) => !actual.includes(k));
      assert.deepEqual(missing, [], `Missing required discovery keys: ${missing.join(', ')}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('no unexpected keys in plain discovery response (no focus)', async () => {
    const agg = makeAggregator();
    try {
      const body = await search(agg, {});
      const actual = Object.keys(body).sort();
      const PLAIN_DISCOVERY_PERMITTED: readonly string[] = ['hint', 'latencyMs', 'servers', 'totalTools'];
      const unexpected = actual.filter((k) => !PLAIN_DISCOVERY_PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in plain discovery response (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('totalTools is a positive integer in discovery response', async () => {
    const agg = makeAggregator();
    try {
      const body = await search(agg, {});
      assert.ok(
        typeof body['totalTools'] === 'number' && (body['totalTools'] as number) > 0,
        `totalTools must be a positive number, got ${body['totalTools']}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('servers is an array in discovery response', async () => {
    const agg = makeAggregator();
    try {
      const body = await search(agg, {});
      assert.ok(Array.isArray(body['servers']), 'servers must be an array in discovery response');
    } finally {
      await agg.shutdown();
    }
  });

  test('hint is a non-empty string in discovery response', async () => {
    const agg = makeAggregator();
    try {
      const body = await search(agg, {});
      assert.ok(
        typeof body['hint'] === 'string' && (body['hint'] as string).length > 0,
        'hint must be a non-empty string in discovery response',
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('focus field present in discovery response when focus is active', async () => {
    const agg = makeAggregator('code');
    try {
      const body = await search(agg, {});
      assert.ok('focus' in body, 'focus field must be present in discovery response when focus is active');
      assert.equal(body['focus'], 'code');
    } finally {
      await agg.shutdown();
    }
  });

  test('latencyMs is a non-negative number in discovery response', async () => {
    const agg = makeAggregator();
    try {
      const body = await search(agg, {});
      assert.ok(
        typeof body['latencyMs'] === 'number' && (body['latencyMs'] as number) >= 0,
        `latencyMs must be a non-negative number in discovery response, got ${body['latencyMs']}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});
