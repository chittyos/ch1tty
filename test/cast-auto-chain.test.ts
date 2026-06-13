/**
 * cast `chain: true` auto-chain execution.
 *
 * When `chain: true` is passed and the resolved tool is the first step of a
 * curated catalog combo in the active focus profile, cast auto-executes ALL
 * chain steps sequentially and returns `cast: chain_executed` with per-step
 * results.
 *
 * Coverage:
 *  1. chain: true + multi-step combo → cast: chain_executed with full steps array
 *  2. steps array carries correct tool names and ok: true for each step
 *  3. chain: true + single-step combo (chain.length === 1) → cast: executed (unchanged)
 *  4. chain: false (default) → cast: executed (unchanged)
 *  5. chain: true without focus → cast: executed (no catalogCombo match)
 *  6. failed step → ok: false with error field; chain continues through remaining steps
 *  7. chain_executed records affinity for all executed steps
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-autochain-${label}-${Date.now()}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const CATALOG = {
  code: {
    description: 'Code focus',
    combos: [
      {
        name: 'neon-setup',
        chain: ['neon/list_projects', 'neon/create_project'],
        accomplishes: 'List existing Neon projects then create a new one',
        verified: true,
      },
      {
        name: 'neon-3step',
        chain: ['neon/list_projects', 'neon/create_project', 'neon/delete_project'],
        accomplishes: 'Three-step neon workflow for testing',
        verified: true,
      },
      {
        name: 'single-step',
        chain: ['neon/create_project'],
        accomplishes: 'Just create a project',
        verified: true,
      },
    ],
    prompts: [],
  },
};

const TOOL_LIST = {
  name: 'list_projects',
  description: 'list neon projects in the database',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '["proj-1","proj-2"]' }] },
} as const;

const TOOL_CREATE = {
  name: 'create_project',
  description: 'create a new neon project database instance',
  inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
  response: { content: [{ type: 'text', text: '{"id":"proj-new"}' }] },
} as const;

const TOOL_DELETE = {
  name: 'delete_project',
  description: 'delete a neon project by id',
  inputSchema: { type: 'object', properties: { project_id: { type: 'string' } } },
  response: { content: [{ type: 'text', text: 'deleted' }] },
} as const;

const TOOL_CREATE_ERROR = {
  name: 'create_project',
  description: 'create a new neon project database instance',
  inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
  response: 'error' as const,
};

function makeAgg(opts: {
  focus?: string;
  catalog?: typeof CATALOG | Record<string, never>;
  createToolError?: boolean;
} = {}) {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      TOOL_LIST,
      opts.createToolError ? TOOL_CREATE_ERROR : TOOL_CREATE,
      TOOL_DELETE,
    ],
  });

  const configs: ServerConfig[] = [{
    id: 'neon',
    name: 'Neon',
    type: 'remote',
    access: 'readwrite',
    category: 'code',
    endpoint: 'https://neon.tech/mcp',
    lazy: true,
  }];

  const dlq = dlqPath(`opts-${Date.now()}`);
  const coordinator = new KeywordOnlyCoordinator({}, { enabled: false }, dlq);
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq,
    suggestionsCatalog: opts.catalog ?? CATALOG,
    coordinator,
    ...(opts.focus ? { focus: opts.focus } : {}),
  });
  return { agg, backend };
}

// ── 1. chain: true + multi-step combo → cast: chain_executed ─────────────────

test('chain: true with multi-step catalog combo returns cast: chain_executed', async () => {
  const { agg } = makeAgg({ focus: 'code' });

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
  });

  assert.equal(result.isError, undefined, 'no isError');
  const data = JSON.parse(result.content[0].text as string);
  assert.equal(data.cast, 'chain_executed', 'cast mode is chain_executed');
  assert.ok(Array.isArray(data.steps), 'steps is an array');
  assert.equal(data.steps.length, 2, 'two steps for 2-element chain');

  await agg.shutdown();
});

// ── 2. steps carry correct tool names and ok: true ───────────────────────────

test('chain_executed steps array has correct tool names and ok: true', async () => {
  const { agg } = makeAgg({ focus: 'code' });

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
  });

  const data = JSON.parse(result.content[0].text as string);
  const steps = data.steps as Array<{ step: number; tool: string; ok: boolean }>;

  assert.equal(steps[0].step, 0, 'first step index 0');
  assert.equal(steps[0].tool, 'neon/list_projects', 'first step is list_projects');
  assert.equal(steps[0].ok, true, 'first step ok');

  assert.equal(steps[1].step, 1, 'second step index 1');
  assert.equal(steps[1].tool, 'neon/create_project', 'second step is create_project');
  assert.equal(steps[1].ok, true, 'second step ok');

  assert.ok(data.catalog, 'catalog field present');
  assert.equal(data.catalog.name, 'neon-setup', 'catalog name is neon-setup');
  assert.deepEqual(data.catalog.chain, ['neon/list_projects', 'neon/create_project']);

  await agg.shutdown();
});

// ── 3. chain: true + single-step combo → cast: executed (unchanged) ──────────

test('chain: true with single-step combo falls through to cast: executed', async () => {
  const catalogSingleOnly = {
    code: {
      description: 'Code focus',
      combos: [CATALOG.code.combos[2]],
      prompts: [],
    },
  };
  const { agg } = makeAgg({ focus: 'code', catalog: catalogSingleOnly });

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'create neon project',
    chain: true,
  });

  const data = JSON.parse(result.content[0].text as string);
  assert.equal(data.cast, 'executed', 'single-step combo → executed, not chain_executed');

  await agg.shutdown();
});

// ── 4. chain: false (default) → cast: executed ───────────────────────────────

test('chain: false (default) with multi-step combo returns cast: executed', async () => {
  const { agg } = makeAgg({ focus: 'code' });

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
  });

  const data = JSON.parse(result.content[0].text as string);
  assert.equal(data.cast, 'executed', 'chain omitted → executed');
  assert.ok(!('steps' in data), 'no steps array when chain not enabled');

  await agg.shutdown();
});

// ── 5. chain: true without focus → cast: executed ────────────────────────────

test('chain: true without focus returns cast: executed (no catalog match)', async () => {
  const { agg } = makeAgg();

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
  });

  const data = JSON.parse(result.content[0].text as string);
  assert.equal(data.cast, 'executed', 'no focus → no catalogCombo → cast: executed');
  assert.ok(!('steps' in data), 'no steps array without focus');

  await agg.shutdown();
});

// ── 6. failed step → ok: false, chain continues ──────────────────────────────

test('chain_executed: failed step recorded as ok: false; chain continues', async () => {
  const { agg } = makeAgg({ focus: 'code', createToolError: true });

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
  });

  assert.equal(result.isError, undefined, 'chain_executed itself is not an error');
  const data = JSON.parse(result.content[0].text as string);
  assert.equal(data.cast, 'chain_executed', 'still chain_executed');
  assert.equal(data.steps.length, 2, 'both steps present');

  const step0 = data.steps[0];
  const step1 = data.steps[1];
  assert.equal(step0.tool, 'neon/list_projects');
  assert.equal(step0.ok, true, 'step 0 succeeds');
  assert.equal(step1.tool, 'neon/create_project');
  assert.equal(step1.ok, false, 'step 1 fails');
  assert.ok(typeof step1.error === 'string' && step1.error.length > 0, 'error field present on failed step');

  await agg.shutdown();
});

// ── 7. chain_executed records affinity for executed steps ────────────────────

test('chain_executed records server affinity for all steps', async () => {
  const { agg } = makeAgg({ focus: 'code' });
  const sessionId = 'auto-chain-affinity';
  await agg.coordinator.onSessionStart(sessionId, 'stdio');

  await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
  }, sessionId);

  const affinity = agg.coordinator.getServerAffinity(sessionId);
  assert.ok(affinity.has('neon'), 'neon affinity recorded via chain_executed');
  assert.ok(affinity.get('neon')! > 0, 'affinity is a positive epoch ms value');

  await agg.shutdown();
});
