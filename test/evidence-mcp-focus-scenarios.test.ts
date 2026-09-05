/**
 * Workstream K — evidence-mcp focused server scenarios.
 *
 * Validates the chittyevidence focus profile:
 *  - chittyevidence/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves document-management intents to chittyevidence/ tools
 *  - out-of-focus tools remain reachable when chittyevidence focus is active
 *  - multi-step document workflows execute correctly via the fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const EVIDENCE_FOCUS_PROFILES = {
  profiles: {
    chittyevidence: {
      description: 'Evidence corpus — ingest, search, and retrieve documents with canonical URIs via ChittyEvidence',
      categories: ['ecosystem' as const],
      servers: ['chittyevidence'],
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
  { id: 'chittyevidence', name: 'ChittyEvidence', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/evidence-mcp/dist/index.js'] },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.github' },
  { id: 'tasks', name: 'ChittyAgent Tasks', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/tasks-mcp/dist/index.js'] },
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
    focusProfiles: EVIDENCE_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('chittyevidence focus: search "ingest document" ranks chittyevidence/ tools first', async () => {
  const { aggregator } = buildAggregator('chittyevidence');

  const result = await aggregator.callTool('ch1tty/search', { query: 'ingest document', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const evidenceIdx = tools.findIndex((r) => r.tool.startsWith('chittyevidence/'));
  const otherIdx = tools.findIndex((r) => !r.tool.startsWith('chittyevidence/'));

  assert.ok(evidenceIdx !== -1, 'chittyevidence/ tools should appear in results');
  if (otherIdx !== -1) {
    assert.ok(evidenceIdx < otherIdx, 'chittyevidence/ tools should rank above out-of-focus tools for ingest query');
  }
  assert.equal(parsed.focus, 'chittyevidence', 'search response should report active focus');
});

test('chittyevidence focus: search "search documents" includes chittyevidence/search_documents', async () => {
  const { aggregator } = buildAggregator('chittyevidence');

  const result = await aggregator.callTool('ch1tty/search', { query: 'search documents', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'chittyevidence/search_documents'), 'chittyevidence/search_documents must appear in results');
});

test('chittyevidence focus: out-of-focus tools (neon) remain reachable via search', async () => {
  const { aggregator } = buildAggregator('chittyevidence');

  const result = await aggregator.callTool('ch1tty/search', { query: 'database', limit: 20 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('neon/')), 'neon/ tools must remain reachable with chittyevidence focus active');
});

test('chittyevidence focus: no focus — evidence tools still accessible (lens not gate)', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/search', { query: 'ingest document evidence', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('chittyevidence/')), 'chittyevidence/ tools must be reachable without any focus');
});

test('chittyevidence focus: execute list_documents returns fixture document list', async () => {
  const { aggregator, fixture } = buildAggregator('chittyevidence');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'chittyevidence/list_documents',
    args: { kind: 'note' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const parsed = JSON.parse(result.content[0].text as string) as { documents: Array<{ id: string }> };
  assert.ok(Array.isArray(parsed.documents), 'should return documents array');
  assert.ok(parsed.documents.length > 0, 'fixture should return at least one document');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'chittyevidence' && c.tool === 'list_documents'), 'chittyevidence/list_documents must be in call log');
});

test('chittyevidence focus: multi-step — ingest document then get it back', async () => {
  const { aggregator, fixture } = buildAggregator('chittyevidence');
  const sessionId = 'evidence-scenario-001';
  fixture.clearCallLog();

  // Step 1: ingest a document
  const ingestResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'chittyevidence/ingest_document',
    args: { content: 'Architecture decision: use slim-MCP pattern', kind: 'note', title: 'ADR-001' },
  }, sessionId);
  assert.equal(ingestResult.isError, undefined, 'ingest_document should succeed');
  const ingested = JSON.parse(ingestResult.content[0].text as string) as { id: string; canonical_uri: string };
  assert.ok(ingested.id, 'ingested document should have an id');
  assert.ok(ingested.canonical_uri.startsWith('chittycanon://'), 'canonical_uri should use chittycanon:// scheme');

  // Step 2: retrieve the document by id
  const getResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'chittyevidence/get_document',
    args: { id: ingested.id },
  }, sessionId);
  assert.equal(getResult.isError, undefined, 'get_document should succeed');
  const fetched = JSON.parse(getResult.content[0].text as string) as { id: string; canonical_uri: string };
  assert.equal(fetched.id, ingested.id, 'fetched document id should match ingested id');

  const calls = fixture.getCallLog();
  const toolNames = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(toolNames.includes('chittyevidence/ingest_document'), 'ingest_document must be in call log');
  assert.ok(toolNames.includes('chittyevidence/get_document'), 'get_document must be in call log');
});

test('chittyevidence focus: execute search_documents returns ranked results', async () => {
  const { aggregator } = buildAggregator('chittyevidence');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'chittyevidence/search_documents',
    args: { query: 'architecture' },
  });
  assert.equal(result.isError, undefined, 'search_documents should succeed');

  const parsed = JSON.parse(result.content[0].text as string) as { documents: Array<{ id: string }>; total: number };
  assert.ok(Array.isArray(parsed.documents), 'should return documents array');
  assert.ok(typeof parsed.total === 'number', 'should include a total count');
});

test('chittyevidence focus: execute get_canonical_uri returns chittycanon:// URI', async () => {
  const { aggregator } = buildAggregator('chittyevidence');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'chittyevidence/get_canonical_uri',
    args: { id: 'doc-1' },
  });
  assert.equal(result.isError, undefined, 'get_canonical_uri should succeed');

  const parsed = JSON.parse(result.content[0].text as string) as { id: string; canonical_uri: string };
  assert.equal(parsed.id, 'doc-1', 'id should match requested document id');
  assert.ok(parsed.canonical_uri.startsWith('chittycanon://'), 'canonical_uri must use chittycanon:// scheme');
});

test('chittyevidence focus: status reports active focus as chittyevidence', async () => {
  const { aggregator } = buildAggregator('chittyevidence');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'chittyevidence', 'status must report chittyevidence as active focus');
});

test('chittyevidence focus: cast "ingest a document" with confirm resolves to chittyevidence/ingest_document', async () => {
  const { aggregator } = buildAggregator('chittyevidence');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'ingest a document into the evidence corpus',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(resolved.tool.startsWith('chittyevidence/'), `cast should resolve to chittyevidence/, got: ${resolved.tool}`);
  assert.equal(cast.focus, 'chittyevidence', 'cast response should report active focus');
});

test('chittyevidence focus: cast "search evidence" resolves to chittyevidence/search_documents', async () => {
  const { aggregator } = buildAggregator('chittyevidence');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'search evidence corpus for relevant documents',
    confirm: true,
  });
  assert.equal(result.isError, undefined);

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.equal(
    resolved.tool,
    'chittyevidence/search_documents',
    `should resolve to chittyevidence/search_documents, got: ${resolved.tool}`,
  );
});
