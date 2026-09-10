/**
 * Workstream W — ops focus profile scenarios.
 *
 * Validates the ops focus profile:
 *  - cloudflare/, neon/, and github/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves deployment/infrastructure intents to ops-category tools
 *  - out-of-focus tools remain reachable when ops focus is active
 *  - multi-step ops workflow (deploy worker, check logs) executes via fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const OPS_FOCUS_PROFILES = {
  profiles: {
    ops: {
      description: 'Infrastructure and operations — deploy workers, manage databases, review code, and control files.',
      categories: ['ecosystem' as const, 'code' as const],
      servers: ['cloudflare', 'neon', 'github', 'orchestrator', 'fs'],
      boost: 0.5,
    },
    communication: {
      description: 'Cross-channel communication',
      categories: ['communication' as const],
      servers: ['imessage'],
      boost: 0.5,
    },
  },
};

const FIXTURE_CONFIGS: ServerConfig[] = [
  { id: 'cloudflare', name: 'Cloudflare', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.cloudflare' },
  { id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.github' },
  { id: 'orchestrator', name: 'Orchestrator', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.orchestrator' },
  { id: 'fs', name: 'Filesystem', type: 'local', access: 'readwrite', category: 'desktop', command: 'node', args: ['./fs'] },
  { id: 'imessage', name: 'iMessage', type: 'local', access: 'readwrite', category: 'communication', command: 'node', args: ['./imessage'] },
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
    focusProfiles: OPS_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('ops focus: search "deploy worker infrastructure" ranks cloudflare/ tools first', async () => {
  const { aggregator } = buildAggregator('ops');

  const result = await aggregator.callTool('ch1tty/search', { query: 'deploy worker infrastructure', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const opsPrefixes = ['cloudflare/', 'neon/', 'github/', 'orchestrator/', 'fs/'];
  const opsIdx = tools.findIndex((r) => opsPrefixes.some((p) => r.tool.startsWith(p)));
  const outIdx = tools.findIndex((r) => !opsPrefixes.some((p) => r.tool.startsWith(p)));

  assert.ok(opsIdx !== -1, 'ops tools should appear for deploy infrastructure query');
  if (outIdx !== -1) {
    assert.ok(opsIdx < outIdx, 'ops tools should rank above out-of-focus tools');
  }
  assert.equal(parsed.focus, 'ops', 'search response should report ops focus');

  const { aggregator: noFocusAgg } = buildAggregator();
  const noFocusResult = await noFocusAgg.callTool('ch1tty/search', { query: 'deploy worker infrastructure', limit: 10 });
  const opsIdxNoFocus = (parseSearch(noFocusResult).tools ?? []).findIndex((r) =>
    opsPrefixes.some((p) => r.tool.startsWith(p)),
  );
  assert.ok(opsIdxNoFocus >= 0, 'ops tools should appear even without focus');
  assert.ok(opsIdx <= opsIdxNoFocus,
    `focus should rank ops tools at least as high as no-focus (focused: pos ${opsIdx}, no-focus: pos ${opsIdxNoFocus})`);
});

test('ops focus: out-of-focus tools (imessage) remain reachable', async () => {
  const { aggregator } = buildAggregator('ops');

  const result = await aggregator.callTool('ch1tty/search', { query: 'send message contact', limit: 15 });
  assert.equal(result.isError, undefined, 'search should not error with ops focus');

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('imessage/')), 'imessage/ tools must remain reachable under ops focus');
});

test('ops focus: cast "deploy a Cloudflare Worker" resolves to cloudflare/ tool', async () => {
  const { aggregator } = buildAggregator('ops');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'deploy the updated Cloudflare Worker to production',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(
    resolved.tool.startsWith('cloudflare/'),
    `cast should resolve to cloudflare/ for Cloudflare Worker deploy intent, got: ${resolved.tool}`,
  );
  assert.equal(cast.focus, 'ops', 'cast response should report active focus');
});

test('ops focus: execute cloudflare/deploy_worker succeeds', async () => {
  const { aggregator } = buildAggregator('ops');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare/deploy_worker',
    args: { name: 'ch1tty-gateway', script: 'export default { fetch: () => new Response("ok") }' },
  });
  assert.equal(result.isError, undefined, 'cloudflare/deploy_worker should succeed under ops focus');
});

test('ops focus: multi-step — deploy worker then check logs', async () => {
  const { aggregator } = buildAggregator('ops');

  const deployResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare/deploy_worker',
    args: { name: 'ch1tty-gateway', script: 'export default { fetch: () => new Response("ok") }' },
  });
  assert.equal(deployResult.isError, undefined, 'deploy step should succeed');

  const logsResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare/get_worker_logs',
    args: { worker_name: 'ch1tty-gateway' },
  });
  assert.equal(logsResult.isError, undefined, 'get_worker_logs step should succeed');
});

test('ops focus: status reports active focus as ops', async () => {
  const { aggregator } = buildAggregator('ops');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'ops', 'status must report ops as active focus');
});

test('ops focus: per-call focus=ops boosts cloudflare/ tools without default focus', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/search', { query: 'workers deploy infrastructure', limit: 10, focus: 'ops' });
  assert.equal(result.isError, undefined, 'per-call focus should not error');

  const parsed = parseSearch(result);
  assert.equal(parsed.focus, 'ops', 'search response should report ops focus set via per-call param');
  const tools = parsed.tools ?? [];
  const cfIdx = tools.findIndex((r) => r.tool.startsWith('cloudflare/'));
  assert.ok(cfIdx !== -1, 'cloudflare/ tools should appear with per-call focus=ops');

  const noFocusResult = await aggregator.callTool('ch1tty/search', { query: 'workers deploy infrastructure', limit: 10 });
  const cfIdxNoFocus = (parseSearch(noFocusResult).tools ?? []).findIndex((r) => r.tool.startsWith('cloudflare/'));
  assert.ok(cfIdxNoFocus >= 0, 'cloudflare/ tools should appear without focus too');
  assert.ok(cfIdx <= cfIdxNoFocus,
    `per-call focus=ops should rank cloudflare/ at least as high as no-focus (focused: pos ${cfIdx}, no-focus: pos ${cfIdxNoFocus})`);
});
