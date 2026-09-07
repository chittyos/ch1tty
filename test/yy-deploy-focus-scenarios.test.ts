/**
 * Workstream Y — deploy focus profile scenarios.
 *
 * Validates the deploy focus profile:
 *  - cloudflare/ and cloudflare-builds/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves deployment intents to cloudflare/ and cloudflare-builds/ tools
 *  - out-of-focus tools remain reachable when deploy focus is active
 *  - multi-step deploy → PR → task workflows execute via the fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const DEPLOY_FOCUS_PROFILES = {
  profiles: {
    deploy: {
      description: 'Deployment and shipping — build, deploy, and monitor Cloudflare Workers; create and review PRs on GitHub; track deployment tasks',
      categories: [],
      servers: ['cloudflare', 'cloudflare-builds', 'github', 'ship', 'linear', 'tasks'],
      boost: 0.6,
    },
    governance: {
      description: 'Governance and identity',
      categories: ['ecosystem' as const],
      servers: ['ledger', 'session'],
      boost: 0.5,
    },
  },
};

const FIXTURE_CONFIGS: ServerConfig[] = [
  { id: 'cloudflare', name: 'Cloudflare Platform', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.cloudflare' },
  { id: 'cloudflare-builds', name: 'Cloudflare Workers Builds', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.cloudflare-builds' },
  { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.github' },
  { id: 'tasks', name: 'ChittyAgent Tasks', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/tasks-mcp/dist/index.js'] },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'ledger', name: 'ChittyLedger', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/ledger-mcp/dist/index.js'] },
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
    focusProfiles: DEPLOY_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('deploy focus: search "deploy worker" ranks cloudflare/ tools first', async () => {
  const { aggregator } = buildAggregator('deploy');

  const result = await aggregator.callTool('ch1tty/search', { query: 'deploy worker', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const cfIdx = tools.findIndex((r) => r.tool.startsWith('cloudflare/'));
  const outIdx = tools.findIndex((r) => !['cloudflare/', 'cloudflare-builds/', 'github/', 'tasks/'].some((p) => r.tool.startsWith(p)));

  assert.ok(cfIdx !== -1, 'cloudflare/ tools should appear in results');
  if (outIdx !== -1) {
    assert.ok(cfIdx < outIdx, 'cloudflare/ tools should rank above out-of-focus tools');
  }
  assert.equal(parsed.focus, 'deploy', 'search response should report active focus');
});

test('deploy focus: search "deploy worker" includes cloudflare/deploy_worker', async () => {
  const { aggregator } = buildAggregator('deploy');

  const result = await aggregator.callTool('ch1tty/search', { query: 'deploy worker cloudflare', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'cloudflare/deploy_worker'), 'cloudflare/deploy_worker must appear in results');
});

test('deploy focus: search "list builds" includes cloudflare-builds/workers_builds_list_builds', async () => {
  const { aggregator } = buildAggregator('deploy');

  const result = await aggregator.callTool('ch1tty/search', { query: 'list builds workers cloudflare', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(
    toolNames.some((t) => t === 'cloudflare-builds/workers_builds_list_builds'),
    'cloudflare-builds/workers_builds_list_builds must appear in results',
  );
});

test('deploy focus: out-of-focus tools (neon) remain reachable via search', async () => {
  const { aggregator } = buildAggregator('deploy');

  const result = await aggregator.callTool('ch1tty/search', { query: 'neon database sql', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('neon/')), 'neon/ tools must remain reachable when deploy focus is active');
});

test('deploy focus: no focus — cloudflare tools still accessible (lens not gate)', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/search', { query: 'deploy cloudflare worker', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('cloudflare/')), 'cloudflare/ tools must be reachable without any focus');
});

test('deploy focus: execute cloudflare/deploy_worker returns deployment result', async () => {
  const { aggregator, fixture } = buildAggregator('deploy');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare/deploy_worker',
    args: { script_name: 'my-worker', script: 'export default { fetch() {} }' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const deployment = JSON.parse(result.content[0].text as string) as { id: string; name: string; status: string };
  assert.ok(deployment.id, 'deployment should have an id');
  assert.ok(deployment.status, 'deployment should have a status');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'cloudflare' && c.tool === 'deploy_worker'), 'cloudflare/deploy_worker must be in call log');
});

test('deploy focus: execute cloudflare/list_workers returns worker list', async () => {
  const { aggregator, fixture } = buildAggregator('deploy');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare/list_workers',
    args: {},
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const workers = JSON.parse(result.content[0].text as string) as Array<{ id: string; name: string; status: string }>;
  assert.ok(Array.isArray(workers), 'should return an array of workers');
  assert.ok(workers.length > 0, 'fixture should return at least one worker');
  assert.ok(workers.every((w) => w.id && w.name && w.status), 'each worker should have id, name, and status');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'cloudflare' && c.tool === 'list_workers'), 'cloudflare/list_workers must be in call log');
});

test('deploy focus: execute cloudflare-builds/workers_builds_list_builds returns build list', async () => {
  const { aggregator, fixture } = buildAggregator('deploy');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare-builds/workers_builds_list_builds',
    args: { workerId: 'my-worker' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const builds = JSON.parse(result.content[0].text as string) as Array<{ id: string; status: string }>;
  assert.ok(Array.isArray(builds), 'should return an array of builds');
  assert.ok(builds.length > 0, 'fixture should return at least one build');

  const calls = fixture.getCallLog();
  assert.ok(
    calls.some((c) => c.serverId === 'cloudflare-builds' && c.tool === 'workers_builds_list_builds'),
    'cloudflare-builds/workers_builds_list_builds must be in call log',
  );
});

test('deploy focus: multi-step — list builds, check status, set active worker', async () => {
  const { aggregator, fixture } = buildAggregator('deploy');
  const sessionId = 'deploy-scenario-001';
  fixture.clearCallLog();

  // Step 1: list recent builds to find the latest successful one
  const listResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare-builds/workers_builds_list_builds',
    args: { workerId: 'ch1tty-gateway' },
  }, sessionId);
  assert.equal(listResult.isError, undefined, 'list_builds should succeed');
  const builds = JSON.parse(listResult.content[0].text as string) as Array<{ buildUUID: string; worker: string; status: string }>;
  assert.ok(builds.length > 0, 'should return builds');

  // Step 2: get details of the first build using its buildUUID
  const buildUUID = builds[0]?.buildUUID ?? 'uuid-abc';
  const getResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare-builds/workers_builds_get_build',
    args: { buildUUID },
  }, sessionId);
  assert.equal(getResult.isError, undefined, 'get_build should succeed');

  // Step 3: set the session context to this worker for subsequent build API calls
  const workerName = builds[0]?.worker ?? 'ch1tty-gateway';
  const activateResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare-builds/workers_builds_set_active_worker',
    args: { workerId: workerName },
  }, sessionId);
  assert.equal(activateResult.isError, undefined, 'set_active_worker should succeed');

  const calls = fixture.getCallLog();
  const callKeys = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(callKeys.includes('cloudflare-builds/workers_builds_list_builds'), 'list_builds must be in call log');
  assert.ok(callKeys.includes('cloudflare-builds/workers_builds_get_build'), 'get_build must be in call log');
  assert.ok(callKeys.includes('cloudflare-builds/workers_builds_set_active_worker'), 'set_active_worker must be in call log');
});

test('deploy focus: multi-step — deploy worker, open PR, create task', async () => {
  const { aggregator, fixture } = buildAggregator('deploy');
  const sessionId = 'deploy-scenario-002';
  fixture.clearCallLog();

  // Step 1: deploy worker
  const deployResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare/deploy_worker',
    args: { script_name: 'feature-worker', script: 'export default { fetch() {} }' },
  }, sessionId);
  assert.equal(deployResult.isError, undefined, 'deploy_worker should succeed');
  const deployment = JSON.parse(deployResult.content[0].text as string) as { id: string; name: string; status: string };
  assert.ok(deployment.id, 'deployment should have an id');

  // Step 2: open a PR to track the deployment
  const prResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'github/create_pull_request',
    args: { owner: 'chittyos', repo: 'ch1tty', title: `Deploy ${deployment.name}`, body: `Worker deployed: ${deployment.id}`, head: 'feature/deploy', base: 'main' },
  }, sessionId);
  assert.equal(prResult.isError, undefined, 'create_pull_request should succeed');
  const pr = JSON.parse(prResult.content[0].text as string) as { number: number; state: string };
  assert.ok(pr.number, 'PR should have a number');

  // Step 3: create a follow-up task
  const taskResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'tasks/create_task',
    args: { entity_id: 'ch1tty', title: `Post-deploy validation for ${deployment.name} (PR #${pr.number})` },
  }, sessionId);
  assert.equal(taskResult.isError, undefined, 'create_task should succeed');

  const calls = fixture.getCallLog();
  const callKeys = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(callKeys.includes('cloudflare/deploy_worker'), 'deploy_worker must be in call log');
  assert.ok(callKeys.includes('github/create_pull_request'), 'create_pull_request must be in call log');
  assert.ok(callKeys.includes('tasks/create_task'), 'create_task must be in call log');
});

test('deploy focus: status reports active focus as deploy', async () => {
  const { aggregator } = buildAggregator('deploy');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'deploy', 'status must report deploy as active focus');
});

test('deploy focus: cast "deploy a worker" resolves to cloudflare/deploy_worker', async () => {
  const { aggregator } = buildAggregator('deploy');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'deploy a cloudflare worker',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(
    resolved.tool === 'cloudflare/deploy_worker',
    `cast should resolve to cloudflare/deploy_worker, got: ${resolved.tool}`,
  );
  assert.equal(cast.focus, 'deploy', 'cast response should report active focus');
});

test('deploy focus: cast "list build runs" resolves to cloudflare-builds tool', async () => {
  const { aggregator } = buildAggregator('deploy');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list recent build runs for a cloudflare worker',
    confirm: true,
  });
  assert.equal(result.isError, undefined);

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(
    resolved.tool.startsWith('cloudflare-builds/'),
    `should resolve to a cloudflare-builds/ tool, got: ${resolved.tool}`,
  );
});
