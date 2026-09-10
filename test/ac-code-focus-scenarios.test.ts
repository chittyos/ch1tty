/**
 * Workstream W — code focus profile scenarios.
 *
 * Validates the code focus profile:
 *  - cloudflare/ and neon/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves code/development intents to code-category tools
 *  - out-of-focus tools remain reachable when code focus is active
 *  - multi-step code workflow executes correctly via fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const CODE_FOCUS_PROFILES = {
  profiles: {
    code: {
      description: 'Software development — deploy workers, query databases, read library docs, manage files.',
      categories: ['code' as const],
      servers: ['cloudflare', 'context7', 'neon', 'fs'],
      boost: 0.5,
    },
    finance: {
      description: 'Finance — payments and billing',
      categories: ['ecosystem' as const],
      servers: ['stripe'],
      boost: 0.5,
    },
  },
};

const FIXTURE_CONFIGS: ServerConfig[] = [
  { id: 'cloudflare', name: 'Cloudflare', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.cloudflare' },
  { id: 'context7', name: 'Context7', type: 'local', access: 'read', category: 'code', command: 'node', args: ['./context7'] },
  { id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'fs', name: 'Filesystem', type: 'local', access: 'readwrite', category: 'desktop', command: 'node', args: ['./fixture-fs'] },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.stripe' },
];

type SearchResult = { tools?: Array<{ tool: string; score?: number; inFocus?: boolean }>; focus?: string };
type CastResult = Record<string, unknown>;

function parseSearch(result: { content: Array<{ type: string; text?: string }> }): SearchResult {
  return JSON.parse(result.content[0]?.text ?? '{}') as SearchResult;
}

function parseCast(result: { content: Array<{ type: string; text?: string }> }): CastResult {
  return JSON.parse(result.content[0]?.text ?? '{}') as CastResult;
}

function buildAggregator(focus?: string): { aggregator: Aggregator; fixture: FixtureBackend } {
  const fixture = new FixtureBackend();
  for (const [id, def] of Object.entries(FIXTURE_SERVERS)) {
    fixture.defineServer(id, def);
  }
  const aggregator = new Aggregator(FIXTURE_CONFIGS, {
    focusProfiles: CODE_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('code focus: search "deploy worker" ranks cloudflare/ tools first', async () => {
  const { aggregator } = buildAggregator('code');

  const result = await aggregator.callTool('ch1tty/search', { query: 'deploy worker', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const cfIdx = tools.findIndex((r) => r.tool.startsWith('cloudflare/'));
  const outIdx = tools.findIndex((r) => !['cloudflare/', 'neon/', 'context7/', 'fs/'].some((p) => r.tool.startsWith(p)));

  assert.ok(cfIdx !== -1, 'cloudflare/ tools should appear for deploy worker query');
  if (outIdx !== -1) {
    assert.ok(cfIdx < outIdx, 'cloudflare/ tools should rank above out-of-focus tools');
  }
  assert.equal(parsed.focus, 'code', 'search response should report active focus');

  const { aggregator: noFocusAgg } = buildAggregator();
  const noFocusResult = await noFocusAgg.callTool('ch1tty/search', { query: 'deploy worker', limit: 10 });
  const cfIdxNoFocus = (parseSearch(noFocusResult).tools ?? []).findIndex((r) => r.tool.startsWith('cloudflare/'));
  assert.ok(cfIdxNoFocus >= 0, 'cloudflare/ tools should appear even without focus');
  assert.ok(cfIdx <= cfIdxNoFocus,
    `focus should rank cloudflare/ at least as high as no-focus (focused: pos ${cfIdx}, no-focus: pos ${cfIdxNoFocus})`);
});

test('code focus: out-of-focus tools (stripe) remain reachable via search', async () => {
  const { aggregator } = buildAggregator('code');

  const result = await aggregator.callTool('ch1tty/search', { query: 'payment balance billing', limit: 15 });
  assert.equal(result.isError, undefined, 'search should not error with code focus');

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('stripe/')), 'stripe/ tools must remain reachable even when code focus is active');
});

test('code focus: cast "run a SQL query" resolves to neon/ tool', async () => {
  const { aggregator } = buildAggregator('code');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'run a SQL query against the production database to fetch recent users',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(
    resolved.tool.startsWith('neon/'),
    `cast should resolve to neon/ for SQL intent, got: ${resolved.tool}`,
  );
  assert.equal(cast.focus, 'code', 'cast response should report active focus');
});

test('code focus: status reports active focus as code', async () => {
  const { aggregator } = buildAggregator('code');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'code', 'status must report code as active focus');
});

test('code focus: execute neon/run_sql succeeds', async () => {
  const { aggregator } = buildAggregator('code');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'neon/run_sql',
    args: { project_id: 'proj-abc123', sql: 'SELECT count(*) FROM users' },
  });
  assert.equal(result.isError, undefined, 'neon/run_sql should succeed under code focus');
  const parsed = JSON.parse(result.content[0].text as string) as { rows?: unknown[] };
  assert.ok(Array.isArray(parsed.rows), 'result should include rows array');
});

test('code focus: per-call focus=code boosts cloudflare/ tools without default focus', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/search', { query: 'workers deploy', limit: 10, focus: 'code' });
  assert.equal(result.isError, undefined, 'per-call focus should not error');

  const parsed = parseSearch(result);
  assert.equal(parsed.focus, 'code', 'search response should report code focus set via per-call param');
  const tools = parsed.tools ?? [];
  const cfIdx = tools.findIndex((r) => r.tool.startsWith('cloudflare/'));
  assert.ok(cfIdx !== -1, 'cloudflare/ tools should appear with per-call focus=code');

  const noFocusResult = await aggregator.callTool('ch1tty/search', { query: 'workers deploy', limit: 10 });
  const cfIdxNoFocus = (parseSearch(noFocusResult).tools ?? []).findIndex((r) => r.tool.startsWith('cloudflare/'));
  assert.ok(cfIdxNoFocus >= 0, 'cloudflare/ tools should appear without focus too');
  assert.ok(cfIdx <= cfIdxNoFocus,
    `per-call focus=code should rank cloudflare/ at least as high as no-focus (focused: pos ${cfIdx}, no-focus: pos ${cfIdxNoFocus})`);
});
