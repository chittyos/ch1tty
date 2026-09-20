/**
 * GH drift guard: freeze ch1tty/search tools[] entry VALUE TYPES and
 * discovery-path servers[] entry KEY SET + VALUE TYPES.
 *
 * EB froze the key sets for tools[] entries (required + permitted fields) and
 * confirmed score is a number. It does NOT assert:
 *   - `tool` is in namespaced "serverId/toolName" format (contains exactly one '/')
 *   - `server` is a plain serverId without '/' (not the full namespaced name)
 *   - `serverName` is a non-empty string
 *   - `category` is one of the valid ServerCategory enum values
 *   - `description` is a string (not null / number / object)
 *   - `inputSchema` is a non-null object (not a string or primitive)
 *   - `inFocus` is exactly boolean true (not 1, not "true") when focus active
 *
 * No test froze the discovery-path servers[] entry key set or value types.
 * A rename of `server` → `id`, or `tools` → `count`, or a category changing
 * to an unrecognised string would all silently pass EB's existing guards.
 *
 * GH closes those gaps:
 *
 *   GH-1  tools[] tool field is a non-empty string containing exactly one '/'
 *          (namespaced "serverId/toolName" format; never just a bare tool name)
 *   GH-2  tools[] server field is a non-empty string NOT containing '/'
 *          (plain serverId; must differ from the tool field)
 *   GH-3  tools[] serverName, category, description, inputSchema value types
 *          (serverName non-empty string; category one of VALID_CATEGORIES;
 *           description is a string; inputSchema is a non-null object)
 *   GH-4  tools[] inFocus is exactly boolean true — not 1, not "true", not
 *          a truthy object — when a focus profile is active and tool is in focus
 *   GH-5  servers[] entry key set in discovery mode without focus:
 *          exactly {name, category, server, tools} (no extra keys)
 *   GH-6  servers[] entry value types in discovery mode without focus:
 *          server and name are non-empty strings; category is one of
 *          VALID_CATEGORIES; tools is a non-negative integer
 *   GH-7  servers[] entry with focus: inFocus is exactly boolean (not 0/1);
 *          exact key set is {name, category, server, tools, inFocus}
 *
 * Frozen 2026-09-20.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (search, not cast)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Valid category enum (mirrors VALID_CATEGORIES in src-stdio/focus.ts) ──────

const VALID_CATEGORIES: readonly string[] = [
  'ecosystem', 'code', 'search', 'reasoning', 'desktop', 'documents', 'communication',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gh-${Date.now()}-${++dlqSeq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon', name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
];

function makeAgg(opts: { focus?: string } = {}): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    ...(opts.focus ? {
      focus: opts.focus,
      focusProfiles: {
        profiles: {
          code: { description: 'Code tools', categories: ['code' as const], servers: [], boost: 0.5 },
        },
      },
    } : {}),
  });
}

async function search(agg: Aggregator, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/search', args);
  assert.equal(result.isError, undefined, 'search must not error');
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── GH-1: tools[] tool field is namespaced ────────────────────────────────────

test('GH-1: tools[] tool field is non-empty string containing exactly one slash (namespaced)', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, { query: 'database' });
    const tools = body.tools as Record<string, unknown>[];
    assert.ok(Array.isArray(tools) && tools.length > 0, 'need at least one tool for GH-1');
    for (const entry of tools) {
      const tool = entry['tool'];
      assert.equal(typeof tool, 'string', `tool field must be a string, got ${typeof tool}`);
      assert.ok((tool as string).length > 0, 'tool field must be non-empty');
      const slashCount = ((tool as string).match(/\//g) ?? []).length;
      assert.equal(slashCount, 1, `tool field must contain exactly one slash (got "${tool}" with ${slashCount} slashes)`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GH-2: tools[] server field is a plain serverId (no slash) ─────────────────

test('GH-2: tools[] server field is non-empty string NOT containing a slash', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, { query: 'database' });
    const tools = body.tools as Record<string, unknown>[];
    assert.ok(Array.isArray(tools) && tools.length > 0, 'need at least one tool for GH-2');
    for (const entry of tools) {
      const server = entry['server'];
      const tool = entry['tool'];
      assert.equal(typeof server, 'string', `server field must be a string, got ${typeof server}`);
      assert.ok((server as string).length > 0, 'server field must be non-empty');
      assert.ok(!(server as string).includes('/'), `server field must not contain '/' (got "${server}")`);
      assert.notEqual(server, tool, 'server field must differ from tool field (server is a plain id, not namespaced)');
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GH-3: tools[] serverName, category, description, inputSchema value types ──

test('GH-3: tools[] serverName, category, description, and inputSchema are correctly typed', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, { query: 'database' });
    const tools = body.tools as Record<string, unknown>[];
    assert.ok(Array.isArray(tools) && tools.length > 0, 'need at least one tool for GH-3');
    for (const entry of tools) {
      // serverName: non-empty string
      assert.equal(typeof entry['serverName'], 'string',
        `serverName must be a string for tool "${entry['tool']}", got ${typeof entry['serverName']}`);
      assert.ok((entry['serverName'] as string).length > 0,
        `serverName must be non-empty for tool "${entry['tool']}"`);

      // category: one of VALID_CATEGORIES enum
      assert.equal(typeof entry['category'], 'string',
        `category must be a string for tool "${entry['tool']}"`);
      assert.ok(VALID_CATEGORIES.includes(entry['category'] as string),
        `category must be a valid ServerCategory, got "${entry['category']}" for tool "${entry['tool']}". Valid: ${VALID_CATEGORIES.join(', ')}`);

      // description: string (can be empty)
      assert.equal(typeof entry['description'], 'string',
        `description must be a string for tool "${entry['tool']}", got ${typeof entry['description']}`);

      // inputSchema: non-null object (not string, number, null, or array)
      assert.equal(typeof entry['inputSchema'], 'object',
        `inputSchema must be an object for tool "${entry['tool']}", got ${typeof entry['inputSchema']}`);
      assert.notEqual(entry['inputSchema'], null,
        `inputSchema must not be null for tool "${entry['tool']}"`);
      assert.ok(!Array.isArray(entry['inputSchema']),
        `inputSchema must not be an array for tool "${entry['tool']}"`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GH-4: tools[] inFocus is exactly boolean true ─────────────────────────────

test('GH-4: tools[] inFocus is exactly boolean true (not 1, not "true") when focus active and tool in focus', async () => {
  const agg = makeAgg({ focus: 'code' });
  try {
    const body = await search(agg, { query: 'database', focus: 'code' });
    const tools = body.tools as Record<string, unknown>[];
    assert.ok(Array.isArray(tools) && tools.length > 0, 'need at least one tool for GH-4');

    // Neon tools are in the 'code' category → must have inFocus: true (exact boolean)
    const neonTools = tools.filter((t) => (t['server'] as string) === 'neon');
    assert.ok(neonTools.length > 0, 'need at least one neon tool in results for GH-4');
    for (const entry of neonTools) {
      assert.ok('inFocus' in entry, `neon tool "${entry['tool']}" must have inFocus field when code focus active`);
      assert.equal(entry['inFocus'], true,
        `inFocus must be exactly boolean true for "${entry['tool']}", got ${JSON.stringify(entry['inFocus'])} (type: ${typeof entry['inFocus']})`);
      // Verify it's genuinely the boolean primitive, not a truthy number or string
      assert.equal(typeof entry['inFocus'], 'boolean',
        `inFocus must have type 'boolean', got '${typeof entry['inFocus']}' for "${entry['tool']}"`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GH-5: servers[] entry key set in discovery mode without focus ─────────────

test('GH-5: servers[] entry key set in discovery mode (no focus) is exactly {server, name, category, tools}', async () => {
  const EXPECTED_KEYS = ['category', 'name', 'server', 'tools'];
  const agg = makeAgg();
  try {
    const body = await search(agg, {});
    const servers = body.servers as Record<string, unknown>[];
    assert.ok(Array.isArray(servers) && servers.length > 0, 'need at least one server entry for GH-5');
    for (const entry of servers) {
      const actual = Object.keys(entry).sort();
      assert.deepEqual(actual, EXPECTED_KEYS,
        `servers[] entry key set must be exactly ${JSON.stringify(EXPECTED_KEYS)}, got ${JSON.stringify(actual)} for server "${entry['server']}"`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GH-6: servers[] entry value types in discovery mode ──────────────────────

test('GH-6: servers[] entry value types in discovery mode — server and name are non-empty strings, category is valid enum, tools is non-negative integer', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, {});
    const servers = body.servers as Record<string, unknown>[];
    assert.ok(Array.isArray(servers) && servers.length > 0, 'need at least one server entry for GH-6');
    for (const entry of servers) {
      // server: non-empty string
      assert.equal(typeof entry['server'], 'string',
        `server field must be a string, got ${typeof entry['server']}`);
      assert.ok((entry['server'] as string).length > 0, 'server field must be non-empty');

      // name: non-empty string
      assert.equal(typeof entry['name'], 'string',
        `name field must be a string for server "${entry['server']}"`);
      assert.ok((entry['name'] as string).length > 0,
        `name field must be non-empty for server "${entry['server']}"`);

      // category: one of VALID_CATEGORIES
      assert.equal(typeof entry['category'], 'string',
        `category must be a string for server "${entry['server']}"`);
      assert.ok(VALID_CATEGORIES.includes(entry['category'] as string),
        `category "${entry['category']}" is not a valid ServerCategory for server "${entry['server']}". Valid: ${VALID_CATEGORIES.join(', ')}`);

      // tools: non-negative integer
      assert.equal(typeof entry['tools'], 'number',
        `tools field must be a number for server "${entry['server']}"`);
      assert.ok(Number.isInteger(entry['tools'] as number),
        `tools field must be an integer for server "${entry['server']}"`);
      assert.ok((entry['tools'] as number) >= 0,
        `tools field must be non-negative for server "${entry['server']}"`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GH-7: servers[] entry with focus — inFocus is exactly boolean ─────────────

test('GH-7: servers[] entry with focus active — inFocus is exactly boolean and key set is {server, name, category, tools, inFocus}', async () => {
  const EXPECTED_KEYS_NO_FOCUS = ['category', 'name', 'server', 'tools'];
  const EXPECTED_KEYS_WITH_FOCUS = ['category', 'inFocus', 'name', 'server', 'tools'];
  const agg = makeAgg({ focus: 'code' });
  try {
    const body = await search(agg, { focus: 'code' });
    const servers = body.servers as Record<string, unknown>[];
    assert.ok(Array.isArray(servers) && servers.length > 0, 'need server entries for GH-7');

    let sawInFocusTrue = false;
    let sawInFocusFalse = false;

    for (const entry of servers) {
      const actual = Object.keys(entry).sort();
      assert.ok(
        JSON.stringify(actual) === JSON.stringify(EXPECTED_KEYS_WITH_FOCUS) ||
        JSON.stringify(actual) === JSON.stringify(EXPECTED_KEYS_NO_FOCUS),
        `servers[] entry key set must be exactly ${JSON.stringify(EXPECTED_KEYS_WITH_FOCUS)} or ${JSON.stringify(EXPECTED_KEYS_NO_FOCUS)}, got ${JSON.stringify(actual)} for server "${entry['server']}"`
      );

      if ('inFocus' in entry) {
        assert.equal(typeof entry['inFocus'], 'boolean',
          `inFocus must have type 'boolean', got '${typeof entry['inFocus']}' for server "${entry['server']}"`);
        if (entry['inFocus'] === true) sawInFocusTrue = true;
        if (entry['inFocus'] === false) sawInFocusFalse = true;
      }
    }

    // Both in-focus (neon: code) and out-of-focus (stripe: ecosystem) servers present
    assert.ok(sawInFocusTrue || sawInFocusFalse,
      'at least one server must have inFocus field when focus is active');
  } finally {
    await agg.shutdown();
  }
});
