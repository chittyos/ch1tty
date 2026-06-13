/**
 * ch1tty/execute dryRun: true — resolves tool, returns what would be called without executing.
 *
 * dryRun returns: { status: "dry_run", server, tool, args } — no backend calls.
 * Errors for unknown tool/server still fire (resolution runs before dry-run short-circuit).
 *
 * Coverage:
 *  1. dryRun: true → status: "dry_run" with server, tool, args fields
 *  2. dryRun: true makes zero backend calls (verified via getCallLog())
 *  3. dryRun: false → normal execution (backend is called)
 *  4. dryRun omitted → normal execution (backend is called)
 *  5. args passed with dryRun → args echoed back in dry_run response
 *  6. unknown server with dryRun: true → isError (resolution fails before dry-run)
 *  7. dryRun: true → tool field is the bare tool name (without serverId prefix)
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
  return join(tmpdir(), `ch1tty-exec-dryrun-${label}-${Date.now()}.jsonl`);
}

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
    ],
  });

  const configs: ServerConfig[] = [{
    id: 'neon',
    name: 'Neon',
    type: 'remote',
    access: 'readwrite',
    category: 'data',
    endpoint: 'https://neon.tech/mcp',
    lazy: true,
  }];

  const dlq = dlqPath(`${Date.now()}`);
  const coordinator = new KeywordOnlyCoordinator({}, { enabled: false }, dlq);
  return {
    agg: new Aggregator(configs, {
      backendFactory: () => backend,
      embedEnabled: false,
      ledgerDlqPath: dlq,
      coordinator,
    }),
    backend,
  };
}

function parseText(result: { content?: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const item = result.content?.[0];
  if (!item || item.type !== 'text' || !item.text) throw new Error('No text content');
  return JSON.parse(item.text) as Record<string, unknown>;
}

test('execute dryRun: true → status:"dry_run" with server, tool, args fields', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', dryRun: true });
  assert.equal(result.isError, false);
  const body = parseText(result);
  assert.equal(body.status, 'dry_run');
  assert.equal(body.server, 'neon');
  assert.equal(body.tool, 'list_projects');
  assert.deepEqual(body.args, {});
});

test('execute dryRun: true makes zero backend calls', async () => {
  const { agg, backend } = makeAgg();
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', dryRun: true });
  assert.equal(backend.getCallLog().length, 0);
});

test('execute dryRun: false → normal execution (backend called)', async () => {
  const { agg, backend } = makeAgg();
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', dryRun: false });
  assert.equal(backend.getCallLog().length, 1);
  assert.equal(backend.getCallLog()[0].tool, 'list_projects');
});

test('execute dryRun omitted → normal execution (backend called)', async () => {
  const { agg, backend } = makeAgg();
  await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' });
  assert.equal(backend.getCallLog().length, 1);
});

test('execute dryRun: true → args echoed in dry_run response', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/execute', {
    tool: 'neon/list_projects',
    args: { region: 'us-east-1', limit: 10 },
    dryRun: true,
  });
  const body = parseText(result);
  assert.deepEqual(body.args, { region: 'us-east-1', limit: 10 });
});

test('execute dryRun: true with unknown server → isError (resolution fails first)', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/execute', { tool: 'unknown_server/some_tool', dryRun: true });
  assert.equal(result.isError, true);
});

test('execute dryRun: true → tool field is bare name without serverId prefix', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', dryRun: true });
  const body = parseText(result);
  assert.equal(body.tool, 'list_projects');
  assert.equal(body.server, 'neon');
});
