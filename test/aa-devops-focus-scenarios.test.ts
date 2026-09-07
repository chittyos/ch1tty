/**
 * Workstream AA — devops focus profile scenarios.
 *
 * Validates the devops focus profile with cloudflare + cloudflare-builds + github + neon as wired backends:
 *  - cloudflare/ and cloudflare-builds/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves devops intents to cloudflare/ and cloudflare-builds/ tools
 *  - out-of-focus tools remain reachable when devops focus is active
 *  - multi-step deploy + PR and build-failure + issue workflows execute via fixture backends
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const DEVOPS_FOCUS_PROFILES = {
  profiles: {
    devops: {
      description: 'DevOps and infrastructure — deploy, build, monitor, and manage Cloudflare Workers, GitHub repositories, and Neon databases',
      categories: ['code' as const],
      servers: ['cloudflare', 'cloudflare-builds', 'github', 'neon', 'tasks', 'linear'],
      boost: 0.6,
    },
    finance: {
      description: 'Billing, payments, and financial ecosystem tools',
      categories: ['ecosystem' as const],
      servers: ['stripe', 'tasks', 'ledger'],
      boost: 0.5,
    },
  },
};

const FIXTURE_CONFIGS: ServerConfig[] = [
  { id: 'cloudflare', name: 'Cloudflare', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.cloudflare' },
  { id: 'cloudflare-builds', name: 'Cloudflare Builds', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.cloudflare-builds' },
  { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.github' },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'tasks', name: 'ChittyAgent Tasks', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/tasks-mcp/dist/index.js'] },
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
    focusProfiles: DEVOPS_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('devops focus: search "deploy worker" ranks cloudflare/ tools first', async () => {
  const { aggregator } = buildAggregator('devops');

  const result = await aggregator.callTool('ch1tty/search', { query: 'deploy worker', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const cloudflareIdx = tools.findIndex((r) => r.tool.startsWith('cloudflare/'));
  const outIdx = tools.findIndex((r) => !['cloudflare/', 'cloudflare-builds/', 'github/', 'neon/', 'tasks/'].some((p) => r.tool.startsWith(p)));

  assert.ok(cloudflareIdx !== -1, 'cloudflare/ tools should appear in results');
  if (outIdx !== -1) {
    assert.ok(cloudflareIdx < outIdx, 'cloudflare/ tools should rank above out-of-focus tools');
  }
  assert.equal(parsed.focus, 'devops', 'search response should report active focus');
});

test('devops focus: search "list workers" includes cloudflare/list_workers', async () => {
  const { aggregator } = buildAggregator('devops');

  const result = await aggregator.callTool('ch1tty/search', { query: 'list workers deployed', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'cloudflare/list_workers'), 'cloudflare/list_workers must appear in results');
});

test('devops focus: search "list builds" includes cloudflare-builds/ tool', async () => {
  const { aggregator } = buildAggregator('devops');

  const result = await aggregator.callTool('ch1tty/search', { query: 'list builds build run status', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(
    toolNames.some((t) => t.startsWith('cloudflare-builds/')),
    'cloudflare-builds/ tools must appear in results',
  );
});

test('devops focus: out-of-focus tools (stripe) remain reachable via search', async () => {
  const { aggregator } = buildAggregator('devops');

  const result = await aggregator.callTool('ch1tty/search', { query: 'stripe payments balance', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('stripe/')), 'stripe/ tools must remain reachable when devops focus is active');
});

test('devops focus: no focus — cloudflare tools still accessible (lens not gate)', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/search', { query: 'deploy cloudflare worker', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('cloudflare/')), 'cloudflare/ tools must be reachable without any focus');
});

test('devops focus: cast "deploy a worker" resolves to cloudflare/deploy_worker', async () => {
  const { aggregator } = buildAggregator('devops');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'deploy a worker to production',
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
  assert.equal(cast.focus, 'devops', 'cast response should report active focus');
});

test('devops focus: cast "list build runs" resolves to cloudflare-builds/ tool', async () => {
  const { aggregator } = buildAggregator('devops');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list recent build runs for my worker',
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

test('devops focus: cast "get worker logs" resolves to cloudflare/get_worker_logs', async () => {
  const { aggregator } = buildAggregator('devops');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'get error logs from the gateway worker',
    confirm: true,
  });
  assert.equal(result.isError, undefined);

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(
    resolved.tool === 'cloudflare/get_worker_logs',
    `should resolve to cloudflare/get_worker_logs, got: ${resolved.tool}`,
  );
});

test('devops focus: status reports active focus as devops', async () => {
  const { aggregator } = buildAggregator('devops');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'devops', 'status must report devops as active focus');
});

test('devops focus: search with focus:none override disables boost', async () => {
  const { aggregator } = buildAggregator('devops');

  const result = await aggregator.callTool('ch1tty/search', { query: 'deploy', limit: 10, focus: 'none' });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  assert.ok(parsed.focus === undefined || parsed.focus === 'none' || parsed.focus === '', 'focus:none should disable active focus');
});

test('devops focus: multi-step — deploy worker then create PR', async () => {
  const { aggregator, fixture } = buildAggregator('devops');
  const sessionId = 'devops-scenario-001';
  fixture.clearCallLog();

  // Step 1: deploy the worker
  const deployResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare/deploy_worker',
    args: { script_name: 'ch1tty-gateway', script: 'export default { fetch() {} }', environment: 'staging' },
  }, sessionId);
  assert.equal(deployResult.isError, undefined, 'deploy_worker should succeed');
  const deployed = JSON.parse(deployResult.content[0].text as string) as { status: string };
  assert.equal(deployed.status, 'deployed', 'worker should be deployed');

  // Step 2: create a PR to track the change
  const prResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'github/create_pull_request',
    args: { owner: 'chittyos', repo: 'ch1tty', title: 'deploy: update ch1tty-gateway worker', head: 'feat/worker-update', base: 'main' },
  }, sessionId);
  assert.equal(prResult.isError, undefined, 'create_pull_request should succeed');
  const pr = JSON.parse(prResult.content[0].text as string) as { state: string };
  assert.equal(pr.state, 'open', 'PR should be open');

  const calls = fixture.getCallLog();
  const callKeys = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(callKeys.includes('cloudflare/deploy_worker'), 'deploy_worker must be in call log');
  assert.ok(callKeys.includes('github/create_pull_request'), 'create_pull_request must be in call log');
});

test('devops focus: multi-step — list builds and open issue for failure', async () => {
  const { aggregator, fixture } = buildAggregator('devops');
  const sessionId = 'devops-scenario-002';
  fixture.clearCallLog();

  // Step 1: list builds to find failures
  const buildsResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare-builds/workers_builds_list_builds',
    args: {},
  }, sessionId);
  assert.equal(buildsResult.isError, undefined, 'workers_builds_list_builds should succeed');
  const builds = JSON.parse(buildsResult.content[0].text as string) as Array<{ buildUUID: string; status: string }>;
  assert.ok(Array.isArray(builds), 'builds should be an array');
  const failed = builds.find((b) => b.status === 'failed');
  assert.ok(failed, 'should find a failed build in fixture data');

  // Step 2: create GitHub issue for the failure
  const issueResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'github/create_issue',
    args: {
      owner: 'chittyos',
      repo: 'ch1tty',
      title: `Build failure: ${failed.buildUUID}`,
      body: 'Auto-filed from devops workflow',
    },
  }, sessionId);
  assert.equal(issueResult.isError, undefined, 'create_issue should succeed');
  const issue = JSON.parse(issueResult.content[0].text as string) as { state: string };
  assert.equal(issue.state, 'open', 'issue should be open');

  const calls = fixture.getCallLog();
  const callKeys = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(callKeys.includes('cloudflare-builds/workers_builds_list_builds'), 'workers_builds_list_builds must be in call log');
  assert.ok(callKeys.includes('github/create_issue'), 'create_issue must be in call log');
});

test('devops focus: neon database tools are reachable and boosted under devops focus', async () => {
  const { aggregator } = buildAggregator('devops');

  const result = await aggregator.callTool('ch1tty/search', { query: 'neon database sql project', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('neon/')), 'neon/ tools must be reachable under devops focus');

  const neonTool = (parsed.tools ?? []).find((r) => r.tool.startsWith('neon/'));
  assert.ok(neonTool?.inFocus === true, 'neon/ tools should be marked inFocus under devops profile');
});
