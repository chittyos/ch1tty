/**
 * Workstream W — communication focus profile scenarios.
 *
 * Validates the communication focus profile:
 *  - comms/, imessage/, and tasks/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves messaging intents to communication-category tools
 *  - out-of-focus tools remain reachable when communication focus is active
 *  - multi-step messaging workflow executes correctly via fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const COMMUNICATION_FOCUS_PROFILES = {
  profiles: {
    communication: {
      description: 'Cross-channel communication — send and retrieve messages across iMessage, email, and Slack.',
      categories: ['communication' as const],
      servers: ['notion', 'chittymac', 'imessage', 'tasks', 'comms'],
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
  { id: 'notion', name: 'Notion', type: 'remote', access: 'readwrite', category: 'documents', endpoint: 'https://fixture.notion' },
  { id: 'chittymac', name: 'ChittyMac', type: 'local', access: 'readwrite', category: 'communication', command: 'node', args: ['./chittymac'] },
  { id: 'imessage', name: 'iMessage', type: 'local', access: 'readwrite', category: 'communication', command: 'node', args: ['./imessage'] },
  { id: 'tasks', name: 'Tasks', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./tasks'] },
  { id: 'comms', name: 'Comms', type: 'local', access: 'readwrite', category: 'communication', command: 'node', args: ['./comms'] },
  { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.github' },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
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
    focusProfiles: COMMUNICATION_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('communication focus: search "send message" ranks comms/ and imessage/ tools first', async () => {
  const { aggregator } = buildAggregator('communication');

  const result = await aggregator.callTool('ch1tty/search', { query: 'send message contact', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const commIdx = tools.findIndex((r) =>
    ['comms/', 'imessage/', 'chittymac/'].some((p) => r.tool.startsWith(p)),
  );
  const outIdx = tools.findIndex((r) =>
    !['comms/', 'imessage/', 'chittymac/', 'notion/', 'tasks/'].some((p) => r.tool.startsWith(p)),
  );

  assert.ok(commIdx !== -1, 'comms/imessage/chittymac tools should appear for messaging query');
  if (outIdx !== -1) {
    assert.ok(commIdx < outIdx, 'communication tools should rank above out-of-focus tools');
  }
  assert.equal(parsed.focus, 'communication', 'search response should report communication focus');
});

test('communication focus: out-of-focus tools (github) remain reachable', async () => {
  const { aggregator } = buildAggregator('communication');

  const result = await aggregator.callTool('ch1tty/search', { query: 'pull request code review', limit: 15 });
  assert.equal(result.isError, undefined, 'search should not error with communication focus');

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('github/')), 'github/ tools must remain reachable under communication focus');
});

test('communication focus: cast "read recent messages" resolves to comms/ tool', async () => {
  const { aggregator } = buildAggregator('communication');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'read recent messages across channels to catch up on conversations',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(
    ['comms/', 'imessage/', 'chittymac/', 'notion/', 'tasks/'].some((p) => resolved.tool.startsWith(p)),
    `cast should resolve to a communication-focus tool, got: ${resolved.tool}`,
  );
  assert.equal(cast.focus, 'communication', 'cast response should report active focus');
});

test('communication focus: execute comms/comms.recentLog returns message log', async () => {
  const { aggregator } = buildAggregator('communication');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'comms/comms.recentLog',
    args: {},
  });
  assert.equal(result.isError, undefined, 'comms.recentLog should succeed under communication focus');
});

test('communication focus: status reports active focus as communication', async () => {
  const { aggregator } = buildAggregator('communication');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'communication', 'status must report communication as active focus');
});
