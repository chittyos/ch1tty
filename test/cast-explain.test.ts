/**
 * cast `explain: true` — adds an explanation field to all cast responses.
 *
 * The explanation includes: method (brain|keyword), focus metadata when active,
 * topCandidates (up to 5 scored tools), and a human-readable rationale string.
 * Works alongside all other modes (executed, plan, dryRun, chain_executed,
 * discovered, no_match). Does not affect execution behavior.
 *
 * Coverage:
 *  1. explain: true → explanation field present on cast: executed
 *  2. explanation.method === 'keyword' for keyword-only coordinator
 *  3. explanation.topCandidates contains winner with correct tool name and score
 *  4. explain: false (omitted) → no explanation field on cast: executed
 *  5. explain: true + focus active → explanation includes focus, focusBoost, winnerInFocus
 *  6. explain: true + confirm: true → explanation present on cast: plan
 *  7. explain: true + dryRun: true → explanation present on cast: resolved
 *  8. explain: true + no_match → explanation on cast: no_match (topCandidates: [])
 *  9. explanation.rationale is a non-empty string mentioning the resolved tool
 * 10. winnerInFocus: false when winner's category is outside the active focus
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
  return join(tmpdir(), `ch1tty-explain-${label}-${Date.now()}.jsonl`);
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
      { name: 'list_projects', description: 'list neon database projects sql postgres', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: '["p1"]' }] } },
      { name: 'create_project', description: 'create a neon project database', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: '{"id":"p2"}' }] } },
    ],
  });

  const configs: ServerConfig[] = [{
    id: 'neon',
    name: 'Neon',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://neon.tech/mcp',
    lazy: true,
  }];

  const dlq = dlqPath(`agg-${Date.now()}`);
  const coordinator = new KeywordOnlyCoordinator({}, { enabled: false }, dlq);

  const focusProfiles = opts.focus ? {
    profiles: {
      [opts.focus]: {
        categories: ['ecosystem' as const],
        servers: [] as string[],
        boost: 0.5,
      },
    },
  } : { profiles: {} };

  return {
    agg: new Aggregator(configs, {
      backendFactory: () => backend,
      embedEnabled: false,
      ledgerDlqPath: dlq,
      suggestionsCatalog: opts.catalog ?? {},
      coordinator,
      ...(opts.focus ? { focus: opts.focus, focusProfiles } : {}),
    }),
    backend,
  };
}

function parseCast(result: Awaited<ReturnType<Aggregator['callTool']>>) {
  const text = (result.content[0] as { type: string; text: string }).text;
  return JSON.parse(text) as Record<string, unknown>;
}

test('explain: true → explanation field present on cast: executed', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', explain: true });
  const body = parseCast(result);
  assert.strictEqual(body.cast, 'executed');
  assert.ok(body.explanation, 'explanation field should be present');
  await agg.shutdown();
});

test('explanation.method is keyword for keyword-only coordinator', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', explain: true });
  const body = parseCast(result);
  const exp = body.explanation as Record<string, unknown>;
  assert.strictEqual(exp.method, 'keyword');
  await agg.shutdown();
});

test('explanation.topCandidates contains winner with correct name', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', explain: true });
  const body = parseCast(result);
  const exp = body.explanation as Record<string, unknown>;
  const candidates = exp.topCandidates as Array<{ tool: string; score: number }>;
  assert.ok(Array.isArray(candidates), 'topCandidates should be an array');
  assert.ok(candidates.length > 0, 'topCandidates should have entries');
  assert.ok(candidates[0].tool.includes('list_projects'), 'winner should be neon/list_projects');
  assert.ok(typeof candidates[0].score === 'number', 'score should be a number');
  await agg.shutdown();
});

test('explain: false (omitted) → no explanation field on cast: executed', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects' });
  const body = parseCast(result);
  assert.strictEqual(body.cast, 'executed');
  assert.ok(!('explanation' in body), 'explanation should be absent when explain not set');
  await agg.shutdown();
});

test('explain: true + focus active → explanation has focus, focusBoost, winnerInFocus', async () => {
  const { agg } = makeAgg({ focus: 'code' });
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', explain: true });
  const body = parseCast(result);
  const exp = body.explanation as Record<string, unknown>;
  assert.strictEqual(exp.focus, 'code');
  assert.ok(typeof exp.focusBoost === 'number', 'focusBoost should be a number');
  assert.ok(typeof exp.winnerInFocus === 'boolean', 'winnerInFocus should be a boolean');
  await agg.shutdown();
});

test('explain: true + confirm: true → explanation on cast: plan', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', confirm: true, explain: true });
  const body = parseCast(result);
  assert.strictEqual(body.cast, 'plan');
  assert.ok(body.explanation, 'explanation field should be present on cast: plan');
  const exp = body.explanation as Record<string, unknown>;
  assert.strictEqual(exp.method, 'keyword');
  await agg.shutdown();
});

test('explain: true + dryRun: true → explanation on cast: resolved', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', dryRun: true, explain: true });
  const body = parseCast(result);
  assert.strictEqual(body.cast, 'resolved');
  assert.ok(body.explanation, 'explanation field should be present on cast: resolved');
  const exp = body.explanation as Record<string, unknown>;
  assert.strictEqual(exp.method, 'keyword');
  await agg.shutdown();
});

test('explain: true + no_match → explanation on cast: no_match with empty topCandidates', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'zzz unmatched xylophone banana', explain: true });
  const body = parseCast(result);
  assert.strictEqual(body.cast, 'no_match');
  assert.ok(body.explanation, 'explanation field should be present on no_match');
  const exp = body.explanation as Record<string, unknown>;
  const candidates = exp.topCandidates as unknown[];
  assert.deepStrictEqual(candidates, [], 'topCandidates should be empty on no_match');
  await agg.shutdown();
});

test('explanation.rationale is a non-empty string mentioning the resolved tool', async () => {
  const { agg } = makeAgg();
  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', explain: true });
  const body = parseCast(result);
  const exp = body.explanation as Record<string, unknown>;
  assert.ok(typeof exp.rationale === 'string', 'rationale should be a string');
  assert.ok((exp.rationale as string).length > 0, 'rationale should be non-empty');
  assert.ok((exp.rationale as string).includes('neon'), 'rationale should mention resolved tool');
  await agg.shutdown();
});

test('winnerInFocus: false when winner category is outside the active focus', async () => {
  // Focus on 'design' category (desktop tools). neon is 'ecosystem' → out-of-focus.
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      { name: 'list_projects', description: 'list neon database projects', inputSchema: { type: 'object', properties: {} }, response: { content: [{ type: 'text', text: '[]' }] } },
    ],
  });
  const configs: ServerConfig[] = [{
    id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite',
    category: 'ecosystem', endpoint: 'https://neon.tech/mcp', lazy: true,
  }];
  const dlq = dlqPath(`out-of-focus-${Date.now()}`);
  const coordinator = new KeywordOnlyCoordinator({}, { enabled: false }, dlq);
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq,
    suggestionsCatalog: {},
    coordinator,
    focus: 'design',
    focusProfiles: { profiles: { design: { categories: ['desktop' as const], servers: [], boost: 0.5 } } },
  });

  const result = await agg.callTool('ch1tty/cast', { intent: 'list neon database projects', explain: true });
  const body = parseCast(result);
  const exp = body.explanation as Record<string, unknown>;
  assert.strictEqual(exp.winnerInFocus, false, 'winner should be out-of-focus (ecosystem ≠ desktop)');
  await agg.shutdown();
});
