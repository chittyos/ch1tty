/**
 * test(BC): session-client.ts HTTP method coverage — 7 tests
 *
 * The main suite imports SessionClient only for default-URL + 204 checks.
 * The HTTP methods (request, headers, listSessions, getSession, createSession,
 * closeSession, appendEvent, listEvents) are untested from this suite.
 *
 * Branches covered here that were previously uncovered:
 *  - headers(): if (this.token) → Authorization header set  (line 65 true)
 *  - request(): body !== undefined → JSON.stringify(body)   (line 73 true)
 *  - request(): body === undefined → no body                (line 73 false)
 *  - request(): if (!res.ok) → throw with status            (lines 75-77)
 *  - listSessions(): all four params.set branches           (lines 85-88)
 *  - getSession(), createSession(), closeSession()
 *  - appendEvent(), listEvents() with cursor+limit opts
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { SessionClient } from '../apps/session-coordinator-mcp/src/session-client.ts';

const FIXTURE_SESSION = {
  id: 's1', channel: 'test', user_id: 'u1', status: 'active' as const,
  context: {}, event_count: 0,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
};

const FIXTURE_EVENT = {
  id: 'ev1', session_id: 's1', type: 'state.transition',
  created_at: '2026-01-01T00:01:00Z',
};

let server: http.Server;
let baseUrl: string;

before(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const url = new URL(req.url!, 'http://localhost');

    if (url.pathname === '/api/sessions/notfound') {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions') {
      res.writeHead(201); res.end(JSON.stringify(FIXTURE_SESSION)); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions/s1/close') {
      res.end(JSON.stringify({ ...FIXTURE_SESSION, status: 'closed' })); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions/s1/events') {
      res.writeHead(201); res.end(JSON.stringify(FIXTURE_EVENT)); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/sessions/s1/events') {
      res.end(JSON.stringify({ events: [FIXTURE_EVENT], has_more: false })); return;
    }
    if (req.method === 'GET' && /^\/api\/sessions\/[^/]+$/.test(url.pathname)) {
      res.end(JSON.stringify(FIXTURE_SESSION)); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      res.end(JSON.stringify([FIXTURE_SESSION])); return;
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close(err => (err ? reject(err) : resolve()))
  );
});

describe('SessionClient HTTP methods', () => {
  it('listSessions — covers headers(token) true branch and GET path (no body)', async () => {
    const client = new SessionClient(baseUrl, 'test-token');
    const sessions = await client.listSessions();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, 's1');
  });

  it('listSessions with filter — covers all four params.set branches', async () => {
    const client = new SessionClient(baseUrl, 'tok');
    const sessions = await client.listSessions({ channel: 'test', status: 'active', limit: 5, user_id: 'u1' });
    assert.equal(sessions.length, 1);
  });

  it('getSession not-found → throws with status in message (request non-ok branch)', async () => {
    const client = new SessionClient(baseUrl, 'tok');
    await assert.rejects(() => client.getSession('notfound'), /404/);
  });

  it('createSession sends body — covers body !== undefined branch in request()', async () => {
    const client = new SessionClient(baseUrl, 'tok');
    const session = await client.createSession({ channel: 'test' });
    assert.equal(session.id, 's1');
    assert.equal(session.status, 'active');
  });

  it('closeSession returns closed session', async () => {
    const client = new SessionClient(baseUrl, 'tok');
    const session = await client.closeSession('s1');
    assert.equal(session.status, 'closed');
  });

  it('appendEvent returns created event', async () => {
    const client = new SessionClient(baseUrl, 'tok');
    const event = await client.appendEvent('s1', { type: 'state.transition' });
    assert.equal(event.id, 'ev1');
    assert.equal(event.session_id, 's1');
  });

  it('listEvents with cursor + limit — covers opts.cursor and opts.limit branches', async () => {
    const client = new SessionClient(baseUrl, 'tok');
    const result = await client.listEvents('s1', { cursor: 'page2', limit: 5 });
    assert.equal(result.events.length, 1);
    assert.equal(result.has_more, false);
  });
});
