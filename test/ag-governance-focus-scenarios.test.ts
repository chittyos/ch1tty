/**
 * Workstream W — governance focus profile scenarios.
 *
 * Validates the governance focus profile:
 *  - chittyevidence/, session/, and orchestrator/ tools are boosted in search ranking
 *  - cast resolves compliance/audit intents to governance-category tools
 *  - out-of-focus tools remain reachable when governance focus is active
 *  - multi-step governance workflow (ingest evidence, record session) executes via fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const GOVERNANCE_FOCUS_PROFILES = {
  profiles: {
    governance: {
      description: 'Governance, compliance, and audit — evidence ingest, session tracking, orchestration, and ledger.',
      categories: ['ecosystem' as const, 'documents' as const],
      servers: ['chittyos', 'neon', 'notion', 'chittyevidence', 'orchestrator', 'session', 'ledger', 'tasks'],
      boost: 0.5,
    },
    code: {
      description: 'Software development',
      categories: ['code' as const],
      servers: ['github'],
      boost: 0.5,
    },
  },
};

const FIXTURE_CONFIGS: ServerConfig[] = [
  { id: 'chittyos', name: 'ChittyOS', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.chittyos' },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.neon' },
  { id: 'notion', name: 'Notion', type: 'remote', access: 'readwrite', category: 'documents', endpoint: 'https://fixture.notion' },
  { id: 'chittyevidence', name: 'ChittyEvidence', type: 'remote', access: 'readwrite', category: 'documents', endpoint: 'https://fixture.chittyevidence' },
  { id: 'orchestrator', name: 'Orchestrator', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.orchestrator' },
  { id: 'session', name: 'Session', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.session' },
  { id: 'ledger', name: 'Ledger', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./ledger'] },
  { id: 'tasks', name: 'Tasks', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./tasks'] },
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
    focusProfiles: GOVERNANCE_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('governance focus: search "audit evidence compliance" ranks governance tools first', async () => {
  const { aggregator } = buildAggregator('governance');

  const result = await aggregator.callTool('ch1tty/search', { query: 'audit evidence compliance record', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const govPrefixes = ['chittyevidence/', 'session/', 'ledger/', 'orchestrator/', 'chittyos/', 'notion/'];
  const govIdx = tools.findIndex((r) => govPrefixes.some((p) => r.tool.startsWith(p)));
  const outIdx = tools.findIndex((r) => !govPrefixes.some((p) => r.tool.startsWith(p)));

  assert.ok(govIdx !== -1, 'governance tools should appear for audit/evidence query');
  if (outIdx !== -1) {
    assert.ok(govIdx < outIdx, 'governance tools should rank above out-of-focus tools');
  }
  assert.equal(parsed.focus, 'governance', 'search response should report governance focus');

  const { aggregator: noFocusAgg } = buildAggregator();
  const noFocusResult = await noFocusAgg.callTool('ch1tty/search', { query: 'audit evidence compliance record', limit: 10 });
  const govIdxNoFocus = (parseSearch(noFocusResult).tools ?? []).findIndex((r) =>
    govPrefixes.some((p) => r.tool.startsWith(p)),
  );
  assert.ok(govIdxNoFocus >= 0, 'governance tools should appear even without focus');
  assert.ok(govIdx <= govIdxNoFocus,
    `focus should rank governance tools at least as high as no-focus (focused: pos ${govIdx}, no-focus: pos ${govIdxNoFocus})`);
});

test('governance focus: out-of-focus tools (github) remain reachable', async () => {
  const { aggregator } = buildAggregator('governance');

  const result = await aggregator.callTool('ch1tty/search', { query: 'pull request code repository', limit: 15 });
  assert.equal(result.isError, undefined, 'search should not error with governance focus');

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('github/')), 'github/ tools must remain reachable under governance focus');
});

test('governance focus: cast "ingest compliance document" resolves to chittyevidence/ tool', async () => {
  const { aggregator } = buildAggregator('governance');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'ingest a compliance document into the evidence store for audit trail',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(
    resolved.tool.startsWith('chittyevidence/'),
    `cast should resolve to chittyevidence/ for document ingest intent, got: ${resolved.tool}`,
  );
  assert.equal(cast.focus, 'governance', 'cast response should report active focus');
});

test('governance focus: multi-step — ingest document, then search for it', async () => {
  const { aggregator } = buildAggregator('governance');

  const ingestResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'chittyevidence/ingest_document',
    args: { content: 'Audit log for Q3 2026 compliance review', kind: 'text/plain' },
  });
  assert.equal(ingestResult.isError, undefined, 'ingest step should succeed');

  const searchResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'chittyevidence/search_documents',
    args: { query: 'compliance review' },
  });
  assert.equal(searchResult.isError, undefined, 'search_documents step should succeed');
});

test('governance focus: execute session/list_sessions returns sessions list', async () => {
  const { aggregator } = buildAggregator('governance');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'session/list_sessions',
    args: {},
  });
  assert.equal(result.isError, undefined, 'session/list_sessions should succeed under governance focus');
  const parsed = JSON.parse(result.content[0].text as string) as unknown;
  assert.ok(Array.isArray(parsed), 'list_sessions should return sessions array');
});

test('governance focus: status reports active focus as governance', async () => {
  const { aggregator } = buildAggregator('governance');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'governance', 'status must report governance as active focus');
});
