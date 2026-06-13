/**
 * cast `chain: true` summary field on chain_executed responses.
 *
 * When chain auto-execution produces text output, cast: chain_executed includes
 * a top-level `summary` string that concatenates all successful step text outputs
 * (joined by '\n\n'), giving LLM clients a single string without needing to
 * iterate the steps array.
 *
 * Coverage:
 *  1. summary field present when steps produce text
 *  2. summary joins all step text outputs with '\n\n'
 *  3. summary absent when no steps produce text (non-text content only)
 *  4. single-step output matches summary exactly
 *  5. failed step does not contribute to summary
 *  6. 3-step chain: summary joins all 3 outputs in order
 *  7. summary absent when ALL steps produce non-text content
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
  return join(tmpdir(), `ch1tty-chainsummary-${label}-${Date.now()}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const STEP_A_TEXT = '["proj-1","proj-2"]';
const STEP_B_TEXT = '{"id":"proj-new"}';
const STEP_C_TEXT = 'deleted';

const CATALOG = {
  code: {
    description: 'Code focus',
    combos: [
      {
        name: 'neon-2step',
        chain: ['neon/list_projects', 'neon/create_project'],
        accomplishes: 'List then create a Neon project',
        verified: true,
      },
      {
        name: 'neon-3step',
        chain: ['neon/list_projects', 'neon/create_project', 'neon/delete_project'],
        accomplishes: 'Three-step neon workflow',
        verified: true,
      },
    ],
    prompts: [],
  },
};

function makeAgg(opts: {
  focus?: string;
  catalog?: typeof CATALOG | Record<string, never>;
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; response: { content: Array<{ type: string; text?: string; data?: string }> } | 'error' }>;
} = {}) {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: opts.tools ?? [
      { name: 'list_projects', description: 'list neon projects', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: STEP_A_TEXT }] } },
      { name: 'create_project', description: 'create a neon project', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: STEP_B_TEXT }] } },
      { name: 'delete_project', description: 'delete a neon project', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: STEP_C_TEXT }] } },
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

  const dlq = dlqPath(`${Date.now()}`);
  const coordinator = new KeywordOnlyCoordinator({}, { enabled: false }, dlq);
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq,
    suggestionsCatalog: opts.catalog ?? CATALOG,
    coordinator,
    ...(opts.focus ? { focus: opts.focus } : {}),
  });
}

// ── 1. summary field present when steps produce text ─────────────────────────

test('chain_executed includes summary field when steps produce text', async () => {
  const agg = makeAgg({ focus: 'code' });

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
  });

  const data = JSON.parse(result.content[0].text as string);
  assert.equal(data.cast, 'chain_executed');
  assert.ok('summary' in data, 'summary field present');
  assert.equal(typeof data.summary, 'string', 'summary is a string');
  assert.ok(data.summary.length > 0, 'summary is non-empty');

  await agg.shutdown();
});

// ── 2. summary joins all step text outputs with '\n\n' ───────────────────────

test('chain_executed summary joins step outputs with double newline', async () => {
  const agg = makeAgg({ focus: 'code' });

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
  });

  const data = JSON.parse(result.content[0].text as string);
  const expected = `${STEP_A_TEXT}\n\n${STEP_B_TEXT}`;
  assert.equal(data.summary, expected, 'summary joins step A and step B with \\n\\n');

  await agg.shutdown();
});

// ── 3. summary absent when steps produce no text (non-text content) ──────────

test('chain_executed summary absent when steps produce only non-text content', async () => {
  const imageResponse = { content: [{ type: 'image', data: 'base64data' }] };
  const agg = makeAgg({
    focus: 'code',
    tools: [
      { name: 'list_projects', description: 'list neon projects', inputSchema: { type: 'object', properties: {} }, response: imageResponse },
      { name: 'create_project', description: 'create a neon project', inputSchema: { type: 'object', properties: {} }, response: imageResponse },
      { name: 'delete_project', description: 'delete a neon project', inputSchema: { type: 'object', properties: {} }, response: imageResponse },
    ],
  });

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
  });

  const data = JSON.parse(result.content[0].text as string);
  assert.equal(data.cast, 'chain_executed');
  assert.ok(!('summary' in data), 'summary field absent when no text content');

  await agg.shutdown();
});

// ── 4. single-step output: summary equals that step's text ───────────────────

test('chain_executed summary equals single successful step text', async () => {
  const singleStepCatalog = {
    code: {
      description: 'Code focus',
      combos: [{
        name: 'neon-2step',
        chain: ['neon/list_projects', 'neon/create_project'],
        accomplishes: 'Only list — create returns empty',
        verified: true,
      }],
      prompts: [],
    },
  };
  // Only step 0 produces text; step 1 returns non-text
  const agg = makeAgg({
    focus: 'code',
    catalog: singleStepCatalog,
    tools: [
      { name: 'list_projects', description: 'list neon projects', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: 'only-step' }] } },
      { name: 'create_project', description: 'create a neon project', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'image', data: 'x' }] } },
      { name: 'delete_project', description: 'delete a neon project', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: 'x' }] } },
    ],
  });

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
  });

  const data = JSON.parse(result.content[0].text as string);
  assert.equal(data.cast, 'chain_executed');
  assert.equal(data.summary, 'only-step', 'summary equals the one step that produced text');

  await agg.shutdown();
});

// ── 5. failed step does not contribute to summary ────────────────────────────

test('chain_executed: failed step does not appear in summary', async () => {
  // step 0 succeeds (text), step 1 fails (error)
  const agg = makeAgg({
    focus: 'code',
    tools: [
      { name: 'list_projects', description: 'list neon projects', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: 'step0-ok' }] } },
      { name: 'create_project', description: 'create a neon project', inputSchema: { type: 'object', properties: {} }, response: 'error' },
      { name: 'delete_project', description: 'delete a neon project', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: 'step2-ok' }] } },
    ],
  });

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
  });

  const data = JSON.parse(result.content[0].text as string);
  assert.equal(data.cast, 'chain_executed');
  // chain is 2-step (neon-2step), so only step 0 runs, step 1 fails
  assert.equal(data.summary, 'step0-ok', 'summary contains only the successful step 0 output');
  assert.ok(!data.summary.includes('step2-ok'), 'failed step text not in summary');

  await agg.shutdown();
});

// ── 6. 3-step chain: summary joins all 3 outputs in order ────────────────────

test('3-step chain_executed summary joins all three step outputs in order', async () => {
  const catalog3step = {
    code: {
      description: 'Code focus',
      combos: [{
        name: 'neon-3step',
        chain: ['neon/list_projects', 'neon/create_project', 'neon/delete_project'],
        accomplishes: 'Three-step neon workflow',
        verified: true,
      }],
      prompts: [],
    },
  };
  const agg = makeAgg({ focus: 'code', catalog: catalog3step });

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
  });

  const data = JSON.parse(result.content[0].text as string);
  assert.equal(data.cast, 'chain_executed');
  assert.equal(data.steps.length, 3, '3 steps executed');
  const expected = `${STEP_A_TEXT}\n\n${STEP_B_TEXT}\n\n${STEP_C_TEXT}`;
  assert.equal(data.summary, expected, 'summary joins all 3 step outputs in order');

  await agg.shutdown();
});

// ── 7. all steps non-text: summary absent ────────────────────────────────────

test('chain_executed summary absent when ALL steps return non-text content', async () => {
  const blobResponse = { content: [{ type: 'resource', data: 'binary' }] };
  const agg = makeAgg({
    focus: 'code',
    tools: [
      { name: 'list_projects', description: 'list neon projects', inputSchema: { type: 'object', properties: {} }, response: blobResponse },
      { name: 'create_project', description: 'create a neon project', inputSchema: { type: 'object', properties: {} }, response: blobResponse },
      { name: 'delete_project', description: 'delete a neon project', inputSchema: { type: 'object', properties: {} }, response: blobResponse },
    ],
  });

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
  });

  const data = JSON.parse(result.content[0].text as string);
  assert.equal(data.cast, 'chain_executed');
  assert.ok(!('summary' in data), 'summary absent when all steps produce non-text content');

  await agg.shutdown();
});
