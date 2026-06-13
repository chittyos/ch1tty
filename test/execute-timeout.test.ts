/**
 * Tests for ch1tty/execute per-call timeout parameter (workstream BB).
 *
 * The `timeout` param lets callers override CH1TTY_REMOTE_TIMEOUT_MS for a single
 * execute call. It is threaded through the Backend.callTool options bag and recorded
 * in FixtureBackend's CallRecord so tests can verify the value was passed.
 *
 * FixtureBackend is a local backend so it doesn't enforce timeouts itself,
 * but it records timeoutMs from options — confirming the aggregator wires
 * the param correctly end-to-end.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg() {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '["p1","p2"]' }] },
      },
      {
        name: 'run_sql',
        description: 'execute sql',
        inputSchema: { type: 'object', properties: { project_id: { type: 'string' }, sql: { type: 'string' } } },
        response: { content: [{ type: 'text', text: '{"rows":[]}' }] },
      },
    ],
  });
  backend.defineServer('stripe', {
    tools: [
      {
        name: 'get_balance',
        description: 'get stripe balance',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{"available":[]}' }] },
      },
    ],
  });

  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'data', endpoint: 'https://neon.tech/mcp', lazy: true },
    { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'finance', endpoint: 'https://stripe.com/mcp', lazy: true },
  ];

  const dlq = join(tmpdir(), `ch1tty-exec-timeout-${Date.now()}.jsonl`);
  const coordinator = new KeywordOnlyCoordinator({}, { enabled: false }, dlq);
  const agg = new Aggregator(configs, { backendFactory: () => backend, embedEnabled: false, ledgerDlqPath: dlq, coordinator });
  return { agg, backend };
}

function parseText(result: { content?: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const item = result.content?.[0];
  if (!item || item.type !== 'text' || !item.text) throw new Error('No text content');
  return JSON.parse(item.text) as Record<string, unknown>;
}

test('execute timeout: N is threaded to callTool options as timeoutMs', async () => {
  const { agg, backend } = makeAgg();
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', timeout: 5000 });
  const log = backend.getCallLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].timeoutMs, 5000);
});

test('execute timeout omitted → timeoutMs undefined in callTool options', async () => {
  const { agg, backend } = makeAgg();
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' });
  const log = backend.getCallLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].timeoutMs, undefined);
});

test('execute timeout: 0 treated as absent (timeoutMs undefined)', async () => {
  const { agg, backend } = makeAgg();
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', timeout: 0 });
  const log = backend.getCallLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].timeoutMs, undefined);
});

test('execute timeout: -1 treated as absent (timeoutMs undefined)', async () => {
  const { agg, backend } = makeAgg();
  await agg.callTool('ch1tty/execute', { tool: 'stripe/get_balance', timeout: -1 });
  const log = backend.getCallLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].timeoutMs, undefined);
});

test('execute dryRun: true takes precedence — zero backend calls even with timeout', async () => {
  const { agg, backend } = makeAgg();
  const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', dryRun: true, timeout: 3000 });
  assert.equal(backend.getCallLog().length, 0, 'dryRun must make zero backend calls');
  const body = parseText(result);
  assert.equal(body.status, 'dry_run');
});

test('execute timeout with args: both threaded correctly', async () => {
  const { agg, backend } = makeAgg();
  const toolArgs = { project_id: 'proj-abc', sql: 'SELECT 1' };
  await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql', args: toolArgs, timeout: 8000 });
  const log = backend.getCallLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].timeoutMs, 8000);
  assert.deepEqual(log[0].args, toolArgs);
});

test('execute timeout: 1 (minimum positive) is accepted and threaded', async () => {
  const { agg, backend } = makeAgg();
  await agg.callTool('ch1tty/execute', { tool: 'stripe/get_balance', timeout: 1 });
  const log = backend.getCallLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].timeoutMs, 1);
});

test('execute timeout param visible in ch1tty/execute inputSchema', async () => {
  const { agg } = makeAgg();
  const { tools } = await agg.listAllTools();
  const execute = tools.find((t) => t.name === 'ch1tty/execute');
  assert.ok(execute, 'ch1tty/execute must exist');
  const props = (execute.inputSchema as { properties: Record<string, unknown> }).properties;
  assert.ok('timeout' in props, 'timeout must be in execute inputSchema properties');
  const timeoutProp = props['timeout'] as { type: string; description: string };
  assert.equal(timeoutProp.type, 'number');
  assert.ok(timeoutProp.description.length > 0);
});
