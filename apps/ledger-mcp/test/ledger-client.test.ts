import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { LedgerClient } from '../src/ledger-client.ts';

const NS = 'events';

const FIXTURE_NAMESPACES = [
  { name: 'events', entry_count: 2, created_at: '2026-01-01T00:00:00Z', last_entry_at: '2026-01-02T00:00:00Z' },
  { name: 'audit', entry_count: 0, created_at: '2026-01-01T00:00:00Z' },
];

const FIXTURE_ENTRIES = [
  {
    id: 'e1',
    namespace: NS,
    payload: { type: 'user.created', user_id: 'u1' },
    metadata: { actor: 'system' },
    sequence: 1,
    created_at: '2026-01-01T10:00:00Z',
  },
  {
    id: 'e2',
    namespace: NS,
    payload: { type: 'user.updated', user_id: 'u1' },
    sequence: 2,
    created_at: '2026-01-02T10:00:00Z',
  },
];

let fixtureServer: http.Server;
let baseUrl: string;
let lastAuthHeader: string | undefined;
let appendedBodies: string[] = [];

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
      // GET /api/ledger/namespaces
      if (req.method === 'GET' && url.pathname === '/api/ledger/namespaces') {
        res.end(JSON.stringify(FIXTURE_NAMESPACES));

      // GET /api/ledger/:ns/entries
      } else if (req.method === 'GET' && /^\/api\/ledger\/[^/]+\/entries$/.test(url.pathname)) {
        const limitParam = url.searchParams.get('limit');
        const sinceParam = url.searchParams.get('since');
        let entries = [...FIXTURE_ENTRIES];
        if (sinceParam) entries = entries.filter(e => e.created_at > sinceParam);
        if (limitParam) entries = entries.slice(0, Number(limitParam));
        res.end(JSON.stringify({ entries, has_more: false }));

      // GET /api/ledger/:ns/entries/:id
      } else if (req.method === 'GET' && /^\/api\/ledger\/[^/]+\/entries\/[^/]+$/.test(url.pathname)) {
        const parts = url.pathname.split('/');
        const id = decodeURIComponent(parts[parts.length - 1]);
        const entry = FIXTURE_ENTRIES.find(e => e.id === id);
        if (entry) {
          res.end(JSON.stringify(entry));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'entry not found' }));
        }

      // POST /api/ledger/:ns/entries
      } else if (req.method === 'POST' && /^\/api\/ledger\/[^/]+\/entries$/.test(url.pathname)) {
        const body = await readBody();
        appendedBodies.push(body);
        const input = JSON.parse(body) as Record<string, unknown>;
        const created = {
          id: 'e_new',
          namespace: NS,
          sequence: FIXTURE_ENTRIES.length + 1,
          created_at: '2026-01-03T00:00:00Z',
          ...input,
        };
        res.writeHead(201);
        res.end(JSON.stringify(created));

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

describe('LedgerClient', () => {
  it('lists all namespaces', async () => {
    const client = new LedgerClient(baseUrl, 'test-token');
    const ns = await client.listNamespaces();
    assert.equal(ns.length, 2);
    assert.equal(ns[0].name, 'events');
    assert.equal(ns[0].entry_count, 2);
    assert.equal(ns[1].name, 'audit');
  });

  it('lists all entries in a namespace', async () => {
    const client = new LedgerClient(baseUrl, 'test-token');
    const result = await client.listEntries(NS);
    assert.equal(result.entries.length, 2);
    assert.equal(result.has_more, false);
    assert.equal(result.entries[0].id, 'e1');
  });

  it('filters entries by since timestamp', async () => {
    const client = new LedgerClient(baseUrl, 'test-token');
    const result = await client.listEntries(NS, { since: '2026-01-01T12:00:00Z' });
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].id, 'e2');
  });

  it('respects limit on list_entries', async () => {
    const client = new LedgerClient(baseUrl, 'test-token');
    const result = await client.listEntries(NS, { limit: 1 });
    assert.equal(result.entries.length, 1);
  });

  it('gets a single entry by id', async () => {
    const client = new LedgerClient(baseUrl, 'test-token');
    const entry = await client.getEntry(NS, 'e1');
    assert.equal(entry.id, 'e1');
    assert.equal(entry.sequence, 1);
    assert.deepEqual(entry.payload, { type: 'user.created', user_id: 'u1' });
  });

  it('rejects a missing entry with 404 error', async () => {
    const client = new LedgerClient(baseUrl, 'test-token');
    await assert.rejects(() => client.getEntry(NS, 'nonexistent'), /404/);
  });

  it('appends an entry with payload only', async () => {
    appendedBodies = [];
    const client = new LedgerClient(baseUrl, 'test-token');
    const entry = await client.appendEntry(NS, { payload: { type: 'test.event', value: 42 } });
    assert.equal(entry.id, 'e_new');
    assert.equal(appendedBodies.length, 1);
    const sent = JSON.parse(appendedBodies[0]) as Record<string, unknown>;
    assert.deepEqual(sent['payload'], { type: 'test.event', value: 42 });
  });

  it('appends an entry with payload and metadata', async () => {
    appendedBodies = [];
    const client = new LedgerClient(baseUrl, 'test-token');
    await client.appendEntry(NS, {
      payload: { type: 'order.placed', order_id: 'o1' },
      metadata: { actor: 'user:u2', correlation_id: 'c99' },
    });
    const sent = JSON.parse(appendedBodies[0]) as Record<string, unknown>;
    assert.deepEqual(sent['metadata'], { actor: 'user:u2', correlation_id: 'c99' });
  });

  it('sends Authorization header when token is provided', async () => {
    const client = new LedgerClient(baseUrl, 'my-ledger-token');
    await client.listNamespaces();
    assert.equal(lastAuthHeader, 'Bearer my-ledger-token');
  });

  it('omits Authorization header when no token is set', async () => {
    const saved = process.env['CHITTY_LEDGER_TOKEN'];
    delete process.env['CHITTY_LEDGER_TOKEN'];
    const client = new LedgerClient(baseUrl, undefined);
    await client.listNamespaces();
    assert.equal(lastAuthHeader, undefined);
    if (saved !== undefined) process.env['CHITTY_LEDGER_TOKEN'] = saved;
  });

  it('reads CHITTY_LEDGER_URL from environment', () => {
    process.env['CHITTY_LEDGER_URL'] = baseUrl;
    const client = new LedgerClient();
    assert.equal((client as unknown as { baseUrl: string }).baseUrl, baseUrl);
    delete process.env['CHITTY_LEDGER_URL'];
  });

  it('reads CHITTY_LEDGER_TOKEN from environment', async () => {
    process.env['CHITTY_LEDGER_TOKEN'] = 'env-ledger-token';
    const client = new LedgerClient(baseUrl);
    await client.listNamespaces();
    assert.equal(lastAuthHeader, 'Bearer env-ledger-token');
    delete process.env['CHITTY_LEDGER_TOKEN'];
  });

  it('passes cursor parameter in list_entries', async () => {
    const client = new LedgerClient(baseUrl, 'test-token');
    // cursor is forwarded as a query param; fixture doesn't filter by cursor but verifies no error
    const result = await client.listEntries(NS, { cursor: 'cursor-abc' });
    assert.ok(Array.isArray(result.entries));
  });
});
