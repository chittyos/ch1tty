/**
 * Tests for ch1tty/cast per-call timeout parameter (workstream CC).
 *
 * The `timeout` param lets callers override CH1TTY_REMOTE_TIMEOUT_MS for each
 * backend execution within a cast call — both normal single-tool execution and
 * each step in chain execution. The value is threaded through handleExecute →
 * Backend.callTool options bag, where FixtureBackend records it in CallRecord.
 *
 * FixtureBackend is a local (non-remote) backend so it doesn't enforce timeouts,
 * but it records timeoutMs from options — confirming the aggregator wires the
 * param correctly end-to-end.
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
    ],
    prompts: [],
  },
};

function makeAgg(opts: { focus?: string; catalog?: typeof CATALOG | Record<string, never> } = {}) {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '["p1","p2"]' }] },
      },
      {
        name: 'create_project',
        description: 'create a new neon database project',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        response: { content: [{ type: 'text', text: '{"id":"new-proj"}' }] },
      },
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

  const dlq = join(tmpdir(), `ch1tty-cast-timeout-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
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

// ── 1. timeout: N threaded to backend on normal cast execution ────────────────

test('cast timeout: N threaded to callTool options as timeoutMs on executed path', async () => {
  const { agg, backend } = makeAgg();

  await agg.callTool('ch1tty/cast', { intent: 'list neon projects', timeout: 7000 });

  const log = backend.getCallLog();
  assert.equal(log.length, 1, 'exactly one backend call');
  assert.equal(log[0].timeoutMs, 7000, 'timeoutMs must be 7000');

  await agg.shutdown();
});

// ── 2. timeout omitted → timeoutMs undefined ─────────────────────────────────

test('cast timeout omitted → timeoutMs undefined in callTool options', async () => {
  const { agg, backend } = makeAgg();

  await agg.callTool('ch1tty/cast', { intent: 'list neon projects' });

  const log = backend.getCallLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].timeoutMs, undefined, 'no timeout → timeoutMs must be undefined');

  await agg.shutdown();
});

// ── 3. timeout: 0 treated as absent ──────────────────────────────────────────

test('cast timeout: 0 treated as absent (timeoutMs undefined)', async () => {
  const { agg, backend } = makeAgg();

  await agg.callTool('ch1tty/cast', { intent: 'list neon projects', timeout: 0 });

  const log = backend.getCallLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].timeoutMs, undefined, 'timeout:0 must be treated as absent');

  await agg.shutdown();
});

// ── 4. timeout: -1 treated as absent ─────────────────────────────────────────

test('cast timeout: -1 treated as absent (timeoutMs undefined)', async () => {
  const { agg, backend } = makeAgg();

  await agg.callTool('ch1tty/cast', { intent: 'list neon projects', timeout: -1 });

  const log = backend.getCallLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].timeoutMs, undefined, 'timeout:-1 must be treated as absent');

  await agg.shutdown();
});

// ── 5. dryRun: true takes precedence — zero backend calls even with timeout ───

test('cast dryRun: true takes precedence — zero backend calls even with timeout set', async () => {
  const { agg, backend } = makeAgg();

  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', dryRun: true, timeout: 4000 });

  assert.equal(backend.getCallLog().length, 0, 'dryRun must make zero backend calls');
  const data = JSON.parse(result.content[0].text as string);
  assert.equal(data.cast, 'resolved', 'dryRun produces cast: resolved');

  await agg.shutdown();
});

// ── 6. chain: true + timeout → timeout applied to each step ──────────────────

test('cast chain: true + timeout: N → timeoutMs threaded to each chain step', async () => {
  const { agg, backend } = makeAgg({ focus: 'code' });

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    chain: true,
    timeout: 9000,
  });

  const data = JSON.parse(result.content[0].text as string);
  assert.equal(data.cast, 'chain_executed', 'must be chain_executed');
  assert.equal(data.steps.length, 2, 'two steps for neon-setup combo');

  const log = backend.getCallLog();
  assert.equal(log.length, 2, 'exactly two backend calls for 2-step chain');
  assert.equal(log[0].timeoutMs, 9000, 'step 0 must receive timeoutMs: 9000');
  assert.equal(log[1].timeoutMs, 9000, 'step 1 must receive timeoutMs: 9000');

  await agg.shutdown();
});

// ── 7. timeout: 1 (minimum positive) accepted and threaded ───────────────────

test('cast timeout: 1 (minimum positive) is accepted and threaded', async () => {
  const { agg, backend } = makeAgg();

  await agg.callTool('ch1tty/cast', { intent: 'list neon projects', timeout: 1 });

  const log = backend.getCallLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].timeoutMs, 1, 'timeout:1 must be accepted');

  await agg.shutdown();
});

// ── 8. timeout param visible in ch1tty/cast inputSchema ──────────────────────

test('timeout param visible in ch1tty/cast inputSchema', async () => {
  const { agg } = makeAgg();

  const { tools } = await agg.listAllTools();
  const cast = tools.find((t) => t.name === 'ch1tty/cast');
  assert.ok(cast, 'ch1tty/cast must exist');

  const props = (cast.inputSchema as { properties: Record<string, unknown> }).properties;
  assert.ok('timeout' in props, 'timeout must be in cast inputSchema properties');

  const timeoutProp = props['timeout'] as { type: string; description: string };
  assert.equal(timeoutProp.type, 'number', 'timeout must be a number type');
  assert.ok(timeoutProp.description.length > 0, 'timeout must have a description');

  await agg.shutdown();
});
