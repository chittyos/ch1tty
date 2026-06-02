/**
 * EEE: six previously untested branches across config.ts, remote-proxy.ts,
 *      and aggregator.ts.
 *
 * 1. config.ts assertOptionalEnv non-record (line 118): headers/envHeaders
 *    passed as a non-object (array, string) → throws "must be an object of
 *    string values".
 *
 * 2. remote-proxy.ts doConnect envHeaders falsy env-var path (line 143):
 *    an envHeaders key references an env var that is not set in the process
 *    environment → the header is NOT added to the outgoing request.
 *
 * 3. aggregator.ts rebuildBackends ecosystem-bind happy path (lines 179-183):
 *    when at least one active config has type='remote' and category='ecosystem',
 *    rebuildBackends() calls coordinator.bindEcosystem() and sets the coordinator's
 *    internal ecosystemBackend + ecosystemServerId fields.
 *
 * 4. remote-proxy.ts shutdown close-rejection absorbed (line 401):
 *    if client.close() rejects during shutdown, the rejection is caught and
 *    logged; shutdown still resolves (Promise.allSettled).
 *
 * 5. aggregator.ts handleSearch session-tracker fallback bare-tool-name skip
 *    (line 389: if (sep > 0)): when sessions.getRecentTools() returns a tool
 *    name that contains no '/' separator, no serverId is extracted and
 *    recentServerIds stays empty → no tool is marked recentlyUsed:true.
 *
 * 6. aggregator.ts rebuildBackends no-ecosystem-config branch (outer
 *    if (ecosystemConfig)): when no active config has type='remote' +
 *    category='ecosystem', bindEcosystem is never called and the coordinator's
 *    ecosystemBackend remains undefined.
 */

import assert from 'node:assert/strict';
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
import { rmSync } from 'node:fs';

import { validateServersConfig } from '../src/config.js';
import { RemoteProxy } from '../src/remote-proxy.js';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── helpers ──────────────────────────────────────────────────────────────────

let _ctr = 0;
function dlqPath(): string {
  return join(tmpdir(), `ch1tty-eee-${process.pid}-${++_ctr}.dlq.jsonl`);
}

/** Minimal local HTTP server that records received headers and returns 502. */
interface LocalMcp {
  port: number;
  received: Array<{ headers: Record<string, string> }>;
  stop: () => Promise<void>;
}

async function startHeaderRecorder(): Promise<LocalMcp> {
  const received: LocalMcp['received'] = [];
  const server: HttpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const normalized: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') normalized[k.toLowerCase()] = v;
        else if (Array.isArray(v)) normalized[k.toLowerCase()] = v.join(',');
      }
      received.push({ headers: normalized });
      // 502 so the MCP SDK raises an error (connection counted as attempted)
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('eee-502');
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    received,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// ── 1. assertOptionalEnv: headers passed as non-record → throws ───────────────

test('assertOptionalEnv: headers value is an array → throws "must be an object of string values"', () => {
  assert.throws(
    () => validateServersConfig({
      servers: [{
        id: 'bad-hdr', name: 'Bad Header', type: 'remote', access: 'read',
        category: 'search', endpoint: 'https://example.com/mcp',
        headers: ['not', 'an', 'object'],
      }],
    }),
    /must be an object of string values/,
    'array-valued headers must throw with descriptive message',
  );
});

// ── 2. envHeaders: unset env var → header NOT sent ────────────────────────────

test('envHeaders: env var not set → header absent from outgoing request', async () => {
  const KEY = 'CH1TTY_EEE_UNSET_HEADER_88888';
  delete process.env[KEY];

  const mcp = await startHeaderRecorder();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'eee-envhdr', name: 'EEE EnvHdr', type: 'remote', access: 'read',
      category: 'search', endpoint: `http://127.0.0.1:${mcp.port}/mcp`,
      envHeaders: { 'X-EEE-Missing': KEY },
    });

    // Call will fail (502) but headers are already recorded
    await proxy.callTool('eee-envhdr', 'any_tool', {}).catch(() => {});
    assert.ok(mcp.received.length > 0, 'at least one request must have been sent');
    assert.equal(
      mcp.received[0].headers['x-eee-missing'],
      undefined,
      'header for unset env var must be absent from request',
    );
  } finally {
    await proxy.shutdown();
    await mcp.stop();
  }
});

// ── 3. rebuildBackends: ecosystem bind → coordinator.ecosystemBackend set ─────

test('rebuildBackends: remote ecosystem config → coordinator.ecosystemBackend bound', async () => {
  const dlq = dlqPath();
  const backend = new FixtureBackend();
  backend.defineServer('chittyos', { tools: [] });

  const configs: ServerConfig[] = [{
    id: 'chittyos',
    name: 'ChittyOS',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://mcp.chitty.cc/mcp',
    lazy: true,
  }];

  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq,
    suggestionsCatalog: {},
    focusProfiles: { profiles: {} },
  });

  try {
    const coord = agg.coordinator as unknown as {
      ecosystemBackend: unknown;
      ecosystemServerId: string | undefined;
    };
    assert.ok(coord.ecosystemBackend !== undefined, 'ecosystemBackend must be set after construction');
    assert.equal(coord.ecosystemServerId, 'chittyos', 'ecosystemServerId must match the ecosystem config id');
  } finally {
    await agg.shutdown();
    rmSync(dlq, { force: true });
  }
});

// ── 4. shutdown: client.close() rejection absorbed by .catch() ────────────────

test('RemoteProxy.shutdown: client.close() rejection does not cause shutdown to reject', async () => {
  const mcp = await startHeaderRecorder();
  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'eee-close-fail', name: 'EEE Close Fail', type: 'remote', access: 'read',
      category: 'search', endpoint: `http://127.0.0.1:${mcp.port}/mcp`,
    });

    // Force a stale connection into the proxy's internal map so shutdown tries to close it.
    const fakeClient = {
      close: () => Promise.reject(new Error('simulated close failure')),
    };
    const fakeConn = { client: fakeClient, transport: null, toolCache: null, resourceCache: null, promptCache: null };
    (proxy as unknown as { connections: Map<string, unknown> }).connections.set('eee-close-fail', fakeConn);

    // shutdown() must resolve even though close() rejects
    await assert.doesNotReject(
      () => proxy.shutdown(),
      'shutdown must absorb client.close() rejection via Promise.allSettled',
    );
  } finally {
    await mcp.stop();
  }
});

// ── 5. handleSearch session-tracker fallback: bare tool name → no recentlyUsed ─

test('handleSearch session-tracker: tool without "/" separator → no recentlyUsed flag emitted', async () => {
  const dlq = dlqPath();
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [{
      name: 'run_sql',
      description: 'Execute a SQL query on Neon',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: 'ok' }] },
    }],
  });

  const configs: ServerConfig[] = [{
    id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite',
    category: 'code', endpoint: 'https://neon.example.com/mcp', lazy: true,
  }];

  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq,
    suggestionsCatalog: {},
    focusProfiles: { profiles: {} },
  });

  try {
    const sessionId = 'eee-bare-tool-session';
    agg.sessions.getOrCreate(sessionId, 'stdio');
    // Inject a bare tool name (no '/') into the session tracker
    agg.sessions.recordToolCall(sessionId, 'bare-tool-no-slash');

    // Search with this session — the bare name must NOT populate recentServerIds
    const result = await agg.callTool('ch1tty/search', { query: 'sql', limit: 20 }, sessionId);
    assert.ok(!result.isError, 'search must not error');

    const data = JSON.parse(result.content[0].text as string) as {
      tools: Array<{ tool: string; recentlyUsed?: boolean }>;
    };
    const neonTool = data.tools.find((t) => t.tool === 'neon/run_sql');
    assert.ok(neonTool, 'neon/run_sql must appear in results');
    assert.equal(
      neonTool.recentlyUsed,
      undefined,
      'bare-tool-no-slash must not make neon/run_sql appear as recentlyUsed (sep>0 guard skips it)',
    );
  } finally {
    await agg.shutdown();
    rmSync(dlq, { force: true });
  }
});

// ── 6. rebuildBackends: no ecosystem config → ecosystemBackend stays undefined ─

test('rebuildBackends: no remote ecosystem config → coordinator.ecosystemBackend stays undefined', async () => {
  const dlq = dlqPath();
  const backend = new FixtureBackend();
  backend.defineServer('neon', { tools: [] });

  // Only a 'code' category server — no 'ecosystem' remote
  const configs: ServerConfig[] = [{
    id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite',
    category: 'code', endpoint: 'https://neon.example.com/mcp', lazy: true,
  }];

  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq,
    suggestionsCatalog: {},
    focusProfiles: { profiles: {} },
  });

  try {
    const coord = agg.coordinator as unknown as { ecosystemBackend: unknown };
    assert.equal(
      coord.ecosystemBackend,
      undefined,
      'ecosystemBackend must stay undefined when no remote ecosystem config exists',
    );
  } finally {
    await agg.shutdown();
    rmSync(dlq, { force: true });
  }
});
