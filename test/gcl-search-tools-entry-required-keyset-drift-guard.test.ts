/**
 * GCL drift guard: freeze search tools[] entry minimum required key set and value types.
 *
 * GCK-5 (PR open, not yet on main) freezes the MAX key set per tools[] entry —
 * no key may appear OUTSIDE {tool, server, serverName, category, description,
 * inputSchema, score, recentlyUsed, inFocus}. But no test on main freezes:
 *
 *   1. The MINIMUM required keys — silently dropping `serverName`, `description`,
 *      or `inputSchema` from every entry would pass GCK-5 (the absence of a
 *      required key is not a rogue key).
 *   2. `score` conditional: always present when query is non-empty; always absent
 *      when the call has no query (server/category filter only).
 *   3. `serverName` value: must equal the configured server name (not an empty
 *      string, not a serverId, not undefined).
 *   4. Value type invariants: `tool`, `server`, `serverName`, `category`,
 *      `description` are non-empty strings; `inputSchema` is a non-null object;
 *      `score` (when present) is a number in [0, 1.3].
 *   5. `inFocus: true` appears on tools whose server IS in the active focus
 *      profile, and is absent on tools whose server is NOT in focus — the
 *      conditional is per-entry, not per-response.
 *
 * Source: src-stdio/aggregator.ts lines ~820–841 (tools[] entry construction).
 *
 * GCL freezes:
 *
 *   GCL-1  every tools[] entry when query is present has AT MINIMUM
 *          {tool, server, serverName, category, description, inputSchema, score}
 *
 *   GCL-2  `score` is present (and a number) when query is non-empty;
 *          absent when using server filter with no query
 *
 *   GCL-3  `serverName` equals the configured server name (not empty, not id)
 *
 *   GCL-4  value type invariants: string fields are non-empty strings;
 *          inputSchema is a non-null object; score (when present) is a
 *          finite number in [0, 1.3] (baseline score + 0.3 name bonus)
 *
 *   GCL-5  `inFocus: true` is per-entry: present for in-focus server tools,
 *          absent for out-of-focus server tools in the same response
 *
 * Frozen 2026-09-27.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (search tools[] entry shape)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen constants ──────────────────────────────────────────────────────────

// Always-required keys in every tools[] entry when a query is present.
const REQUIRED_WITH_QUERY: readonly string[] = [
  'tool', 'server', 'serverName', 'category', 'description', 'inputSchema', 'score',
];

// Always-required keys when using a server/category filter with no query (no score).
const REQUIRED_WITHOUT_QUERY: readonly string[] = [
  'tool', 'server', 'serverName', 'category', 'description', 'inputSchema',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const STRIPE_CONFIG: ServerConfig = {
  id: 'stripe',
  name: 'Stripe',
  type: 'remote',
  access: 'readwrite',
  category: 'ecosystem',
  endpoint: 'https://stripe.com/mcp',
  lazy: true,
};

const NEON_CONFIG: ServerConfig = {
  id: 'neon',
  name: 'Neon',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.tech/mcp',
  lazy: true,
};

// finance focus: includes ecosystem category (matches stripe, not neon)
const FINANCE_FOCUS_PROFILES = {
  profiles: {
    finance: {
      description: 'Billing, payments, and financial ecosystem tools',
      categories: ['ecosystem' as const],
      servers: ['stripe'],
      boost: 0.5,
    },
  },
};

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gcl-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(configs: ServerConfig[] = [STRIPE_CONFIG]): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    suggestionsCatalog: {},
  });
}

async function searchTools(
  agg: Aggregator,
  args: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> {
  const result = await agg.callTool('ch1tty/search', args);
  assert.equal(result.isError, undefined, 'search must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  assert.equal(content[0]!.type, 'text');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  const tools = body['tools'];
  assert.ok(Array.isArray(tools), 'response must have tools array');
  assert.ok(tools.length > 0, `expected ≥ 1 tool; got 0 for args ${JSON.stringify(args)}`);
  return tools as Array<Record<string, unknown>>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GCL-1: every tools[] entry has at minimum the required keys when query is present', async () => {
  const agg = makeAgg();
  try {
    const tools = await searchTools(agg, { query: 'stripe payments' });
    for (const entry of tools) {
      for (const key of REQUIRED_WITH_QUERY) {
        assert.ok(
          key in entry,
          `tools[] entry missing required key '${key}'; entry keys: ${JSON.stringify(Object.keys(entry).sort())}`,
        );
      }
    }
    assert.ok(
      tools.length >= 1,
      `expected ≥ 1 stripe tool in results; got ${tools.length}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GCL-2: score present (number) when query given; absent when server filter with no query', async () => {
  const agg = makeAgg();
  try {
    // With query → score must be present on every entry
    const withQuery = await searchTools(agg, { query: 'stripe payments' });
    for (const entry of withQuery) {
      assert.ok('score' in entry, `score must be present when query given; entry: ${JSON.stringify(Object.keys(entry))}`);
      assert.equal(typeof entry['score'], 'number', `score must be a number; got ${typeof entry['score']}`);
    }

    // Without query (server filter only) → score must be absent on every entry
    const withoutQuery = await searchTools(agg, { server: 'stripe' });
    for (const entry of withoutQuery) {
      assert.ok(
        !('score' in entry),
        `score must be absent when no query; entry keys: ${JSON.stringify(Object.keys(entry).sort())}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GCL-3: serverName equals the configured server name (not serverId, not empty)', async () => {
  const agg = makeAgg();
  try {
    const tools = await searchTools(agg, { query: 'stripe payments' });
    for (const entry of tools) {
      const serverName = entry['serverName'];
      assert.equal(typeof serverName, 'string', `serverName must be a string; got ${typeof serverName}`);
      assert.ok(
        (serverName as string).length > 0,
        'serverName must be non-empty',
      );
      // serverName must be the configured display name, not the id ('stripe' vs 'Stripe')
      assert.equal(
        serverName,
        'Stripe',
        `serverName must equal configured name 'Stripe'; got '${String(serverName)}'`,
      );
      // serverName must NOT equal serverId
      const server = entry['server'] as string;
      assert.notEqual(
        serverName,
        server,
        `serverName ('${String(serverName)}') must differ from serverId ('${server}')`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GCL-4: value type invariants — string fields non-empty, inputSchema is object, score in [0, 1.3]', async () => {
  const agg = makeAgg();
  try {
    const tools = await searchTools(agg, { query: 'stripe payments' });
    for (const entry of tools) {
      for (const key of ['tool', 'server', 'serverName', 'category', 'description'] as const) {
        const val = entry[key];
        assert.equal(typeof val, 'string', `${key} must be a string; got ${typeof val}`);
        assert.ok((val as string).length > 0, `${key} must be non-empty`);
      }

      const schema = entry['inputSchema'];
      assert.ok(
        schema !== null && typeof schema === 'object' && !Array.isArray(schema),
        `inputSchema must be a non-null plain object; got ${JSON.stringify(schema)}`,
      );

      const score = entry['score'];
      assert.equal(typeof score, 'number', `score must be a number; got ${typeof score}`);
      assert.ok(
        isFinite(score as number) && (score as number) >= 0 && (score as number) <= 1.3,
        `score must be finite in [0, 1.3]; got ${String(score)}`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});

test('GCL-5: inFocus:true on in-focus server tools, absent on out-of-focus server tools in same response', async () => {
  // Two-server fixture: stripe (ecosystem, in-focus for finance) + neon (code, not in finance focus)
  const agg = makeAgg([STRIPE_CONFIG, NEON_CONFIG]);
  try {
    // Use a query that matches both stripe and neon tools
    const tools = await searchTools(agg, { query: 'list', focus: 'finance' }, );

    let sawStripe = false;
    let sawNeon = false;
    for (const entry of tools) {
      if (entry['server'] === 'stripe') {
        sawStripe = true;
        // stripe is in the finance focus (ecosystem category) → inFocus must be true
        assert.equal(
          entry['inFocus'],
          true,
          `stripe tool must have inFocus:true when finance focus active; keys: ${JSON.stringify(Object.keys(entry).sort())}`,
        );
      }
      if (entry['server'] === 'neon') {
        sawNeon = true;
        // neon is NOT in the finance focus (code category, not ecosystem) → inFocus must be absent
        assert.ok(
          !('inFocus' in entry),
          `neon tool must NOT have inFocus key when outside finance focus; keys: ${JSON.stringify(Object.keys(entry).sort())}`,
        );
      }
    }
    assert.ok(sawStripe, 'expected at least one stripe tool in results for query "list"');
    assert.ok(sawNeon, 'expected at least one neon tool in results for query "list"');
  } finally {
    await agg.shutdown();
  }
});
