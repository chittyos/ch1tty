/**
 * cast `chain: true` — step-output forwarding via previousResult.
 *
 * When chain: true is active and a step succeeds, its text output is extracted
 * and forwarded as `previousResult` in the args of the immediately following
 * step. This enables data chaining: step N+1 receives what step N produced.
 *
 * Coverage:
 *  1. step 1 receives previousResult containing step 0's text output
 *  2. step 0 still receives the caller's toolArgs (not previousResult)
 *  3. three-step chain: step 2 receives previousResult from step 1
 *  4. failed step clears previousResult — next step receives {}
 *  5. step with no text content → next step receives {} (previousResult null)
 *  6. chain: false → no previousResult forwarding (steps never receive it)
 *  7. previousResult value equals the full text from prior step content
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
  return join(tmpdir(), `ch1tty-stepfwd-${label}-${Date.now()}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

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
  description: 'create a new neon project',
  inputSchema: { type: 'object', properties: {} },
  response: 'error' as const,
};

const TOOL_IMAGE = {
  name: 'list_projects',
  description: 'list neon projects returning an image',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'image', data: 'base64abc', mimeType: 'image/png' }] },
} as const;

const CATALOG_2STEP = {
  code: {
    description: 'Code focus',
    combos: [{
      name: 'neon-setup',
      chain: ['neon/list_projects', 'neon/create_project'],
      accomplishes: 'List then create',
      verified: true,
    }],
    prompts: [],
  },
};

const CATALOG_3STEP = {
  code: {
    description: 'Code focus',
    combos: [{
      name: 'neon-3step',
      chain: ['neon/list_projects', 'neon/create_project', 'neon/delete_project'],
      accomplishes: 'List, create, delete',
      verified: true,
    }],
    prompts: [],
  },
};

const CATALOG_2STEP_NOFOCUS = {
  ops: {
    description: 'Ops focus',
    combos: [{
      name: 'neon-setup',
      chain: ['neon/list_projects', 'neon/create_project'],
      accomplishes: 'List then create',
      verified: true,
    }],
    prompts: [],
  },
};

const SERVER_CONFIG: ServerConfig[] = [{
  id: 'neon',
  name: 'Neon',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.tech/mcp',
  lazy: true,
}];

function makeAgg(opts: {
  focus?: string;
  catalog?: Record<string, unknown>;
  createToolError?: boolean;
  listReturnsImage?: boolean;
} = {}) {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      opts.listReturnsImage ? TOOL_IMAGE : TOOL_LIST,
      opts.createToolError ? TOOL_CREATE_ERROR : TOOL_CREATE,
      TOOL_DELETE,
    ],
  });

  const dlq = dlqPath(`${Date.now()}`);
  const coordinator = new KeywordOnlyCoordinator({}, { enabled: false }, dlq);
  const agg = new Aggregator(SERVER_CONFIG, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq,
    suggestionsCatalog: (opts.catalog ?? CATALOG_2STEP) as never,
    coordinator,
    ...(opts.focus ? { focus: opts.focus } : {}),
  });
  return { agg, backend };
}

// ── 1. step 1 receives previousResult from step 0's text output ───────────────

test('chain step-forward: step 1 receives previousResult from step 0 output', async () => {
  const { agg, backend } = makeAgg({ focus: 'code' });

  await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
  });

  const calls = backend.getCallLog();
  assert.equal(calls.length, 2, 'two backend calls');
  const step1Call = calls[1];
  assert.equal(step1Call.tool, 'create_project', 'second call is create_project');
  assert.ok('previousResult' in step1Call.args, 'step 1 args contain previousResult');
  assert.equal(step1Call.args.previousResult, '["proj-1","proj-2"]', 'previousResult is step 0 text output');

  await agg.shutdown();
});

// ── 2. step 0 receives toolArgs, not previousResult ───────────────────────────

test('chain step-forward: step 0 receives toolArgs not previousResult', async () => {
  const { agg, backend } = makeAgg({ focus: 'code' });

  await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    args: { limit: 5 },
    chain: true,
  });

  const calls = backend.getCallLog();
  const step0Call = calls[0];
  assert.equal(step0Call.tool, 'list_projects', 'first call is list_projects');
  assert.ok(!('previousResult' in step0Call.args), 'step 0 does not receive previousResult');
  assert.equal((step0Call.args as { limit?: number }).limit, 5, 'step 0 receives original toolArgs');

  await agg.shutdown();
});

// ── 3. three-step chain: step 2 receives previousResult from step 1 ──────────

test('chain step-forward: three-step chain — step 2 gets previousResult from step 1', async () => {
  const { agg, backend } = makeAgg({ focus: 'code', catalog: CATALOG_3STEP });

  await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
  });

  const calls = backend.getCallLog();
  assert.equal(calls.length, 3, 'three backend calls');

  const step2Call = calls[2];
  assert.equal(step2Call.tool, 'delete_project', 'third call is delete_project');
  assert.ok('previousResult' in step2Call.args, 'step 2 receives previousResult');
  assert.equal(step2Call.args.previousResult, '{"id":"proj-new"}', 'step 2 previousResult is step 1 output');

  await agg.shutdown();
});

// ── 4. failed step clears previousResult — next step receives {} ──────────────

test('chain step-forward: step after failed step receives empty args', async () => {
  const { agg, backend } = makeAgg({ focus: 'code', catalog: CATALOG_3STEP, createToolError: true });

  await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
  });

  const calls = backend.getCallLog();
  // step 0 (list) succeeds, step 1 (create) fails, step 2 (delete) proceeds without previousResult
  const step2Call = calls.find((c) => c.tool === 'delete_project');
  assert.ok(step2Call, 'delete_project was still called after step 1 failure');
  assert.ok(!('previousResult' in step2Call.args), 'step after failed step has no previousResult');

  await agg.shutdown();
});

// ── 5. non-text step content → next step receives {} ─────────────────────────

test('chain step-forward: non-text step content → next step has no previousResult', async () => {
  const { agg, backend } = makeAgg({ focus: 'code', listReturnsImage: true });

  await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
  });

  const calls = backend.getCallLog();
  assert.equal(calls.length, 2, 'two backend calls');
  const step1Call = calls[1];
  assert.ok(!('previousResult' in step1Call.args), 'no previousResult when step 0 returns non-text content');

  await agg.shutdown();
});

// ── 6. chain: false → no previousResult forwarding ───────────────────────────

test('chain step-forward: chain: false → backend calls have no previousResult', async () => {
  const { agg, backend } = makeAgg({ focus: 'code' });

  await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: false,
  });

  const calls = backend.getCallLog();
  assert.equal(calls.length, 1, 'only one call when chain is false');
  const step0Call = calls[0];
  assert.ok(!('previousResult' in step0Call.args), 'no previousResult when chain is false');

  await agg.shutdown();
});

// ── 7. previousResult value equals full text from prior step ─────────────────

test('chain step-forward: previousResult equals the exact text from prior step content', async () => {
  const { agg, backend } = makeAgg({ focus: 'code' });

  await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
  });

  const calls = backend.getCallLog();
  const step0Call = calls[0];
  const step1Call = calls[1];

  // step 0's fixture response text
  assert.equal(step0Call.tool, 'list_projects');
  // step 1's previousResult must equal TOOL_LIST.response.content[0].text exactly
  assert.equal(step1Call.args.previousResult, TOOL_LIST.response.content[0].text);

  await agg.shutdown();
});
