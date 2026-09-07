/**
 * Workstream Q — cloud focus profile scenarios.
 *
 * Validates the cloud focus profile (Cloudflare platform tools):
 *  - cloudflare/ and cloudflare-builds/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves deployment/build intents to cloudflare/ tools
 *  - out-of-focus tools remain reachable when cloud focus is active
 *  - multi-step deploy + build-log workflows execute correctly via the fixture backend
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const CLOUD_FOCUS_PROFILES = {
  profiles: {
    cloud: {
      description: 'Cloudflare platform — deploy, build, and manage Workers in production and staging environments',
      categories: ['ecosystem' as const],
      servers: ['cloudflare', 'cloudflare-builds'],
      boost: 0.5,
    },
    code: {
      description: 'Software development',
      categories: ['code' as const],
      servers: ['github', 'neon'],
      boost: 0.5,
    },
  },
};

const FIXTURE_CONFIGS: ServerConfig[] = [
  { id: 'cloudflare', name: 'Cloudflare Platform', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.cloudflare' },
  { id: 'cloudflare-builds', name: 'Cloudflare Workers Builds', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.cloudflare-builds' },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.github' },
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
    focusProfiles: CLOUD_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('cloud focus: shipped profile contract — categories, servers, and boost match expected values', () => {
  const raw = readFileSync(resolve(process.cwd(), 'focus-profiles.json'), 'utf-8');
  const profiles = (JSON.parse(raw) as { profiles: Record<string, { categories: string[]; servers: string[]; boost: number }> }).profiles;
  const cloud = profiles['cloud'];
  assert.ok(cloud, 'cloud profile must exist in focus-profiles.json');
  assert.ok(cloud.categories.includes('ecosystem'), 'cloud profile must include ecosystem category');
  assert.ok(cloud.servers.includes('cloudflare'), 'cloud profile must include cloudflare server');
  assert.ok(cloud.servers.includes('cloudflare-builds'), 'cloud profile must include cloudflare-builds server');
  assert.ok(cloud.servers.includes('ship'), 'cloud profile must include ship server');
  assert.equal(cloud.boost, 0.5, 'cloud profile boost must be 0.5');
});

test('cloud focus: search "deploy worker" ranks cloudflare/ tools first', async () => {
  const { aggregator } = buildAggregator('cloud');

  const result = await aggregator.callTool('ch1tty/search', { query: 'deploy worker', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const cloudIdx = tools.findIndex((r) => r.tool.startsWith('cloudflare/') || r.tool.startsWith('cloudflare-builds/'));
  const otherIdx = tools.findIndex((r) => !r.tool.startsWith('cloudflare/') && !r.tool.startsWith('cloudflare-builds/'));

  assert.ok(cloudIdx !== -1, 'cloudflare/ or cloudflare-builds/ tools should appear in results');
  if (otherIdx !== -1) {
    assert.ok(cloudIdx < otherIdx, 'cloud tools should rank above out-of-focus tools for deploy query');
  }
  assert.equal(parsed.focus, 'cloud', 'search response should report active focus');
});

test('cloud focus: search "build logs" includes cloudflare-builds/ tools', async () => {
  const { aggregator } = buildAggregator('cloud');

  const result = await aggregator.callTool('ch1tty/search', { query: 'build logs', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(
    toolNames.some((t) => t.startsWith('cloudflare-builds/')),
    'cloudflare-builds/ tools must appear in search results for build logs query',
  );
});

test('cloud focus: out-of-focus tools (neon) remain reachable via search', async () => {
  const { aggregator } = buildAggregator('cloud');

  const result = await aggregator.callTool('ch1tty/search', { query: 'database sql', limit: 20 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('neon/')), 'neon/ tools must remain reachable with cloud focus active');
});

test('cloud focus: no focus — cloudflare tools still accessible (lens not gate)', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/search', { query: 'deploy cloudflare worker', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(
    toolNames.some((t) => t.startsWith('cloudflare/')),
    'cloudflare/ tools must be reachable without any focus active',
  );
});

test('cloud focus: execute list_workers returns fixture worker list', async () => {
  const { aggregator, fixture } = buildAggregator('cloud');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare/list_workers',
    args: {},
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const parsed = JSON.parse(result.content[0].text as string) as Array<{ id: string; name: string; status: string }>;
  assert.ok(Array.isArray(parsed), 'should return a workers array');
  assert.ok(parsed.length > 0, 'fixture should return at least one worker');
  assert.ok(parsed[0].name, 'each worker should have a name');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'cloudflare' && c.tool === 'list_workers'), 'cloudflare/list_workers must be in call log');
});

test('cloud focus: execute deploy_worker returns deployment confirmation', async () => {
  const { aggregator, fixture } = buildAggregator('cloud');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare/deploy_worker',
    args: { script_name: 'my-test-worker', script: 'addEventListener("fetch", e => e.respondWith(new Response("ok")))' },
  });
  assert.equal(result.isError, undefined, 'deploy_worker should succeed');

  const parsed = JSON.parse(result.content[0].text as string) as { id: string; name: string; status: string };
  assert.ok(parsed.status === 'deployed', `deploy_worker status should be 'deployed', got: ${parsed.status}`);
  assert.ok(parsed.id, 'deployment response should include an id');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'cloudflare' && c.tool === 'deploy_worker'), 'cloudflare/deploy_worker must be in call log');
});

test('cloud focus: execute workers_builds_list_builds returns build history', async () => {
  const { aggregator } = buildAggregator('cloud');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare-builds/workers_builds_list_builds',
    args: {},
  });
  assert.equal(result.isError, undefined, 'workers_builds_list_builds should succeed');

  const parsed = JSON.parse(result.content[0].text as string) as Array<{ buildUUID: string; status: string }>;
  assert.ok(Array.isArray(parsed), 'should return a builds array');
  assert.ok(parsed.length > 0, 'fixture should return at least one build');
  assert.ok(typeof parsed[0].buildUUID === 'string', 'each build entry should have a buildUUID');
});

test('cloud focus: execute get_worker_logs returns log entries', async () => {
  const { aggregator } = buildAggregator('cloud');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare/get_worker_logs',
    args: { worker_name: 'ch1tty-gateway' },
  });
  assert.equal(result.isError, undefined, 'get_worker_logs should succeed');

  const parsed = JSON.parse(result.content[0].text as string) as { worker: string; logs: Array<{ level: string; message: string }> };
  assert.ok(parsed.worker, 'response should include worker name');
  assert.ok(Array.isArray(parsed.logs), 'should return logs array');
  assert.ok(parsed.logs.length > 0, 'fixture should include at least one log entry');
});

test('cloud focus: multi-step — list builds, get failed build, fetch its logs', async () => {
  const { aggregator, fixture } = buildAggregator('cloud');
  const sessionId = 'cloud-scenario-001';
  fixture.clearCallLog();

  // Step 1: list builds to find a failed one
  const listResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare-builds/workers_builds_list_builds',
    args: {},
  }, sessionId);
  assert.equal(listResult.isError, undefined, 'list_builds should succeed');

  const builds = JSON.parse(listResult.content[0].text as string) as Array<{ buildUUID: string; status: string }>;
  const failedBuild = builds.find((b) => b.status === 'failed');
  assert.ok(failedBuild, 'fixture should include at least one failed build');

  // Step 2: get details of the failed build
  const getResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare-builds/workers_builds_get_build',
    args: { buildUUID: failedBuild.buildUUID },
  }, sessionId);
  assert.equal(getResult.isError, undefined, 'get_build should succeed');

  const buildDetail = JSON.parse(getResult.content[0].text as string) as { buildUUID: string; status: string; error?: string };
  assert.equal(buildDetail.status, 'failed', 'retrieved build should still be failed');

  // Step 3: fetch build logs for the failed build
  const logsResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare-builds/workers_builds_get_build_logs',
    args: { buildUUID: failedBuild.buildUUID },
  }, sessionId);
  assert.equal(logsResult.isError, undefined, 'get_build_logs should succeed');

  const logsData = JSON.parse(logsResult.content[0].text as string) as { buildUUID: string; logs: string };
  assert.ok(typeof logsData.logs === 'string' && logsData.logs.length > 0, 'build logs should be non-empty string');

  const calls = fixture.getCallLog();
  const toolNames = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(toolNames.includes('cloudflare-builds/workers_builds_list_builds'), 'list_builds must appear in call log');
  assert.ok(toolNames.includes('cloudflare-builds/workers_builds_get_build'), 'get_build must appear in call log');
  assert.ok(toolNames.includes('cloudflare-builds/workers_builds_get_build_logs'), 'get_build_logs must appear in call log');

  const getBuildCall = calls.find((c) => c.serverId === 'cloudflare-builds' && c.tool === 'workers_builds_get_build');
  const getLogsCall = calls.find((c) => c.serverId === 'cloudflare-builds' && c.tool === 'workers_builds_get_build_logs');
  assert.equal(getBuildCall?.args.buildUUID, failedBuild.buildUUID, 'get_build must forward the failed buildUUID');
  assert.equal(getLogsCall?.args.buildUUID, failedBuild.buildUUID, 'get_build_logs must forward the failed buildUUID');
});

test('cloud focus: status reports active focus as cloud', async () => {
  const { aggregator } = buildAggregator('cloud');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'cloud', 'status must report cloud as active focus');
});

test('cloud focus: cast "deploy a worker to production" with confirm resolves to cloudflare/deploy_worker', async () => {
  const { aggregator } = buildAggregator('cloud');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'deploy a worker script to production',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.equal(resolved.tool, 'cloudflare/deploy_worker', `cast should resolve to cloudflare/deploy_worker, got: ${resolved.tool}`);
  assert.equal(cast.focus, 'cloud', 'cast response should report active focus');
});
