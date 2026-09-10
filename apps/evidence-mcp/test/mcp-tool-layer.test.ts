import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createEvidenceServer } from '../src/server.ts';
import type {
  EvidenceClient,
  Document,
  ListDocumentsFilter,
  ListDocumentsResult,
  SearchDocumentsResult,
} from '../src/evidence-client.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DOC_1: Document = {
  id: 'doc-1',
  canonical_uri: 'chittycanon://evidence/doc-1',
  kind: 'note',
  title: 'Meeting notes 2026-01-01',
  content: 'We discussed the deployment plan.',
  tags: ['meeting', 'deploy'],
  metadata: { author: 'alice' },
  created_at: '2026-01-01T09:00:00Z',
};

const DOC_2: Document = {
  id: 'doc-2',
  canonical_uri: 'chittycanon://evidence/doc-2',
  kind: 'report',
  content: 'Q1 results summary.',
  created_at: '2026-02-01T12:00:00Z',
};

// ── Mock EvidenceClient ───────────────────────────────────────────────────────

interface MockOverrides {
  ingestDocument?: (input: { content: string; kind: string; title?: string; tags?: string[]; metadata?: Record<string, unknown> }) => Promise<Document>;
  listDocuments?: (filter?: ListDocumentsFilter) => Promise<ListDocumentsResult>;
  getDocument?: (id: string) => Promise<Document>;
  searchDocuments?: (query: string, kind?: string, limit?: number) => Promise<SearchDocumentsResult>;
  getCanonicalUri?: (id: string) => Promise<{ id: string; canonical_uri: string }>;
}

function makeMockClient(overrides: MockOverrides = {}): EvidenceClient {
  return {
    ingestDocument: overrides.ingestDocument ?? (async (input) => ({ ...DOC_1, id: 'doc-new', kind: input.kind, content: input.content })),
    listDocuments: overrides.listDocuments ?? (async () => ({ documents: [DOC_1, DOC_2], has_more: false })),
    getDocument: overrides.getDocument ?? (async () => DOC_1),
    searchDocuments: overrides.searchDocuments ?? (async () => ({ documents: [DOC_1], total: 1 })),
    getCanonicalUri: overrides.getCanonicalUri ?? (async (id) => ({ id, canonical_uri: `chittycanon://evidence/${id}` })),
  } as unknown as EvidenceClient;
}

// ── Test harness ──────────────────────────────────────────────────────────────

async function setup(overrides?: MockOverrides): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const mockClient = makeMockClient(overrides);
  const server = createEvidenceServer(mockClient);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const mcpClient = new Client(
    { name: 'test-client', version: '1.0.0' },
    { capabilities: {} },
  );

  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  return {
    client: mcpClient,
    cleanup: async () => { await mcpClient.close(); },
  };
}

// ── Tool listing ──────────────────────────────────────────────────────────────

test('list_tools returns exactly 5 tools', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.listTools();
    assert.equal(result.tools.length, 5);
    const names = result.tools.map(t => t.name).sort();
    assert.deepEqual(names, [
      'get_canonical_uri', 'get_document', 'ingest_document', 'list_documents', 'search_documents',
    ]);
  } finally {
    await cleanup();
  }
});

test('list_tools: ingest_document has required=[content, kind]', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.listTools();
    const tool = result.tools.find(t => t.name === 'ingest_document');
    assert.ok(tool, 'ingest_document missing');
    const schema = tool.inputSchema as { required?: string[] };
    assert.deepEqual(schema.required?.sort(), ['content', 'kind']);
  } finally {
    await cleanup();
  }
});

test('list_tools: get_document has required=[id]', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.listTools();
    const tool = result.tools.find(t => t.name === 'get_document');
    assert.ok(tool);
    const schema = tool.inputSchema as { required?: string[] };
    assert.deepEqual(schema.required, ['id']);
  } finally {
    await cleanup();
  }
});

test('list_tools: search_documents has required=[query]', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.listTools();
    const tool = result.tools.find(t => t.name === 'search_documents');
    assert.ok(tool);
    const schema = tool.inputSchema as { required?: string[] };
    assert.deepEqual(schema.required, ['query']);
  } finally {
    await cleanup();
  }
});

test('list_tools: get_canonical_uri has required=[id]', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.listTools();
    const tool = result.tools.find(t => t.name === 'get_canonical_uri');
    assert.ok(tool);
    const schema = tool.inputSchema as { required?: string[] };
    assert.deepEqual(schema.required, ['id']);
  } finally {
    await cleanup();
  }
});

// ── ingest_document ───────────────────────────────────────────────────────────

test('ingest_document: passes content and kind to client', async () => {
  let capturedInput: { content: string; kind: string } | undefined;
  const { client, cleanup } = await setup({
    ingestDocument: async (input) => { capturedInput = input; return { ...DOC_1, id: 'doc-new', kind: input.kind, content: input.content }; },
  });
  try {
    await client.callTool({ name: 'ingest_document', arguments: { content: 'Hello world', kind: 'note' } });
    assert.equal(capturedInput?.content, 'Hello world');
    assert.equal(capturedInput?.kind, 'note');
  } finally {
    await cleanup();
  }
});

test('ingest_document: passes optional fields (title, tags, metadata)', async () => {
  let capturedInput: Record<string, unknown> | undefined;
  const { client, cleanup } = await setup({
    ingestDocument: async (input) => { capturedInput = input as Record<string, unknown>; return DOC_1; },
  });
  try {
    await client.callTool({
      name: 'ingest_document',
      arguments: { content: 'Text', kind: 'report', title: 'Q1', tags: ['finance'], metadata: { author: 'bob' } },
    });
    assert.equal(capturedInput?.['title'], 'Q1');
    assert.deepEqual(capturedInput?.['tags'], ['finance']);
    assert.deepEqual(capturedInput?.['metadata'], { author: 'bob' });
  } finally {
    await cleanup();
  }
});

test('ingest_document: returns document as JSON', async () => {
  const { client, cleanup } = await setup({
    ingestDocument: async (input) => ({ ...DOC_1, id: 'doc-new', kind: input.kind, content: input.content }),
  });
  try {
    const result = await client.callTool({ name: 'ingest_document', arguments: { content: 'Hi', kind: 'note' } });
    assert.ok(!result.isError);
    const content = result.content as Array<{ type: string; text: string }>;
    const doc = JSON.parse(content[0].text) as Document;
    assert.equal(doc.id, 'doc-new');
    assert.equal(doc.kind, 'note');
  } finally {
    await cleanup();
  }
});

test('ingest_document: missing content → isError', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'ingest_document', arguments: { kind: 'note' } });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('"content"'));
  } finally {
    await cleanup();
  }
});

test('ingest_document: missing kind → isError', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'ingest_document', arguments: { content: 'Hello' } });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('"kind"'));
  } finally {
    await cleanup();
  }
});

// ── list_documents ────────────────────────────────────────────────────────────

test('list_documents: returns documents list as JSON', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'list_documents', arguments: {} });
    assert.ok(!result.isError);
    const content = result.content as Array<{ type: string; text: string }>;
    const body = JSON.parse(content[0].text) as ListDocumentsResult;
    assert.equal(body.documents.length, 2);
    assert.equal(body.documents[0].id, 'doc-1');
  } finally {
    await cleanup();
  }
});

test('list_documents: passes filter fields to client', async () => {
  let capturedFilter: ListDocumentsFilter | undefined;
  const { client, cleanup } = await setup({
    listDocuments: async (filter) => { capturedFilter = filter; return { documents: [], has_more: false }; },
  });
  try {
    await client.callTool({
      name: 'list_documents',
      arguments: { kind: 'report', tag: 'finance', since: '2026-01-01T00:00:00Z', cursor: 'abc', limit: 10 },
    });
    assert.equal(capturedFilter?.kind, 'report');
    assert.equal(capturedFilter?.tag, 'finance');
    assert.equal(capturedFilter?.since, '2026-01-01T00:00:00Z');
    assert.equal(capturedFilter?.cursor, 'abc');
    assert.equal(capturedFilter?.limit, 10);
  } finally {
    await cleanup();
  }
});

// ── get_document ──────────────────────────────────────────────────────────────

test('get_document: passes id to client', async () => {
  let capturedId = '';
  const { client, cleanup } = await setup({
    getDocument: async (id) => { capturedId = id; return DOC_1; },
  });
  try {
    await client.callTool({ name: 'get_document', arguments: { id: 'doc-42' } });
    assert.equal(capturedId, 'doc-42');
  } finally {
    await cleanup();
  }
});

test('get_document: returns document as JSON', async () => {
  const { client, cleanup } = await setup({ getDocument: async () => DOC_1 });
  try {
    const result = await client.callTool({ name: 'get_document', arguments: { id: 'doc-1' } });
    assert.ok(!result.isError);
    const content = result.content as Array<{ type: string; text: string }>;
    const doc = JSON.parse(content[0].text) as Document;
    assert.equal(doc.id, 'doc-1');
    assert.equal(doc.canonical_uri, 'chittycanon://evidence/doc-1');
  } finally {
    await cleanup();
  }
});

test('get_document: missing id → isError', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'get_document', arguments: {} });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('"id"'));
  } finally {
    await cleanup();
  }
});

// ── search_documents ──────────────────────────────────────────────────────────

test('search_documents: passes query and optional fields to client', async () => {
  let capturedQuery = '';
  let capturedKind: string | undefined;
  let capturedLimit: number | undefined;
  const { client, cleanup } = await setup({
    searchDocuments: async (query, kind, limit) => {
      capturedQuery = query;
      capturedKind = kind;
      capturedLimit = limit;
      return { documents: [], total: 0 };
    },
  });
  try {
    await client.callTool({ name: 'search_documents', arguments: { query: 'deployment', kind: 'note', limit: 5 } });
    assert.equal(capturedQuery, 'deployment');
    assert.equal(capturedKind, 'note');
    assert.equal(capturedLimit, 5);
  } finally {
    await cleanup();
  }
});

test('search_documents: returns results as JSON', async () => {
  const { client, cleanup } = await setup({
    searchDocuments: async () => ({ documents: [DOC_1], total: 1 }),
  });
  try {
    const result = await client.callTool({ name: 'search_documents', arguments: { query: 'meeting' } });
    assert.ok(!result.isError);
    const content = result.content as Array<{ type: string; text: string }>;
    const body = JSON.parse(content[0].text) as SearchDocumentsResult;
    assert.equal(body.total, 1);
    assert.equal(body.documents[0].id, 'doc-1');
  } finally {
    await cleanup();
  }
});

test('search_documents: missing query → isError', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'search_documents', arguments: {} });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('"query"'));
  } finally {
    await cleanup();
  }
});

// ── get_canonical_uri ─────────────────────────────────────────────────────────

test('get_canonical_uri: passes id to client', async () => {
  let capturedId = '';
  const { client, cleanup } = await setup({
    getCanonicalUri: async (id) => { capturedId = id; return { id, canonical_uri: `chittycanon://evidence/${id}` }; },
  });
  try {
    await client.callTool({ name: 'get_canonical_uri', arguments: { id: 'doc-99' } });
    assert.equal(capturedId, 'doc-99');
  } finally {
    await cleanup();
  }
});

test('get_canonical_uri: returns canonical URI data as JSON', async () => {
  const { client, cleanup } = await setup({
    getCanonicalUri: async (id) => ({ id, canonical_uri: 'chittycanon://evidence/doc-99' }),
  });
  try {
    const result = await client.callTool({ name: 'get_canonical_uri', arguments: { id: 'doc-99' } });
    assert.ok(!result.isError);
    const content = result.content as Array<{ type: string; text: string }>;
    const body = JSON.parse(content[0].text) as { id: string; canonical_uri: string };
    assert.equal(body.id, 'doc-99');
    assert.equal(body.canonical_uri, 'chittycanon://evidence/doc-99');
  } finally {
    await cleanup();
  }
});

test('get_canonical_uri: missing id → isError', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'get_canonical_uri', arguments: {} });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('"id"'));
  } finally {
    await cleanup();
  }
});

// ── Error handling ────────────────────────────────────────────────────────────

test('unknown tool: returns isError=true with message', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'nonexistent_tool', arguments: {} });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('Unknown tool'));
  } finally {
    await cleanup();
  }
});

test('client error: propagates as isError=true text response', async () => {
  const { client, cleanup } = await setup({
    getDocument: async () => { throw new Error('evidence API GET /api/evidence/documents/bad → 404: not found'); },
  });
  try {
    const result = await client.callTool({ name: 'get_document', arguments: { id: 'bad' } });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('404'));
  } finally {
    await cleanup();
  }
});

test('client error: non-Error thrown captured as string', async () => {
  const { client, cleanup } = await setup({
    listDocuments: async () => { throw 'network timeout'; },
  });
  try {
    const result = await client.callTool({ name: 'list_documents', arguments: {} });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('network timeout'));
  } finally {
    await cleanup();
  }
});

test('ingest_document error: surfaces in isError response', async () => {
  const { client, cleanup } = await setup({
    ingestDocument: async () => { throw new Error('evidence API POST → 422: content too large'); },
  });
  try {
    const result = await client.callTool({ name: 'ingest_document', arguments: { content: 'x', kind: 'note' } });
    assert.equal(result.isError, true);
    const content = result.content as Array<{ type: string; text: string }>;
    assert.ok(content[0].text.includes('422'));
  } finally {
    await cleanup();
  }
});
