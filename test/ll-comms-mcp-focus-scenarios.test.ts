/**
 * Workstream L — comms-mcp focused server scenarios.
 *
 * Validates the communication focus profile with comms as a wired backend:
 *  - comms/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves communication intents to comms/ tools
 *  - out-of-focus tools remain reachable when communication focus is active
 *  - comms.recentLog executes correctly via the fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const COMMS_FOCUS_PROFILES = {
  profiles: {
    communication: {
      description: 'Cross-channel messaging, notes, team communication, and follow-up task creation',
      categories: ['communication' as const],
      servers: ['notion', 'chittymac', 'imessage', 'tasks', 'comms', 'bluebubbles'],
      boost: 0.5,
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
  { id: 'comms', name: 'ChittyComms', type: 'local', access: 'read', category: 'communication', command: 'node', args: ['./apps/comms-mcp/dist/index.js'] },
  { id: 'notion', name: 'Notion', type: 'remote', access: 'readwrite', category: 'documents', endpoint: 'https://fixture.notion' },
  { id: 'imessage', name: 'iMessage', type: 'local', access: 'readwrite', category: 'communication', command: 'node', args: ['~/.config/claude/mcp-servers/chitty-imessage/build/index.js'] },
  { id: 'chittymac', name: 'Apple Notes', type: 'local', access: 'readwrite', category: 'communication', command: 'node', args: ['~/Desktop/Projects/github.com/CHITTYOS/chittymac/build/server.js'] },
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
    focusProfiles: COMMS_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('communication focus: search "unified communications log" ranks comms/ tools first', async () => {
  const { aggregator } = buildAggregator('communication');

  const result = await aggregator.callTool('ch1tty/search', { query: 'unified communications log', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const commsIdx = tools.findIndex((r) => r.tool.startsWith('comms/'));
  const outIdx = tools.findIndex((r) => !['comms/', 'notion/', 'imessage/', 'chittymac/'].some((p) => r.tool.startsWith(p)));

  assert.ok(commsIdx !== -1, 'comms/ tools should appear in results for comms-specific query');
  if (outIdx !== -1) {
    assert.ok(commsIdx < outIdx, 'comms/ tools should rank above out-of-focus tools for comms query');
  }
  assert.equal(parsed.focus, 'communication', 'search response should report active focus');
});

test('communication focus: search "communications log" includes comms/comms.recentLog', async () => {
  const { aggregator } = buildAggregator('communication');

  const result = await aggregator.callTool('ch1tty/search', { query: 'communications log', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'comms/comms.recentLog'), 'comms/comms.recentLog must appear in results');
});

test('communication focus: out-of-focus tools (neon) remain reachable via search', async () => {
  const { aggregator } = buildAggregator('communication');

  const result = await aggregator.callTool('ch1tty/search', { query: 'neon database sql', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('neon/')), 'neon/ tools must remain reachable when communication focus is active');
});

test('communication focus: no focus — comms tools still accessible (lens not gate)', async () => {
  const { aggregator } = buildAggregator(); // no focus

  const result = await aggregator.callTool('ch1tty/search', { query: 'recent communications log', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('comms/')), 'comms/ tools must be reachable without any focus');
});

test('communication focus: execute comms.recentLog returns fixture unified log', async () => {
  const { aggregator, fixture } = buildAggregator('communication');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'comms/comms.recentLog',
    args: { identifier: '+13122186717', days: 7 },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const log = JSON.parse(result.content[0].text as string) as { ok: boolean; entries: Array<{ id: string; channel: string }> };
  assert.equal(log.ok, true, 'fixture response should be ok');
  assert.ok(Array.isArray(log.entries), 'should return an entries array');
  assert.ok(log.entries.length > 0, 'fixture should return at least one entry');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'comms' && c.tool === 'comms.recentLog'), 'comms/comms.recentLog must be in call log');
});

test('communication focus: multi-step — fetch log then draft a task from a message', async () => {
  const { aggregator, fixture } = buildAggregator('communication');
  const sessionId = 'comms-scenario-001';
  fixture.clearCallLog();

  // Step 1: fetch recent comms log
  const logResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'comms/comms.recentLog',
    args: { identifier: '+13122186717', days: 3 },
  }, sessionId);
  assert.equal(logResult.isError, undefined, 'comms.recentLog should succeed');
  const log = JSON.parse(logResult.content[0].text as string) as { entries: Array<{ id: string; snippet: string }> };
  assert.ok(log.entries.length > 0, 'should return entries');

  // Step 2: create a follow-up task referencing the first message
  const createResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'tasks/create_task',
    args: { entity_id: 'ch1tty', title: `Follow up: ${log.entries[0]!.snippet.slice(0, 40)}` },
  }, sessionId);
  assert.equal(createResult.isError, undefined, 'create_task should succeed');
  const created = JSON.parse(createResult.content[0].text as string) as { id: string; status: string };
  assert.equal(created.status, 'open', 'created task should be open');

  // Both calls must appear in the log
  const calls = fixture.getCallLog();
  const callKeys = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(callKeys.includes('comms/comms.recentLog'), 'comms.recentLog must be in call log');
  assert.ok(callKeys.includes('tasks/create_task'), 'tasks/create_task must be in call log');
});

test('communication focus: status reports active focus as communication', async () => {
  const { aggregator } = buildAggregator('communication');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'communication', 'status must report communication as active focus');
});

test('communication focus: cast "show recent messages" with confirm resolves to comms/comms.recentLog', async () => {
  const { aggregator } = buildAggregator('communication');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'show recent messages with someone',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(
    resolved.tool.startsWith('comms/') || ['imessage/', 'chittymac/'].some((p) => resolved.tool.startsWith(p)),
    `cast should resolve to a communication tool, got: ${resolved.tool}`,
  );
  assert.equal(cast.focus, 'communication', 'cast response should report active focus');
});

test('communication focus: cast "get unified comms log" resolves to comms.recentLog', async () => {
  const { aggregator } = buildAggregator('communication');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'get unified communications log for a contact',
    confirm: true,
  });
  assert.equal(result.isError, undefined);

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.equal(
    resolved.tool,
    'comms/comms.recentLog',
    `should resolve to comms/comms.recentLog, got: ${resolved.tool}`,
  );
});

test('communication focus: channel degradation — partial ok response still usable', async () => {
  const { aggregator, fixture } = buildAggregator('communication');

  // Extend the comms fixture to return a partial-failure response for this test
  fixture.defineServer('comms', {
    tools: [
      {
        name: 'comms.recentLog',
        description: 'Recent communications log',
        inputSchema: { type: 'object', oneOf: [{ required: ['person'] }, { required: ['identifier'] }], properties: { identifier: { type: 'string' }, person: { type: 'string' } } },
        response: {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: false,
              entries: [
                { id: 'entry-001', channel: 'quo', direction: 'inbound', self: false, timestamp: '2026-09-04T18:32:00Z', snippet: 'Available for the call?' },
              ],
              channelResults: [
                { channel: 'quo', ok: true, count: 1 },
                { channel: 'imessage', ok: false, error: 'provider unavailable' },
                { channel: 'email', ok: false, error: 'timeout' },
              ],
            }),
          }],
        },
      },
    ],
  });

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'comms/comms.recentLog',
    args: { identifier: 'nick@nevershitty.com', channels: ['quo', 'imessage', 'email'] },
  });
  assert.equal(result.isError, undefined, 'partial failure should not surface as a gateway error');

  const log = JSON.parse(result.content[0].text as string) as { ok: boolean; entries: unknown[]; channelResults: Array<{ channel: string; ok: boolean }> };
  assert.ok(Array.isArray(log.entries), 'entries should still be an array');
  assert.ok(log.channelResults.some((r) => r.channel === 'quo' && r.ok), 'quo channel should report ok');
  assert.ok(log.channelResults.some((r) => r.channel === 'imessage' && !r.ok), 'imessage channel should report failure');
});
