/**
 * FFF: six previously untested branches across config.ts, remote-proxy.ts,
 *      openclaw-facade.ts, and embedding-brain.ts.
 *
 * 1. config.ts loadConfigFromPath invalid JSON (line 253):
 *    file contains syntactically invalid JSON → throws "Invalid JSON in config at".
 *
 * 2. config.ts validateServersConfig non-object server entry (lines 134-135):
 *    servers array contains null → throws "must be an object".
 *
 * 3. remote-proxy.ts connectWithReconnect reconnect branch (lines 129-132):
 *    connect() throws while a stale connection exists in the map
 *    → stale entry evicted → connect() retried (reconnect path fires).
 *
 * 4. openclaw-facade.ts ch1tty-session persist action (lines 122-123):
 *    POST /openclaw/invoke with action:'persist' → mapArgs routes to
 *    chittyos/chitty_memory_persist (not recall); fixture backend records the call.
 *
 * 5. embedding-brain.ts bad embed response shape (lines 324-330):
 *    Ollama /api/embed returns embeddings that are not an array → errors counter
 *    incremented, route() returns null.
 *
 * 6. embedding-brain.ts non-finite vector element (lines 343-346):
 *    Ollama /api/embed returns an embedding vector containing a non-number value
 *    → errors counter incremented, route() returns null.
 */

import assert from 'node:assert/strict';
import { after } from 'node:test';
import test from 'node:test';
import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';

import { loadConfigFromPath, validateServersConfig } from '../src/config.js';
import { RemoteProxy } from '../src/remote-proxy.js';
import { EmbeddingBrain } from '../src/embedding-brain.js';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// Reduce timeouts so test failures surface quickly
process.env.CH1TTY_REMOTE_TIMEOUT_MS = '3000';

// ── helpers ──────────────────────────────────────────────────────────────────

// Single OS-created temp directory (mkdtempSync is atomic — no TOCTOU race)
const TEMP_DIR = mkdtempSync(join(tmpdir(), 'ch1tty-fff-'));
after(() => rmSync(TEMP_DIR, { recursive: true, force: true }));

let _ctr = 0;
function tmpPath(ext: string): string {
  return join(TEMP_DIR, `${++_ctr}.${ext}`);
}

// ── 1. loadConfigFromPath: invalid JSON → throws ─────────────────────────────

test('loadConfigFromPath: file with invalid JSON → throws "Invalid JSON in config at"', () => {
  const path = tmpPath('json');
  writeFileSync(path, '{ not valid json at all', 'utf-8');
  try {
    assert.throws(
      () => loadConfigFromPath(path),
      /Invalid JSON in config at/,
      'invalid JSON file must throw with "Invalid JSON in config at" prefix',
    );
  } finally {
    rmSync(path, { force: true });
  }
});

// ── 2. validateServersConfig: null server entry → throws ─────────────────────

test('validateServersConfig: null entry in servers array → throws "must be an object"', () => {
  assert.throws(
    () => validateServersConfig({ servers: [null] }),
    /must be an object/,
    'null server entry must throw with "must be an object" message',
  );
});

// ── 3. RemoteProxy.connectWithReconnect: stale-entry reconnect branch ─────────

test('RemoteProxy.connectWithReconnect: stale entry → evict + retry (reconnect branch fires)', async () => {
  const proxy = new RemoteProxy();
  proxy.registerServer({
    id: 'fff-reconnect',
    name: 'FFF Reconnect',
    type: 'remote',
    access: 'read',
    category: 'search',
    endpoint: 'http://127.0.0.1:1/unreachable',
  });

  let connectCalls = 0;

  const cleanConn = {
    client: {
      listTools: async () => ({ tools: [] }),
      close: async () => {},
    },
    transport: null,
    toolCache: null,
    resourceCache: null,
    promptCache: null,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (proxy as any).connect = async (serverId: string) => {
    connectCalls++;
    if (connectCalls === 1) {
      // Inject a stale entry before throwing so the reconnect branch sees it
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (proxy as any).connections.set(serverId, {
        client: { close: async () => {} },
        transport: null,
        toolCache: null,
        resourceCache: null,
        promptCache: null,
      });
      throw new Error('simulated first-connect failure');
    }
    return cleanConn;
  };

  // listTools invokes connectWithReconnect; the stale-entry branch should retry
  await proxy.listTools('fff-reconnect');

  assert.ok(
    connectCalls >= 2,
    `connect must be called at least twice for reconnect; got ${connectCalls}`,
  );

  // After eviction the stale entry must be gone (evict() deletes from the map)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(
    (proxy as any).connections.has('fff-reconnect'),
    false,
    'stale connection must be removed from the map after eviction',
  );

  await proxy.shutdown();
});

// ── 4. OpenClaw ch1tty-session: action:persist → chitty_memory_persist ────────

test('OpenClaw ch1tty-session: action:persist → calls chitty_memory_persist (not recall)', async () => {
  const fb = new FixtureBackend();
  fb.defineServer('chittyos', {
    tools: [{
      name: 'chitty_memory_persist',
      description: 'Persist session memory into ContextConsciousness',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
          scope: { type: 'string' },
        },
      },
      response: { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] },
    }],
  });

  const configs: ServerConfig[] = [{
    id: 'chittyos',
    name: 'ChittyOS',
    type: 'local',
    access: 'readwrite',
    category: 'ecosystem',
    command: 'noop',
    args: [],
  }];

  const dlqPath = tmpPath('dlq.jsonl');
  const aggregator = new Aggregator(configs, {
    ledgerDlqPath: dlqPath,
    embedEnabled: false,
    backendFactory: () => fb,
  });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  const baseUrl = `http://127.0.0.1:${server.getPort()}`;

  try {
    const res = await fetch(`${baseUrl}/openclaw/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skill: 'ch1tty-session',
        action: 'persist',
        query: 'session-key',
        value: 'session-value',
      }),
    });
    assert.equal(res.status, 200, 'persist action must return HTTP 200');
    const body = await res.json() as { ok: boolean; skill: string; result: unknown };
    assert.equal(body.ok, true, 'ok must be true');
    assert.equal(body.skill, 'ch1tty-session', 'skill must be reflected');

    const calls = fb.getCallLog();
    assert.ok(calls.length > 0, 'fixture backend must have been invoked');
    assert.equal(
      calls[0].tool,
      'chitty_memory_persist',
      'persist action must route to chitty_memory_persist, not chitty_memory_recall',
    );
  } finally {
    await server.stop();
    await aggregator.shutdown();
    rmSync(dlqPath, { force: true });
  }
});

// ── embedding-brain fake-Ollama helper ────────────────────────────────────────

async function startFakeOllama(
  responseBody: string,
): Promise<{ port: number; stop: () => Promise<void> }> {
  const srv: HttpServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
    _req.resume();
    _req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(responseBody);
    });
  });
  await new Promise<void>((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { srv.removeListener('error', reject); resolve(); });
  });
  const port = (srv.address() as AddressInfo).port;
  return {
    port,
    stop: () => new Promise<void>((resolve) => srv.close(() => resolve())),
  };
}

// ── 5. EmbeddingBrain: bad response shape → errors++, route() null ────────────

test('EmbeddingBrain: embeddings not-array response → errors incremented, route returns null', async () => {
  const fake = await startFakeOllama(JSON.stringify({ embeddings: 'not-an-array' }));
  const brain = new EmbeddingBrain({
    url: `http://127.0.0.1:${fake.port}`,
    enabled: true,
    timeoutMs: 2000,
    minSimilarity: 0.0,
    circuitBreakerThreshold: 100,
    circuitBreakerCooldownMs: 60_000,
  });

  try {
    const candidates = [
      { namespacedName: 'svc/tool', description: 'does something useful', category: 'code' },
    ];
    const result = await brain.route('do something', candidates);
    assert.equal(result, null, 'route must return null when embed response has wrong shape');
    const stats = brain.getStats();
    assert.ok(stats.errors >= 1, `errors must be >= 1 after bad shape; got ${stats.errors}`);
  } finally {
    await fake.stop();
  }
});

// ── 6. EmbeddingBrain: non-finite vector element → errors++, route() null ─────

test('EmbeddingBrain: embedding vector with non-number element → errors incremented, route returns null', async () => {
  // null is used in place of NaN since NaN is not representable in JSON;
  // `typeof null !== 'number'` satisfies the non-finite guard at line 343.
  const fake = await startFakeOllama(JSON.stringify({ embeddings: [[null, 1.0, 0.5]] }));
  const brain = new EmbeddingBrain({
    url: `http://127.0.0.1:${fake.port}`,
    enabled: true,
    timeoutMs: 2000,
    minSimilarity: 0.0,
    circuitBreakerThreshold: 100,
    circuitBreakerCooldownMs: 60_000,
  });

  try {
    const candidates = [
      { namespacedName: 'svc/tool', description: 'does something useful', category: 'code' },
    ];
    const result = await brain.route('do something', candidates);
    assert.equal(result, null, 'route must return null when vector contains non-number element');
    const stats = brain.getStats();
    assert.ok(stats.errors >= 1, `errors must be >= 1 after non-finite value; got ${stats.errors}`);
  } finally {
    await fake.stop();
  }
});
