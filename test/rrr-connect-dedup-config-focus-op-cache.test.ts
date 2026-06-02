/**
 * RRR batch — 5 tests covering genuinely untested branches:
 *
 * 1. RemoteProxy.connect() concurrent dedup guard
 *    Two concurrent listTools() calls share the same doConnect() promise via
 *    this.connecting → only 1 initialize sent to the server (not 2).
 *    (remote-proxy.ts:95–96)
 *
 * 2. config.ts assertOptionalStringArray — !Array.isArray branch
 *    args field is a plain string → !Array.isArray fires → "must be an array of strings".
 *    Prior test (QQQ/config.test.ts) only covered args: [1, 2] which hits the .some() path.
 *    (config.ts:102)
 *
 * 3. ChildManager.isOpAvailable() — cached-result return path
 *    Second call finds this.opAvailable !== null → returns cached value without re-running exec.
 *    PPP tests pre-set opAvailable; this test proves the cache fires from a natural first call.
 *    (child-manager.ts:93)
 *
 * 4. focus.ts assertStringArray — !Array.isArray branch
 *    categories is a plain string, not an array → !Array.isArray fires → throws.
 *    WW test used categories: ['code', 99] which hits .some(); this hits the first condition.
 *    (focus.ts:45)
 *
 * 5. openclaw-facade.ts /invoke — else branch when backend returns empty content
 *    result.content is [] → content = undefined → else fires: parsed = result (full ToolCallResult).
 *    (openclaw-facade.ts:190–192)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdtempSync,
  writeFileSync,
  chmodSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RemoteProxy } from '../src/remote-proxy.js';
import { validateServersConfig } from '../src/config.js';
import { ChildManager } from '../src/child-manager.js';
import { validateFocusProfiles } from '../src/focus.js';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── 1. RemoteProxy.connect: concurrent dedup → 1 initialize ─────────────────

test('RemoteProxy.connect: two concurrent listTools() share one doConnect() → exactly 1 initialize sent', async () => {
  let initializeCount = 0;

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') { req.resume(); res.writeHead(405); res.end(); return; }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let body: { method: string; id?: number | string };
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body; }
      catch { res.writeHead(400); res.end('{"error":"bad json"}'); return; }

      if (body.method === 'initialize') initializeCount++;

      if (body.id === undefined) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }

      let result: unknown;
      if (body.method === 'initialize') {
        result = {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'rrr-dedup-fixture', version: '1.0' },
        };
      } else if (body.method === 'tools/list') {
        result = { tools: [] };
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32601, message: 'method not found' }, id: body.id }));
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', result, id: body.id }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', () => { httpServer.removeListener('error', reject); resolve(); });
  });
  const port = (httpServer.address() as AddressInfo).port;

  const origTimeout = process.env.CH1TTY_REMOTE_TIMEOUT_MS;
  process.env.CH1TTY_REMOTE_TIMEOUT_MS = '3000';

  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'rrr-dedup',
      name: 'RRR Dedup',
      type: 'remote',
      access: 'read',
      category: 'code',
      endpoint: `http://127.0.0.1:${port}/mcp`,
    });

    // Both calls start in the same event-loop turn. The first reaches
    // this.connecting.set() before any I/O can fire; the second finds the
    // pending promise there and shares it — doConnect() runs exactly once.
    const [tools1, tools2] = await Promise.all([
      proxy.listTools('rrr-dedup'),
      proxy.listTools('rrr-dedup'),
    ]);

    assert.deepEqual(tools1, [], 'first listTools: empty tool list');
    assert.deepEqual(tools2, [], 'second listTools: same empty tool list');
    assert.equal(initializeCount, 1, 'dedup guard: exactly 1 initialize sent despite 2 concurrent calls');
  } finally {
    if (origTimeout === undefined) delete process.env.CH1TTY_REMOTE_TIMEOUT_MS;
    else process.env.CH1TTY_REMOTE_TIMEOUT_MS = origTimeout;
    await proxy.shutdown();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});

// ── 2. config.ts assertOptionalStringArray — !Array.isArray branch ───────────

test('validateServersConfig: args is a plain string → !Array.isArray fires → "must be an array of strings"', () => {
  assert.throws(
    () => validateServersConfig({
      servers: [{
        id: 'rrr-str-args',
        name: 'RRR Str Args',
        type: 'local',
        access: 'readwrite',
        category: 'code',
        command: 'node',
        args: 'not-an-array',
      }],
    }),
    /must be an array of strings/,
    'string args must throw "must be an array of strings"',
  );
});

// ── 3. ChildManager.isOpAvailable: cached-result return path ─────────────────

type CmPrivate = {
  isOpAvailable(): Promise<boolean>;
  opAvailable: boolean | null;
};

test('ChildManager.isOpAvailable: second call returns cached value without re-running exec', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-rrr-op-cache-'));
  const callLog = join(dir, 'calls.txt');
  const script = join(dir, 'op');

  // Fake `op`: appends a line to callLog on every invocation then exits 0.
  writeFileSync(script, `#!/bin/sh\necho called >> '${callLog}'\nexit 0\n`, 'utf-8');
  chmodSync(script, 0o755);

  const origPath = process.env.PATH;
  process.env.PATH = `${dir}:${origPath ?? '/usr/bin'}`;

  const cm = new ChildManager();
  try {
    // First call: op whoami → exits 0 → opAvailable = true; callLog gets 1 line.
    const first = await (cm as unknown as CmPrivate).isOpAvailable();
    assert.equal(first, true, 'first call: op whoami succeeds → true');

    // Second call: this.opAvailable !== null → returns cached value; op NOT re-run.
    const second = await (cm as unknown as CmPrivate).isOpAvailable();
    assert.equal(second, true, 'second call: cache hit → same cached value');

    // Verify exec was only called once (callLog has exactly 1 line).
    const lines = readFileSync(callLog, 'utf-8').trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'op binary invoked exactly once; cache prevents second exec');
  } finally {
    if (origPath === undefined) delete process.env.PATH; else process.env.PATH = origPath;
    rmSync(dir, { recursive: true, force: true });
    await cm.shutdown();
  }
});

// ── 4. focus.ts assertStringArray — !Array.isArray branch ────────────────────

test('focus.ts assertStringArray: categories is a plain string → !Array.isArray fires → throws', () => {
  assert.throws(
    () => validateFocusProfiles({ profiles: { x: { categories: 'code' } } }),
    /profiles\.x\.categories must be an array of strings/,
    'string categories must throw "must be an array of strings"',
  );
});

// ── 5. openclaw-facade invoke: backend returns empty content → else branch ────

let _seq = 0;
function makeDlqPath(): string {
  return join(tmpdir(), `ch1tty-rrr-openclaw-${process.pid}-${++_seq}.dlq.jsonl`);
}

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
  dlqPath: string;
}

async function startServer(configs: ServerConfig[], fb: FixtureBackend): Promise<Started> {
  const dlqPath = makeDlqPath();
  const aggregator = new Aggregator(configs, {
    ledgerDlqPath: dlqPath,
    embedEnabled: false,
    backendFactory: () => fb,
  });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  return { server, aggregator, baseUrl: `http://127.0.0.1:${server.getPort()}`, dlqPath };
}

async function stop(s: Started): Promise<void> {
  await s.server.stop();
  await s.aggregator.shutdown();
  rmSync(s.dlqPath, { force: true });
}

test('OpenClaw invoke: backend returns { content: [] } → else branch fires: parsed = full ToolCallResult', async () => {
  const fb = new FixtureBackend();
  fb.defineServer('rrr-empty-content', {
    tools: [{
      name: 'empty_tool',
      description: 'Tool that returns empty content array',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [], isError: false },
    }],
  });

  const config: ServerConfig = {
    id: 'rrr-empty-content',
    name: 'RRR Empty Content',
    type: 'remote',
    access: 'read',
    category: 'code',
    endpoint: 'http://fixture.internal/mcp',
  };

  const s = await startServer([config], fb);
  try {
    const res = await fetch(`${s.baseUrl}/openclaw/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skill: 'ch1tty-execute',
        args: { tool: 'rrr-empty-content/empty_tool', args: {} },
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { ok: boolean; skill: string; result: unknown };
    assert.equal(body.ok, true, 'response must be ok');
    assert.equal(body.skill, 'ch1tty-execute', 'skill key echoed back');

    // else-branch: parsed = result (the full ToolCallResult with content: [])
    assert.ok(
      typeof body.result === 'object' && body.result !== null,
      'result must be the full ToolCallResult object',
    );
    const resultObj = body.result as Record<string, unknown>;
    assert.ok('content' in resultObj, 'result must have a content property');
    assert.deepEqual(resultObj.content, [], 'content must be the original empty array');
  } finally {
    await stop(s);
  }
});
