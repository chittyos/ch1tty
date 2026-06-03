/**
 * DDDD: 7 branch tests closing http-server / remote-proxy / aggregator gaps.
 *
 * Covered paths:
 *   http-server.ts:209 — resources/list handler body (listAllResources)
 *   http-server.ts:213 — resources/templates/list handler body
 *   http-server.ts:217 — resources/read handler body (readResource)
 *   http-server.ts:221 — prompts/list handler body (listAllPrompts)
 *   http-server.ts:225-226 — prompts/get handler body (getPrompt)
 *   remote-proxy.ts:73-77 — auth token success path: tokenCaches.set() + return token
 *   aggregator.ts:717 — cast toolArgs truthy branch: args.args is a plain object → toolArgs = args.args
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';
import { RemoteProxy } from '../src/remote-proxy.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Shared HTTP + MCP helpers (mirror of http-mcp-protocol.test.ts) ────────

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
  dlqPath: string;
}

let _counter = 0;
async function startServer(): Promise<Started> {
  const dlqPath = join(tmpdir(), `ch1tty-dddd-${process.pid}-${++_counter}.dlq.jsonl`);
  const aggregator = new Aggregator([], { ledgerDlqPath: dlqPath });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  return { server, aggregator, baseUrl: `http://127.0.0.1:${server.getPort()}`, dlqPath };
}

async function stop(s: Started): Promise<void> {
  await s.server.stop();
  await s.aggregator.shutdown();
  rmSync(s.dlqPath, { force: true });
}

const PROTO_VERSION = '2025-11-25';
const MCP_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
} as const;

async function parseSse(res: Response): Promise<unknown> {
  const text = await res.text();
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) return JSON.parse(line.slice(6));
  }
  throw new Error(`No data line in SSE response (HTTP ${res.status}): ${text.slice(0, 200)}`);
}

async function initSession(baseUrl: string): Promise<{ sessionId: string; protocolVersion: string }> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: PROTO_VERSION, capabilities: {}, clientInfo: { name: 'dddd-test', version: '1.0.0' } },
    }),
  });
  assert.equal(res.status, 200);
  const sessionId = res.headers.get('mcp-session-id');
  assert.ok(sessionId);
  const msg = await parseSse(res) as { result: { protocolVersion: string } };
  return { sessionId, protocolVersion: msg.result.protocolVersion };
}

async function mcpRequest(
  baseUrl: string, sessionId: string, protocolVersion: string,
  id: number, method: string, params: Record<string, unknown> = {},
): Promise<unknown> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { ...MCP_HEADERS, 'Mcp-Session-Id': sessionId, 'Mcp-Protocol-Version': protocolVersion },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return parseSse(res);
}

// ── Tests: HTTP MCP resource / prompt handlers ──────────────────────────────

test('dddd: resources/list over HTTP MCP → ListResourcesRequestSchema handler body (http-server.ts:209)', async () => {
  const s = await startServer();
  try {
    const { sessionId, protocolVersion } = await initSession(s.baseUrl);
    const body = await mcpRequest(s.baseUrl, sessionId, protocolVersion, 10, 'resources/list') as {
      jsonrpc: string; id: number; result: { resources: unknown[] }; error?: unknown;
    };
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.id, 10);
    // No backends → listAllResources succeeds with an empty array; assert no error + result shape.
    assert.equal(body.error, undefined, 'resources/list must not return a JSON-RPC error');
    assert.ok(Array.isArray(body.result.resources), 'result.resources is an array');
  } finally {
    await stop(s);
  }
});

test('dddd: resources/templates/list over HTTP MCP → ListResourceTemplatesRequestSchema handler body (http-server.ts:213)', async () => {
  const s = await startServer();
  try {
    const { sessionId, protocolVersion } = await initSession(s.baseUrl);
    const body = await mcpRequest(s.baseUrl, sessionId, protocolVersion, 11, 'resources/templates/list') as {
      jsonrpc: string; id: number; result: { resourceTemplates: unknown[] }; error?: unknown;
    };
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.id, 11);
    // No backends → listAllResourceTemplates succeeds with an empty array.
    assert.equal(body.error, undefined, 'resources/templates/list must not return a JSON-RPC error');
    assert.ok(Array.isArray(body.result.resourceTemplates), 'result.resourceTemplates is an array');
  } finally {
    await stop(s);
  }
});

test('dddd: resources/read over HTTP MCP → ReadResourceRequestSchema handler body (http-server.ts:217)', async () => {
  const s = await startServer();
  try {
    const { sessionId, protocolVersion } = await initSession(s.baseUrl);
    // readResource("test://dummy-resource") parses serverId="test", finds no backend, throws
    // "Unknown server \"test\" in resource URI: test://dummy-resource".
    // The MCP SDK wraps the throw into a JSON-RPC error; this confirms the handler body ran.
    const body = await mcpRequest(s.baseUrl, sessionId, protocolVersion, 12, 'resources/read', {
      uri: 'test://dummy-resource',
    }) as { jsonrpc: string; id: number; result?: unknown; error?: { code: number; message: string } };
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.id, 12);
    assert.ok(body.error, 'error expected for unknown resource server');
    assert.ok(
      body.error.message.includes('Unknown server'),
      `error.message must come from aggregator.readResource, got: "${body.error.message}"`,
    );
  } finally {
    await stop(s);
  }
});

test('dddd: prompts/list over HTTP MCP → ListPromptsRequestSchema handler body (http-server.ts:221)', async () => {
  const s = await startServer();
  try {
    const { sessionId, protocolVersion } = await initSession(s.baseUrl);
    const body = await mcpRequest(s.baseUrl, sessionId, protocolVersion, 13, 'prompts/list') as {
      jsonrpc: string; id: number; result: { prompts: unknown[] }; error?: unknown;
    };
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.id, 13);
    // No backends → listAllPrompts succeeds with an empty array.
    assert.equal(body.error, undefined, 'prompts/list must not return a JSON-RPC error');
    assert.ok(Array.isArray(body.result.prompts), 'result.prompts is an array');
  } finally {
    await stop(s);
  }
});

test('dddd: prompts/get over HTTP MCP → GetPromptRequestSchema handler body (http-server.ts:225-226)', async () => {
  const s = await startServer();
  try {
    const { sessionId, protocolVersion } = await initSession(s.baseUrl);
    // getPrompt("test-server/test-prompt") parses serverId="test-server", finds no backend, throws
    // "Unknown server \"test-server\" for prompt: test-server/test-prompt".
    const body = await mcpRequest(s.baseUrl, sessionId, protocolVersion, 14, 'prompts/get', {
      name: 'test-server/test-prompt',
      arguments: {},
    }) as { jsonrpc: string; id: number; result?: unknown; error?: { code: number; message: string } };
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.id, 14);
    assert.ok(body.error, 'error expected for unknown prompt server');
    assert.ok(
      body.error.message.includes('Unknown server'),
      `error.message must come from aggregator.getPrompt, got: "${body.error.message}"`,
    );
  } finally {
    await stop(s);
  }
});

// ── Test: remote-proxy auth token success path ──────────────────────────────

test('dddd: chitty-mcp-token success → tokenCaches.set() + return token (remote-proxy.ts:73-77)', async () => {
  // Create a minimal MCP fixture server that captures Authorization headers.
  const receivedAuth: string[] = [];
  const fixture = createServer((req: IncomingMessage, res: ServerResponse) => {
    const auth = req.headers['authorization'];
    if (typeof auth === 'string') receivedAuth.push(auth);

    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      let body: { method?: string; id?: number | string } = {};
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* ignore */ }

      const { method, id } = body;
      if (id === undefined) {
        res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return;
      }

      let result: unknown;
      if (method === 'initialize') {
        result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'auth-ok-fixture', version: '1.0' } };
      } else if (method === 'tools/list') {
        result = { tools: [{ name: 'ping', description: 'Ping', inputSchema: { type: 'object', properties: {} } }] };
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32601, message: 'method not found' }, id }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', result, id }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    fixture.once('error', reject);
    fixture.listen(0, '127.0.0.1', () => { fixture.removeListener('error', reject); resolve(); });
  });

  const port = (fixture.address() as AddressInfo).port;

  // Create a fake chitty-mcp-token binary that returns a known token value.
  const fakeBinDir = mkdtempSync(join(tmpdir(), 'ch1tty-dddd-auth-'));
  const fakeBin = join(fakeBinDir, 'chitty-mcp-token');
  writeFileSync(fakeBin, '#!/bin/sh\necho "dddd-fake-token"\n', { mode: 0o755 });

  const origPath = process.env.PATH;
  process.env.PATH = `${fakeBinDir}:${origPath ?? ''}`;

  const proxy = new RemoteProxy();
  try {
    proxy.registerServer({
      id: 'auth-ok-srv',
      name: 'Auth OK Server',
      type: 'remote',
      access: 'read',
      category: 'ecosystem',
      endpoint: `http://127.0.0.1:${port}`,
      authTokenKey: 'my-test-key',
    });

    // listTools triggers getAuthToken → execFileAsync(chitty-mcp-token) → success path
    const tools = await proxy.listTools('auth-ok-srv');
    assert.ok(Array.isArray(tools), 'listTools returns array');
    assert.ok(tools.length > 0, 'fixture has at least one tool');

    // Verify the Authorization header was sent with the fake token value
    assert.ok(
      receivedAuth.some((h) => h === 'Bearer dddd-fake-token'),
      `Expected "Bearer dddd-fake-token" in received auth headers, got: ${JSON.stringify(receivedAuth)}`,
    );
  } finally {
    process.env.PATH = origPath;
    rmSync(fakeBinDir, { recursive: true, force: true });
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    await proxy.shutdown();
  }
});

// ── Test: cast with args.args as plain object ────────────────────────────────

// Keyword-only coordinator: bypasses Ollama so tests are deterministic.
class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

test('dddd: cast with args.args plain object → toolArgs truthy branch (aggregator.ts:717)', async () => {
  // Register a fixture tool whose description matches the intent terms so cast reaches
  // the confirm-plan block where toolArgs is embedded in the response (not no_match).
  const backend = new FixtureBackend();
  backend.defineServer('dddd-db', {
    tools: [{
      name: 'search_projects',
      description: 'search database for projects',
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } } },
      response: { content: [{ type: 'text', text: '[]' }] },
    }],
  });

  const serverConfig: ServerConfig = {
    id: 'dddd-db',
    name: 'DDDD DB',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://dddd-db.test/mcp',
    lazy: true,
  };

  const dlqPath = join(tmpdir(), `ch1tty-dddd-cast-${process.pid}.jsonl`);
  const agg = new Aggregator([serverConfig], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlqPath,
    suggestionsCatalog: {},
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, dlqPath),
  });

  try {
    // args.args is a valid plain object → toolArgs = args.args (aggregator.ts:717 truthy branch).
    // confirm: true returns the plan containing args: toolArgs without executing.
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'search for database projects',
      args: { query: 'test-query', limit: 5 },
      confirm: true,
    });

    assert.ok(Array.isArray(result.content), 'result.content is an array');
    const plan = JSON.parse(result.content[0]!.text as string) as {
      cast: string;
      args: Record<string, unknown>;
    };
    assert.equal(plan.cast, 'plan', 'cast should resolve to a plan, not no_match');
    // toolArgs was built from args.args → plan.args must carry the supplied values
    assert.deepEqual(plan.args, { query: 'test-query', limit: 5 },
      'plan.args must equal the args.args object passed in (aggregator.ts:717 truthy branch)');
  } finally {
    await agg.shutdown();
    rmSync(dlqPath, { force: true });
  }
});
