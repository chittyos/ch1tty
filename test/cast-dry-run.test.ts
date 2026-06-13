/**
 * cast `dryRun: true` — resolves intent, returns cast: resolved without executing.
 *
 * dryRun returns only: resolved tool + score + catalog combo (if any).
 * No execution, no full inputSchema, no alternatives, no related prompts/resources.
 * Lighter than confirm: true (cast: plan). Takes precedence over confirm when both set.
 *
 * Coverage:
 *  1. dryRun: true → cast: resolved with resolved.tool and resolved.score
 *  2. dryRun: true + focus + catalog match → catalogCombo present with name/chain/accomplishes
 *  3. dryRun: true without focus → catalogCombo absent
 *  4. dryRun: true does NOT call backend (no execution side-effect)
 *  5. dryRun: true takes precedence over confirm: true (returns cast: resolved not cast: plan)
 *  6. dryRun: true no_match → still returns cast: no_match (miss path unaffected)
 *  7. dryRun: true + focus → focus field included in response
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
  return join(tmpdir(), `ch1tty-dryrun-${label}-${Date.now()}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const CATALOG = {
  code: {
    description: 'Code focus',
    combos: [
      {
        name: 'neon-list-create',
        chain: ['neon/list_projects', 'neon/create_project'],
        accomplishes: 'List then create a Neon project',
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
      { name: 'list_projects', description: 'list neon projects', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: '["p1"]' }] } },
      { name: 'create_project', description: 'create a neon project', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: '{"id":"p2"}' }] } },
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
  return {
    agg: new Aggregator(configs, {
      backendFactory: () => backend,
      embedEnabled: false,
      ledgerDlqPath: dlq,
      suggestionsCatalog: opts.catalog ?? CATALOG,
      coordinator,
      ...(opts.focus ? { focus: opts.focus } : {}),
    }),
    backend,
  };
}

// ── 1. dryRun: true → cast: resolved with tool + score ───────────────────────

test('dryRun: true returns cast: resolved with resolved.tool and resolved.score', async () => {
  const { agg } = makeAgg();

  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', dryRun: true });
  const data = JSON.parse(result.content[0].text as string);

  assert.equal(data.cast, 'resolved');
  assert.ok(typeof data.resolved === 'object', 'resolved field present');
  assert.equal(data.resolved.tool, 'neon/list_projects');
  assert.ok(typeof data.resolved.score === 'number', 'resolved.score is a number');

  await agg.shutdown();
});

// ── 2. dryRun: true + focus + catalog match → catalogCombo present ────────────

test('dryRun: true + focus with catalog match includes catalogCombo', async () => {
  const { agg } = makeAgg({ focus: 'code' });

  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', dryRun: true });
  const data = JSON.parse(result.content[0].text as string);

  assert.equal(data.cast, 'resolved');
  assert.ok(typeof data.catalogCombo === 'object', 'catalogCombo present');
  assert.equal(data.catalogCombo.name, 'neon-list-create');
  assert.deepEqual(data.catalogCombo.chain, ['neon/list_projects', 'neon/create_project']);
  assert.equal(typeof data.catalogCombo.accomplishes, 'string');

  await agg.shutdown();
});

// ── 3. dryRun: true without focus → catalogCombo absent ───────────────────────

test('dryRun: true without focus returns cast: resolved with no catalogCombo', async () => {
  const { agg } = makeAgg();

  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', dryRun: true });
  const data = JSON.parse(result.content[0].text as string);

  assert.equal(data.cast, 'resolved');
  assert.ok(!('catalogCombo' in data), 'catalogCombo absent when no focus');

  await agg.shutdown();
});

// ── 4. dryRun: true does NOT call backend ─────────────────────────────────────

test('dryRun: true does not execute the resolved tool (no backend call)', async () => {
  const { agg, backend } = makeAgg();
  backend.clearCallLog();

  await agg.callTool('ch1tty/cast', { intent: 'list neon projects', dryRun: true });

  const calls = backend.getCallLog();
  assert.equal(calls.length, 0, 'no backend calls made on dryRun');

  await agg.shutdown();
});

// ── 5. dryRun: true takes precedence over confirm: true ───────────────────────

test('dryRun: true takes precedence over confirm: true — returns cast: resolved not cast: plan', async () => {
  const { agg } = makeAgg();

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list neon projects',
    dryRun: true,
    confirm: true,
  });
  const data = JSON.parse(result.content[0].text as string);

  assert.equal(data.cast, 'resolved', 'dryRun wins over confirm');
  assert.ok(!('inputSchema' in (data.resolved ?? {})), 'no inputSchema on dryRun response');

  await agg.shutdown();
});

// ── 6. dryRun: true on no-match → still returns cast: no_match ───────────────

test('dryRun: true with unresolvable intent still returns cast: no_match', async () => {
  const { agg } = makeAgg();

  const result = await agg.callTool('ch1tty/cast', {
    intent: 'xyzzy unfathomable nonsense qqq',
    dryRun: true,
  });
  const data = JSON.parse(result.content[0].text as string);

  assert.equal(data.cast, 'no_match', 'miss path unaffected by dryRun');

  await agg.shutdown();
});

// ── 7. dryRun: true + focus → focus field included in response ────────────────

test('dryRun: true + active focus includes focus field in cast: resolved', async () => {
  const { agg } = makeAgg({ focus: 'code' });

  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', dryRun: true });
  const data = JSON.parse(result.content[0].text as string);

  assert.equal(data.cast, 'resolved');
  assert.equal(data.focus, 'code', 'focus field present when active');

  await agg.shutdown();
});
