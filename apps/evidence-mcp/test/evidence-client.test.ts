import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EvidenceClient } from '../src/evidence-client.ts';

const FIXTURE_DOCS = [
  {
    id: 'doc1',
    canonical_uri: 'chittycanon://evidence/doc1',
    kind: 'report',
    title: 'Q1 Analysis',
    content: 'Revenue grew 15% in Q1.',
    tags: ['finance', 'quarterly'],
    metadata: { author: 'user:u1' },
    created_at: '2026-01-10T09:00:00Z',
  },
  {
    id: 'doc2',
    canonical_uri: 'chittycanon://evidence/doc2',
    kind: 'note',
    title: 'Architecture decision',
    content: 'We chose MCP over REST for inter-service comms.',
    tags: ['architecture'],
    created_at: '2026-02-01T14:00:00Z',
  },
];

let fixtureServer: http.Server;
let baseUrl: string;
let lastAuthHeader: string | undefined;
let lastRequestBody: string | undefined;

before(async () => {
  fixtureServer = http.createServer((req, res) => {
    lastAuthHeader = req.headers['authorization'];
    const url = new URL(req.url!, 'http://localhost');
    res.setHeader('Content-Type', 'application/json');

    const readBody = (): Promise<string> =>
      new Promise((resolve) => {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => resolve(body));
      });

    (async () => {
      // POST /api/evidence/documents — ingest
      if (req.method === 'POST' && url.pathname === '/api/evidence/documents') {
        const body = await readBody();
        lastRequestBody = body;
        const input = JSON.parse(body) as Record<string, unknown>;
        const created = {
          id: 'doc_new',
          canonical_uri: 'chittycanon://evidence/doc_new',
          created_at: '2026-03-01T00:00:00Z',
          ...input,
        };
        res.writeHead(201);
        res.end(JSON.stringify(created));

      // GET /api/evidence/documents/search
      } else if (req.method === 'GET' && url.pathname === '/api/evidence/documents/search') {
        const q = url.searchParams.get('q') ?? '';
        const kind = url.searchParams.get('kind');
        let docs = FIXTURE_DOCS.filter(d => d.content.toLowerCase().includes(q.toLowerCase()));
        if (kind) docs = docs.filter(d => d.kind === kind);
        res.end(JSON.stringify({ documents: docs, total: docs.length }));

      // GET /api/evidence/documents/:id
      } else if (req.method === 'GET' && /^\/api\/evidence\/documents\/[^/]+$/.test(url.pathname)) {
        const id = decodeURIComponent(url.pathname.split('/').pop()!);
        const doc = FIXTURE_DOCS.find(d => d.id === id);
        if (doc) {
          res.end(JSON.stringify(doc));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'document not found' }));
        }

      // GET /api/evidence/documents — list
      } else if (req.method === 'GET' && url.pathname === '/api/evidence/documents') {
        const kind = url.searchParams.get('kind');
        const tag = url.searchParams.get('tag');
        const since = url.searchParams.get('since');
        const limit = url.searchParams.get('limit');
        let docs = [...FIXTURE_DOCS];
        if (kind) docs = docs.filter(d => d.kind === kind);
        if (tag) docs = docs.filter(d => d.tags?.includes(tag));
        if (since) docs = docs.filter(d => d.created_at > since);
        if (limit) docs = docs.slice(0, Number(limit));
        res.end(JSON.stringify({ documents: docs, has_more: false }));

      // GET /api/evidence/canonical/:id
      } else if (req.method === 'GET' && /^\/api\/evidence\/canonical\/[^/]+$/.test(url.pathname)) {
        const id = decodeURIComponent(url.pathname.split('/').pop()!);
        const doc = FIXTURE_DOCS.find(d => d.id === id);
        if (doc) {
          res.end(JSON.stringify({ id: doc.id, canonical_uri: doc.canonical_uri }));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'document not found' }));
        }

      } else {
        res.writeHead(404);
        res.end('{}');
      }
    })().catch(() => { res.writeHead(500); res.end('{}'); });
  });

  await new Promise<void>(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  const addr = fixtureServer.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    fixtureServer.close(err => (err ? reject(err) : resolve()))
  );
});

describe('EvidenceClient', () => {
  it('ingests a document and returns canonical URI', async () => {
    const client = new EvidenceClient(baseUrl, 'test-token');
    const doc = await client.ingestDocument({
      content: 'New evidence document.',
      kind: 'note',
      title: 'My Note',
    });
    assert.equal(doc.id, 'doc_new');
    assert.ok(doc.canonical_uri.startsWith('chittycanon://'));
  });

  it('ingest sends content, kind, title, tags, metadata in body', async () => {
    lastRequestBody = undefined;
    const client = new EvidenceClient(baseUrl, 'test-token');
    await client.ingestDocument({
      content: 'Evidence content',
      kind: 'spec',
      title: 'Spec Doc',
      tags: ['infra'],
      metadata: { author: 'user:u2' },
    });
    const sent = JSON.parse(lastRequestBody!) as Record<string, unknown>;
    assert.equal(sent['content'], 'Evidence content');
    assert.equal(sent['kind'], 'spec');
    assert.equal(sent['title'], 'Spec Doc');
    assert.deepEqual(sent['tags'], ['infra']);
    assert.deepEqual(sent['metadata'], { author: 'user:u2' });
  });

  it('lists all documents without filters', async () => {
    const client = new EvidenceClient(baseUrl, 'test-token');
    const result = await client.listDocuments();
    assert.equal(result.documents.length, 2);
    assert.equal(result.has_more, false);
  });

  it('filters list by kind', async () => {
    const client = new EvidenceClient(baseUrl, 'test-token');
    const result = await client.listDocuments({ kind: 'report' });
    assert.equal(result.documents.length, 1);
    assert.equal(result.documents[0].id, 'doc1');
  });

  it('filters list by tag', async () => {
    const client = new EvidenceClient(baseUrl, 'test-token');
    const result = await client.listDocuments({ tag: 'finance' });
    assert.equal(result.documents.length, 1);
    assert.equal(result.documents[0].id, 'doc1');
  });

  it('filters list by since timestamp', async () => {
    const client = new EvidenceClient(baseUrl, 'test-token');
    const result = await client.listDocuments({ since: '2026-01-15T00:00:00Z' });
    assert.equal(result.documents.length, 1);
    assert.equal(result.documents[0].id, 'doc2');
  });

  it('respects limit on list_documents', async () => {
    const client = new EvidenceClient(baseUrl, 'test-token');
    const result = await client.listDocuments({ limit: 1 });
    assert.equal(result.documents.length, 1);
  });

  it('gets a single document by id', async () => {
    const client = new EvidenceClient(baseUrl, 'test-token');
    const doc = await client.getDocument('doc1');
    assert.equal(doc.id, 'doc1');
    assert.equal(doc.kind, 'report');
    assert.equal(doc.canonical_uri, 'chittycanon://evidence/doc1');
  });

  it('rejects a missing document with 404 error', async () => {
    const client = new EvidenceClient(baseUrl, 'test-token');
    await assert.rejects(() => client.getDocument('nonexistent'), /404/);
  });

  it('searches documents by keyword', async () => {
    const client = new EvidenceClient(baseUrl, 'test-token');
    const result = await client.searchDocuments('Revenue');
    assert.equal(result.documents.length, 1);
    assert.equal(result.documents[0].id, 'doc1');
    assert.equal(result.total, 1);
  });

  it('search with kind filter narrows results', async () => {
    const client = new EvidenceClient(baseUrl, 'test-token');
    const result = await client.searchDocuments('MCP', 'note');
    assert.equal(result.documents.length, 1);
    assert.equal(result.documents[0].id, 'doc2');
  });

  it('search returns empty when no match', async () => {
    const client = new EvidenceClient(baseUrl, 'test-token');
    const result = await client.searchDocuments('zzznomatch');
    assert.equal(result.documents.length, 0);
    assert.equal(result.total, 0);
  });

  it('resolves canonical URI by document id', async () => {
    const client = new EvidenceClient(baseUrl, 'test-token');
    const resolved = await client.getCanonicalUri('doc1');
    assert.equal(resolved.id, 'doc1');
    assert.equal(resolved.canonical_uri, 'chittycanon://evidence/doc1');
  });

  it('rejects canonical URI lookup for missing document with 404', async () => {
    const client = new EvidenceClient(baseUrl, 'test-token');
    await assert.rejects(() => client.getCanonicalUri('nonexistent'), /404/);
  });

  it('sends Authorization header when token is provided', async () => {
    const client = new EvidenceClient(baseUrl, 'my-evidence-token');
    await client.listDocuments();
    assert.equal(lastAuthHeader, 'Bearer my-evidence-token');
  });

  it('omits Authorization header when no token is set', async () => {
    const saved = process.env['CHITTY_EVIDENCE_TOKEN'];
    delete process.env['CHITTY_EVIDENCE_TOKEN'];
    const client = new EvidenceClient(baseUrl, undefined);
    await client.listDocuments();
    assert.equal(lastAuthHeader, undefined);
    if (saved !== undefined) process.env['CHITTY_EVIDENCE_TOKEN'] = saved;
  });

  it('reads CHITTY_EVIDENCE_URL from environment', () => {
    process.env['CHITTY_EVIDENCE_URL'] = baseUrl;
    const client = new EvidenceClient();
    assert.equal((client as unknown as { baseUrl: string }).baseUrl, baseUrl);
    delete process.env['CHITTY_EVIDENCE_URL'];
  });

  it('reads CHITTY_EVIDENCE_TOKEN from environment', async () => {
    process.env['CHITTY_EVIDENCE_TOKEN'] = 'env-evidence-token';
    const client = new EvidenceClient(baseUrl);
    await client.listDocuments();
    assert.equal(lastAuthHeader, 'Bearer env-evidence-token');
    delete process.env['CHITTY_EVIDENCE_TOKEN'];
  });
});
