/**
 * Workstream T: freeze evidence-mcp tool response required key presence and value types.
 *
 * Tests that each evidence-mcp tool response includes all required keys with the
 * correct value types. Optional fields (title, content, tags, metadata, updated_at,
 * next_cursor) are not asserted here — only required presence and types are frozen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createEvidenceServer } from '../src/server.ts';
import type {
  EvidenceClient,
  Document,
  IngestDocumentInput,
  ListDocumentsFilter,
  ListDocumentsResult,
  SearchDocumentsResult,
} from '../src/evidence-client.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DOC_FIXTURE: Document = {
  id: 'doc-t-001',
  canonical_uri: 'chittycanon://evidence/docs/doc-t-001',
  kind: 'note',
  created_at: '2026-01-01T00:00:00Z',
};

const LIST_RESULT_FIXTURE: ListDocumentsResult = {
  documents: [DOC_FIXTURE],
  has_more: false,
};

const SEARCH_RESULT_FIXTURE: SearchDocumentsResult = {
  documents: [DOC_FIXTURE],
  total: 1,
};

// ── Mock client ───────────────────────────────────────────────────────────────

function makeMockClient(overrides: Partial<EvidenceClient> = {}): EvidenceClient {
  return {
    ingestDocument: async (_input: IngestDocumentInput) => ({ ...DOC_FIXTURE, id: 'doc-t-new' }),
    listDocuments: async (_filter?: ListDocumentsFilter) => LIST_RESULT_FIXTURE,
    getDocument: async (_id: string) => DOC_FIXTURE,
    searchDocuments: async (_query: string) => SEARCH_RESULT_FIXTURE,
    getCanonicalUri: async (_id: string) => ({ id: DOC_FIXTURE.id, canonical_uri: DOC_FIXTURE.canonical_uri }),
    ...overrides,
  } as unknown as EvidenceClient;
}

// ── Harness ───────────────────────────────────────────────────────────────────

async function setup(overrides?: Partial<EvidenceClient>): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const server = createEvidenceServer(makeMockClient(overrides));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: 'test-t-freeze', version: '1.0.0' }, { capabilities: {} });
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  return { client: mcpClient, cleanup: async () => { await mcpClient.close(); } };
}

function parseText<T>(result: Awaited<ReturnType<Client['callTool']>>): T {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text) as T;
}

// ── T-1: ingest_document — Document required keys ────────────────────────────

test('T-1: ingest_document returns Document with required keys {id, canonical_uri, kind, created_at}', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({
      name: 'ingest_document',
      arguments: { content: 'test content', kind: 'note' },
    });
    assert.ok(!result.isError, 'expected success');
    const doc = parseText<Document>(result);
    for (const k of ['id', 'canonical_uri', 'kind', 'created_at']) {
      assert.ok(Object.prototype.hasOwnProperty.call(doc, k), `Document missing required key: ${k}`);
    }
  } finally {
    await cleanup();
  }
});

// ── T-2: ingest_document — Document field value types ────────────────────────

test('T-2: ingest_document Document field value types: id, canonical_uri, kind, created_at all strings', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({
      name: 'ingest_document',
      arguments: { content: 'test content', kind: 'note' },
    });
    assert.ok(!result.isError, 'expected success');
    const doc = parseText<Document>(result);
    for (const k of ['id', 'canonical_uri', 'kind', 'created_at']) {
      assert.equal(typeof (doc as Record<string, unknown>)[k], 'string', `${k} must be string`);
    }
  } finally {
    await cleanup();
  }
});

// ── T-3: list_documents — ListDocumentsResult required keys ──────────────────

test('T-3: list_documents returns ListDocumentsResult with required keys {documents, has_more}', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'list_documents', arguments: {} });
    assert.ok(!result.isError, 'expected success');
    const res = parseText<ListDocumentsResult>(result);
    assert.ok(Object.prototype.hasOwnProperty.call(res, 'documents'), 'missing key: documents');
    assert.ok(Object.prototype.hasOwnProperty.call(res, 'has_more'), 'missing key: has_more');
  } finally {
    await cleanup();
  }
});

// ── T-4: list_documents — field types ────────────────────────────────────────

test('T-4: list_documents documents is array, has_more is boolean', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'list_documents', arguments: {} });
    assert.ok(!result.isError, 'expected success');
    const res = parseText<ListDocumentsResult>(result);
    assert.ok(Array.isArray(res.documents), 'documents must be array');
    assert.equal(typeof res.has_more, 'boolean', 'has_more must be boolean');
  } finally {
    await cleanup();
  }
});

// ── T-5: get_document — Document required keys ───────────────────────────────

test('T-5: get_document returns Document with required keys {id, canonical_uri, kind, created_at} all strings', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'get_document', arguments: { id: 'doc-t-001' } });
    assert.ok(!result.isError, 'expected success');
    const doc = parseText<Document>(result);
    for (const k of ['id', 'canonical_uri', 'kind', 'created_at']) {
      assert.ok(Object.prototype.hasOwnProperty.call(doc, k), `Document missing required key: ${k}`);
      assert.equal(typeof (doc as Record<string, unknown>)[k], 'string', `${k} must be string`);
    }
  } finally {
    await cleanup();
  }
});

// ── T-6: search_documents — SearchDocumentsResult required keys ───────────────

test('T-6: search_documents returns SearchDocumentsResult with required keys {documents, total}', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'search_documents', arguments: { query: 'test' } });
    assert.ok(!result.isError, 'expected success');
    const res = parseText<SearchDocumentsResult>(result);
    assert.ok(Object.prototype.hasOwnProperty.call(res, 'documents'), 'missing key: documents');
    assert.ok(Object.prototype.hasOwnProperty.call(res, 'total'), 'missing key: total');
  } finally {
    await cleanup();
  }
});

// ── T-7: search_documents — field types ──────────────────────────────────────

test('T-7: search_documents documents is array, total is number', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'search_documents', arguments: { query: 'test' } });
    assert.ok(!result.isError, 'expected success');
    const res = parseText<SearchDocumentsResult>(result);
    assert.ok(Array.isArray(res.documents), 'documents must be array');
    assert.equal(typeof res.total, 'number', 'total must be number');
  } finally {
    await cleanup();
  }
});

// ── T-8: get_canonical_uri — {id, canonical_uri} strings ─────────────────────

test('T-8: get_canonical_uri returns {id, canonical_uri} with both as strings', async () => {
  const { client, cleanup } = await setup();
  try {
    const result = await client.callTool({ name: 'get_canonical_uri', arguments: { id: 'doc-t-001' } });
    assert.ok(!result.isError, 'expected success');
    const res = parseText<{ id: string; canonical_uri: string }>(result);
    assert.ok(Object.prototype.hasOwnProperty.call(res, 'id'), 'missing key: id');
    assert.ok(Object.prototype.hasOwnProperty.call(res, 'canonical_uri'), 'missing key: canonical_uri');
    assert.equal(typeof res.id, 'string', 'id must be string');
    assert.equal(typeof res.canonical_uri, 'string', 'canonical_uri must be string');
  } finally {
    await cleanup();
  }
});
