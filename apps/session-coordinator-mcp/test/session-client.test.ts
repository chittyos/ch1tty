import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { SessionClient } from '../src/session-client.ts';

const FIXTURE_SESSIONS = [
  {
    id: 's1',
    channel: 'claude-code',
    user_id: 'u1',
    status: 'active',
    context: { project: 'ch1tty' },
    event_count: 3,
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-01T11:00:00Z',
  },
  {
    id: 's2',
    channel: 'slack',
    user_id: 'u2',
    status: 'idle',
    context: {},
    event_count: 0,
    created_at: '2026-01-02T08:00:00Z',
    updated_at: '2026-01-02T08:00:00Z',
  },
];

const FIXTURE_EVENTS = [
  {
    id: 'ev1',
    session_id: 's1',
    type: 'user.message',
    payload: { text: 'hello' },
    actor: 'user:u1',
    created_at: '2026-01-01T10:05:00Z',
  },
  {
    id: 'ev2',
    session_id: 's1',
    type: 'agent.tool_call',
    payload: { tool: 'search', query: 'neon' },
    actor: 'agent:claude',
    created_at: '2026-01-01T10:06:00Z',
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
      // GET /api/sessions
      if (req.method === 'GET' && url.pathname === '/api/sessions') {
        let sessions = [...FIXTURE_SESSIONS];
        const channel = url.searchParams.get('channel');
        const userId = url.searchParams.get('user_id');
        const status = url.searchParams.get('status');
        const limit = url.searchParams.get('limit');
        if (channel) sessions = sessions.filter(s => s.channel === channel);
        if (userId) sessions = sessions.filter(s => s.user_id === userId);
        if (status) sessions = sessions.filter(s => s.status === status);
        if (limit) sessions = sessions.slice(0, Number(limit));
        res.end(JSON.stringify(sessions));

      // GET /api/sessions/:id
      } else if (req.method === 'GET' && /^\/api\/sessions\/[^/]+$/.test(url.pathname)) {
        const id = decodeURIComponent(url.pathname.split('/').pop()!);
        const session = FIXTURE_SESSIONS.find(s => s.id === id);
        if (session) {
          res.end(JSON.stringify(session));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'session not found' }));
        }

      // POST /api/sessions
      } else if (req.method === 'POST' && url.pathname === '/api/sessions') {
        const body = await readBody();
        lastRequestBody = body;
        const input = JSON.parse(body) as Record<string, unknown>;
        const created = {
          id: 's_new',
          status: 'active',
          event_count: 0,
          created_at: '2026-05-01T00:00:00Z',
          updated_at: '2026-05-01T00:00:00Z',
          ...input,
        };
        res.writeHead(201);
        res.end(JSON.stringify(created));

      // PATCH /api/sessions/:id
      } else if (req.method === 'PATCH' && /^\/api\/sessions\/[^/]+$/.test(url.pathname)) {
        const id = decodeURIComponent(url.pathname.split('/').pop()!);
        const body = await readBody();
        lastRequestBody = body;
        const patch = JSON.parse(body) as Record<string, unknown>;
        const session = FIXTURE_SESSIONS.find(s => s.id === id);
        if (session) {
          res.end(JSON.stringify({ ...session, ...patch, updated_at: '2026-05-01T01:00:00Z' }));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'session not found' }));
        }

      // POST /api/sessions/:id/close
      } else if (req.method === 'POST' && /^\/api\/sessions\/[^/]+\/close$/.test(url.pathname)) {
        const parts = url.pathname.split('/');
        const id = decodeURIComponent(parts[parts.length - 2]);
        const session = FIXTURE_SESSIONS.find(s => s.id === id);
        if (session) {
          res.end(JSON.stringify({ ...session, status: 'closed', closed_at: '2026-05-01T02:00:00Z' }));
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'session not found' }));
        }

      // POST /api/sessions/:id/events
      } else if (req.method === 'POST' && /^\/api\/sessions\/[^/]+\/events$/.test(url.pathname)) {
        const parts = url.pathname.split('/');
        const sessionId = decodeURIComponent(parts[parts.length - 2]);
        const body = await readBody();
        lastRequestBody = body;
        const input = JSON.parse(body) as Record<string, unknown>;
        const event = {
          id: 'ev_new',
          session_id: sessionId,
          created_at: '2026-05-01T03:00:00Z',
          ...input,
        };
        res.writeHead(201);
        res.end(JSON.stringify(event));

      // GET /api/sessions/:id/events
      } else if (req.method === 'GET' && /^\/api\/sessions\/[^/]+\/events$/.test(url.pathname)) {
        const parts = url.pathname.split('/');
        const sessionId = decodeURIComponent(parts[parts.length - 2]);
        let events = FIXTURE_EVENTS.filter(e => e.session_id === sessionId);
        const limit = url.searchParams.get('limit');
        if (limit) events = events.slice(0, Number(limit));
        res.end(JSON.stringify({ events, has_more: false }));

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

describe('SessionClient', () => {
  it('lists all sessions', async () => {
    const client = new SessionClient(baseUrl, 'test-token');
    const sessions = await client.listSessions();
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].id, 's1');
    assert.equal(sessions[0].channel, 'claude-code');
  });

  it('filters sessions by channel', async () => {
    const client = new SessionClient(baseUrl, 'test-token');
    const sessions = await client.listSessions({ channel: 'slack' });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, 's2');
  });

  it('filters sessions by user_id', async () => {
    const client = new SessionClient(baseUrl, 'test-token');
    const sessions = await client.listSessions({ user_id: 'u1' });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].channel, 'claude-code');
  });

  it('filters sessions by status', async () => {
    const client = new SessionClient(baseUrl, 'test-token');
    const sessions = await client.listSessions({ status: 'idle' });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, 's2');
  });

  it('respects limit on list_sessions', async () => {
    const client = new SessionClient(baseUrl, 'test-token');
    const sessions = await client.listSessions({ limit: 1 });
    assert.equal(sessions.length, 1);
  });

  it('gets a single session by id', async () => {
    const client = new SessionClient(baseUrl, 'test-token');
    const session = await client.getSession('s1');
    assert.equal(session.id, 's1');
    assert.equal(session.status, 'active');
    assert.deepEqual(session.context, { project: 'ch1tty' });
  });

  it('rejects a missing session with 404 error', async () => {
    const client = new SessionClient(baseUrl, 'test-token');
    await assert.rejects(() => client.getSession('nonexistent'), /404/);
  });

  it('creates a session with channel only', async () => {
    lastRequestBody = undefined;
    const client = new SessionClient(baseUrl, 'test-token');
    const session = await client.createSession({ channel: 'web' });
    assert.equal(session.id, 's_new');
    assert.equal(session.status, 'active');
    const sent = JSON.parse(lastRequestBody!) as Record<string, unknown>;
    assert.equal(sent['channel'], 'web');
  });

  it('creates a session with user_id and context', async () => {
    lastRequestBody = undefined;
    const client = new SessionClient(baseUrl, 'test-token');
    await client.createSession({
      channel: 'slack',
      user_id: 'u3',
      context: { workspace: 'W123' },
    });
    const sent = JSON.parse(lastRequestBody!) as Record<string, unknown>;
    assert.equal(sent['user_id'], 'u3');
    assert.deepEqual(sent['context'], { workspace: 'W123' });
  });

  it('updates session status', async () => {
    lastRequestBody = undefined;
    const client = new SessionClient(baseUrl, 'test-token');
    const updated = await client.updateSession('s1', { status: 'idle' });
    assert.equal(updated.status, 'idle');
    const sent = JSON.parse(lastRequestBody!) as Record<string, unknown>;
    assert.equal(sent['status'], 'idle');
  });

  it('updates session context', async () => {
    lastRequestBody = undefined;
    const client = new SessionClient(baseUrl, 'test-token');
    await client.updateSession('s1', { context: { foo: 'bar' } });
    const sent = JSON.parse(lastRequestBody!) as Record<string, unknown>;
    assert.deepEqual(sent['context'], { foo: 'bar' });
  });

  it('closes a session and returns closed state', async () => {
    const client = new SessionClient(baseUrl, 'test-token');
    const closed = await client.closeSession('s1');
    assert.equal(closed.status, 'closed');
    assert.ok(closed.closed_at);
  });

  it('appends an event with type only', async () => {
    lastRequestBody = undefined;
    const client = new SessionClient(baseUrl, 'test-token');
    const event = await client.appendEvent('s1', { type: 'state.transition' });
    assert.equal(event.id, 'ev_new');
    assert.equal(event.session_id, 's1');
    const sent = JSON.parse(lastRequestBody!) as Record<string, unknown>;
    assert.equal(sent['type'], 'state.transition');
  });

  it('appends an event with payload and actor', async () => {
    lastRequestBody = undefined;
    const client = new SessionClient(baseUrl, 'test-token');
    await client.appendEvent('s1', {
      type: 'agent.tool_call',
      payload: { tool: 'search', query: 'ledger' },
      actor: 'agent:claude',
    });
    const sent = JSON.parse(lastRequestBody!) as Record<string, unknown>;
    assert.deepEqual(sent['payload'], { tool: 'search', query: 'ledger' });
    assert.equal(sent['actor'], 'agent:claude');
  });

  it('lists events for a session', async () => {
    const client = new SessionClient(baseUrl, 'test-token');
    const result = await client.listEvents('s1');
    assert.equal(result.events.length, 2);
    assert.equal(result.has_more, false);
    assert.equal(result.events[0].id, 'ev1');
    assert.equal(result.events[0].type, 'user.message');
  });

  it('respects limit on list_events', async () => {
    const client = new SessionClient(baseUrl, 'test-token');
    const result = await client.listEvents('s1', { limit: 1 });
    assert.equal(result.events.length, 1);
  });

  it('sends Authorization header when token is provided', async () => {
    const client = new SessionClient(baseUrl, 'my-session-token');
    await client.listSessions();
    assert.equal(lastAuthHeader, 'Bearer my-session-token');
  });

  it('omits Authorization header when no token is set', async () => {
    const saved = process.env['CHITTY_SESSION_TOKEN'];
    delete process.env['CHITTY_SESSION_TOKEN'];
    const client = new SessionClient(baseUrl, undefined);
    await client.listSessions();
    assert.equal(lastAuthHeader, undefined);
    if (saved !== undefined) process.env['CHITTY_SESSION_TOKEN'] = saved;
  });

  it('reads CHITTY_SESSION_URL from environment', () => {
    process.env['CHITTY_SESSION_URL'] = baseUrl;
    const client = new SessionClient();
    assert.equal((client as unknown as { baseUrl: string }).baseUrl, baseUrl);
    delete process.env['CHITTY_SESSION_URL'];
  });

  it('reads CHITTY_SESSION_TOKEN from environment', async () => {
    process.env['CHITTY_SESSION_TOKEN'] = 'env-session-token';
    const client = new SessionClient(baseUrl);
    await client.listSessions();
    assert.equal(lastAuthHeader, 'Bearer env-session-token');
    delete process.env['CHITTY_SESSION_TOKEN'];
  });
});
