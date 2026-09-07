/**
 * Workstream P — legal focus profile scenarios.
 *
 * Validates the legal focus profile with dispute + resolve as wired backends:
 *  - dispute/ and resolve/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves legal intents to dispute/ and resolve/ tools
 *  - out-of-focus tools remain reachable when legal focus is active
 *  - multi-step dispute-to-resolution workflows execute via fixture backends
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const LEGAL_FOCUS_PROFILES = {
  profiles: {
    legal: {
      description: 'Legal operations — dispute management, resolution workflows, evidence retrieval, and audit-trail recording',
      categories: ['ecosystem' as const],
      servers: ['dispute', 'resolve', 'chittyevidence', 'ledger', 'tasks', 'notion'],
      boost: 0.6,
    },
    code: {
      description: 'Software development',
      categories: ['code' as const],
      servers: ['github', 'neon'],
      boost: 0.5,
    },
  },
};

const FIXTURE_CONFIGS: ServerConfig[] = [
  { id: 'dispute', name: 'ChittyDispute', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.dispute' },
  { id: 'resolve', name: 'ChittyResolve', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.resolve' },
  { id: 'ledger', name: 'ChittyLedger', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/ledger-mcp/dist/index.js'] },
  { id: 'tasks', name: 'ChittyAgent Tasks', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/tasks-mcp/dist/index.js'] },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.github' },
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
    focusProfiles: LEGAL_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('legal focus: search "open disputes" ranks dispute/ tools first', async () => {
  const { aggregator } = buildAggregator('legal');

  const result = await aggregator.callTool('ch1tty/search', { query: 'open disputes', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const disputeIdx = tools.findIndex((r) => r.tool.startsWith('dispute/'));
  const outIdx = tools.findIndex((r) => !['dispute/', 'resolve/', 'ledger/', 'tasks/'].some((p) => r.tool.startsWith(p)));

  assert.ok(disputeIdx !== -1, 'dispute/ tools should appear in results');
  if (outIdx !== -1) {
    assert.ok(disputeIdx < outIdx, 'dispute/ tools should rank above out-of-focus tools');
  }
  assert.equal(parsed.focus, 'legal', 'search response should report active focus');
});

test('legal focus: search "list disputes" includes dispute/list_disputes', async () => {
  const { aggregator } = buildAggregator('legal');

  const result = await aggregator.callTool('ch1tty/search', { query: 'list disputes status', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'dispute/list_disputes'), 'dispute/list_disputes must appear in results');
});

test('legal focus: out-of-focus tools (neon) remain reachable via search', async () => {
  const { aggregator } = buildAggregator('legal');

  const result = await aggregator.callTool('ch1tty/search', { query: 'neon database sql query', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('neon/')), 'neon/ tools must remain reachable when legal focus is active');
});

test('legal focus: no focus — dispute tools still accessible (lens not gate)', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/search', { query: 'file dispute party', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('dispute/')), 'dispute/ tools must be reachable without any focus');
});

test('legal focus: execute dispute/list_disputes returns fixture disputes', async () => {
  const { aggregator, fixture } = buildAggregator('legal');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'dispute/list_disputes',
    args: { status: 'open' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const disputes = JSON.parse(result.content[0].text as string) as Array<{ id: string; status: string }>;
  assert.ok(Array.isArray(disputes), 'should return an array of disputes');
  assert.ok(disputes.length > 0, 'fixture should return at least one dispute');
  assert.ok(disputes.every((d) => d.id && d.status), 'each dispute should have id and status');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'dispute' && c.tool === 'list_disputes'), 'dispute/list_disputes must be in call log');
});

test('legal focus: execute resolve/create_resolution returns fixture resolution', async () => {
  const { aggregator, fixture } = buildAggregator('legal');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'resolve/create_resolution',
    args: { dispute_id: 'dsp-001', terms: 'Payment of $12,500 within 10 business days' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const resolution = JSON.parse(result.content[0].text as string) as { id: string; dispute_id: string; status: string };
  assert.ok(resolution.id, 'resolution should have an id');
  assert.equal(resolution.dispute_id, 'dsp-001', 'resolution should reference the dispute');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'resolve' && c.tool === 'create_resolution'), 'resolve/create_resolution must be in call log');
});

test('legal focus: multi-step — list disputes, file, then create resolution', async () => {
  const { aggregator, fixture } = buildAggregator('legal');
  const sessionId = 'legal-scenario-001';
  fixture.clearCallLog();

  // Step 1: list open disputes
  const listResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'dispute/list_disputes',
    args: { status: 'open' },
  }, sessionId);
  assert.equal(listResult.isError, undefined, 'list_disputes should succeed');
  const disputes = JSON.parse(listResult.content[0].text as string) as Array<{ id: string }>;
  assert.ok(disputes.length > 0, 'should return disputes');

  // Step 2: file a new dispute
  const fileResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'dispute/file_dispute',
    args: { subject: 'Unpaid balance from listed disputes', party: 'Acme Corp', description: 'Balance outstanding from prior period.' },
  }, sessionId);
  assert.equal(fileResult.isError, undefined, 'file_dispute should succeed');
  const filed = JSON.parse(fileResult.content[0].text as string) as { id: string };

  // Step 3: create a resolution for the filed dispute
  const resolveResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'resolve/create_resolution',
    args: { dispute_id: filed.id, terms: 'Settlement for $12,500' },
  }, sessionId);
  assert.equal(resolveResult.isError, undefined, 'create_resolution should succeed');

  const calls = fixture.getCallLog();
  const callKeys = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(callKeys.includes('dispute/list_disputes'), 'list_disputes must be in call log');
  assert.ok(callKeys.includes('dispute/file_dispute'), 'file_dispute must be in call log');
  assert.ok(callKeys.includes('resolve/create_resolution'), 'create_resolution must be in call log');
});

test('legal focus: multi-step — resolve then append to ledger audit trail', async () => {
  const { aggregator, fixture } = buildAggregator('legal');
  const sessionId = 'legal-scenario-002';
  fixture.clearCallLog();

  // Step 1: apply a resolution
  const applyResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'resolve/apply_resolution',
    args: { id: 'res-001', accepted_by: 'nick@nevershitty.com' },
  }, sessionId);
  assert.equal(applyResult.isError, undefined, 'apply_resolution should succeed');
  const resolution = JSON.parse(applyResult.content[0].text as string) as { id: string; status: string };
  assert.equal(resolution.status, 'accepted', 'resolution should be accepted');

  // Step 2: append audit entry to ledger
  const ledgerResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'ledger/append_entry',
    args: { namespace: 'legal', payload: { type: 'resolution.applied', resolution_id: resolution.id } },
  }, sessionId);
  assert.equal(ledgerResult.isError, undefined, 'append_entry should succeed');

  const calls = fixture.getCallLog();
  const callKeys = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(callKeys.includes('resolve/apply_resolution'), 'apply_resolution must be in call log');
  assert.ok(callKeys.includes('ledger/append_entry'), 'ledger/append_entry must be in call log');
});

test('legal focus: status reports active focus as legal', async () => {
  const { aggregator } = buildAggregator('legal');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'legal', 'status must report legal as active focus');
});

test('legal focus: cast "list open disputes" resolves to dispute/list_disputes', async () => {
  const { aggregator } = buildAggregator('legal');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list all open disputes',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(
    resolved.tool === 'dispute/list_disputes',
    `cast should resolve to dispute/list_disputes, got: ${resolved.tool}`,
  );
  assert.equal(cast.focus, 'legal', 'cast response should report active focus');
});

test('legal focus: cast "create dispute resolution" resolves to resolve/ tool', async () => {
  const { aggregator } = buildAggregator('legal');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'create a resolution proposal for a dispute',
    confirm: true,
  });
  assert.equal(result.isError, undefined);

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(
    resolved.tool.startsWith('resolve/'),
    `should resolve to a resolve/ tool, got: ${resolved.tool}`,
  );
});

test('legal focus: search "list resolution records" includes resolve/list_resolutions', async () => {
  const { aggregator } = buildAggregator('legal');

  const result = await aggregator.callTool('ch1tty/search', { query: 'list resolution records dispute', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'resolve/list_resolutions'), 'resolve/list_resolutions must appear in results');
});

test('legal focus: file new dispute and create task for follow-up', async () => {
  const { aggregator, fixture } = buildAggregator('legal');
  const sessionId = 'legal-scenario-003';
  fixture.clearCallLog();

  // Step 1: file a new dispute
  const fileResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'dispute/file_dispute',
    args: {
      subject: 'Unpaid consulting invoice #2026-099',
      party: 'Client Corp',
      description: 'Invoice for $8,000 is 60 days overdue.',
    },
  }, sessionId);
  assert.equal(fileResult.isError, undefined, 'file_dispute should succeed');
  const filed = JSON.parse(fileResult.content[0].text as string) as { id: string; status: string };
  assert.equal(filed.status, 'open', 'filed dispute should be open');

  // Step 2: create a follow-up task
  const taskResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'tasks/create_task',
    args: { entity_id: 'ch1tty', title: `Follow up on dispute ${filed.id}` },
  }, sessionId);
  assert.equal(taskResult.isError, undefined, 'create_task should succeed');
  const task = JSON.parse(taskResult.content[0].text as string) as { id: string; status: string };
  assert.equal(task.status, 'open', 'follow-up task should be open');

  const calls = fixture.getCallLog();
  const callKeys = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(callKeys.includes('dispute/file_dispute'), 'file_dispute must be in call log');
  assert.ok(callKeys.includes('tasks/create_task'), 'create_task must be in call log');
});
