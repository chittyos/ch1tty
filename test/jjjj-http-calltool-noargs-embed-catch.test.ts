/**
 * JJJJ batch — two targeted branch-coverage gaps not addressed by PRs #177/#179:
 *
 * 1. http-server.ts:205 — `args ?? {}` in the CallToolRequestSchema handler
 *    The `{}` branch fires only when a tools/call request omits `arguments`
 *    entirely (undefined). All prior tests pass `arguments: {}` explicitly.
 *
 * 2. embedding-brain.ts:186-192 — outer catch block in route()
 *    The comment labels it "Defensive — embedSingle/ensure* already trap their
 *    own errors." This path fires for unexpected throws that bypass those traps
 *    (e.g. cosine-math exceptions). Tested by replacing the private
 *    `ensureCandidateVectors` method (TypeScript `private` is compile-time only)
 *    with a function that throws, then verifying route() returns null safely.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';
import { EmbeddingBrain } from '../src/embedding-brain.js';
import type { ToolCandidate } from '../src/ollama-brain.js';

// ── HTTP helpers (minimal, inlined to avoid cross-file coupling) ──────────────

let _counter = 0;
async function startServer(): Promise<{ server: HttpMcpServer; aggregator: Aggregator; baseUrl: string; dlqPath: string }> {
  const dlqPath = join(tmpdir(), `ch1tty-jjjj-test-${process.pid}-${++_counter}.dlq.jsonl`);
  const aggregator = new Aggregator([], { ledgerDlqPath: dlqPath });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  return { server, aggregator, baseUrl: `http://127.0.0.1:${server.getPort()}`, dlqPath };
}

async function stopServer(s: { server: HttpMcpServer; aggregator: Aggregator; dlqPath: string }): Promise<void> {
  await s.server.stop();
  await s.aggregator.shutdown();
  rmSync(s.dlqPath, { force: true });
}

const PROTO_VERSION = '2025-11-25';
const MCP_HEADERS = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' } as const;

async function parseSse(res: Response): Promise<unknown> {
  const text = await res.text();
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) return JSON.parse(line.slice(6));
  }
  throw new Error(`No data line in SSE (HTTP ${res.status}): ${text.slice(0, 200)}`);
}

async function initSession(baseUrl: string): Promise<{ sessionId: string; protocolVersion: string }> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: MCP_HEADERS,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: PROTO_VERSION, capabilities: {}, clientInfo: { name: 'jjjj-test', version: '1.0.0' } },
    }),
  });
  const sessionId = res.headers.get('mcp-session-id')!;
  const msg = await parseSse(res) as { result: { protocolVersion: string } };
  return { sessionId, protocolVersion: msg.result.protocolVersion };
}

async function mcpPost(baseUrl: string, sessionId: string, protocolVersion: string, id: number, method: string, params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { ...MCP_HEADERS, 'Mcp-Session-Id': sessionId, 'Mcp-Protocol-Version': protocolVersion },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return parseSse(res);
}

// ── Test 1: http-server.ts:205 — tools/call with no `arguments` key ──────────

test('http-server tools/call with no arguments key → args ?? {} default → succeeds', async () => {
  const s = await startServer();
  try {
    const { sessionId, protocolVersion } = await initSession(s.baseUrl);

    // Deliberately omit the `arguments` key — exercises the `args ?? {}` branch
    // at http-server.ts:205. The MCP spec allows omitting `arguments` for tools
    // that require no input.
    const body = await mcpPost(s.baseUrl, sessionId, protocolVersion, 2, 'tools/call', {
      name: 'ch1tty/status',
      // no `arguments` property — request.params.arguments === undefined
    }) as { jsonrpc: string; id: number; result: { content: { type: string; text: string }[]; isError?: boolean } };

    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.id, 2);
    assert.ok(!body.result.isError, 'call with omitted arguments must not be an error');
    assert.equal(body.result.content[0]!.type, 'text');

    const status = JSON.parse(body.result.content[0]!.text) as { gateway: string };
    assert.equal(status.gateway, 'ch1tty');
  } finally {
    await stopServer(s);
  }
});

// ── Test 2: embedding-brain.ts:186-192 — outer catch block ───────────────────

test('EmbeddingBrain.route(): ensureCandidateVectors throws → catch block → null + errors++', async () => {
  const brain = new EmbeddingBrain({ enabled: true, timeoutMs: 1000 });

  const validVec = new Float32Array([0.7071, 0.7071]);

  // Replace private embedSingle to return a valid vector (bypasses the embed call)
  (brain as unknown as { embedSingle: (q: string) => Promise<Float32Array> }).embedSingle =
    async (_q: string) => validVec;

  // Replace private ensureCandidateVectors to throw — simulates an unexpected
  // error that bypasses the normal null-return trap in that method. This fires
  // the outer catch at embedding-brain.ts:185–193.
  (brain as unknown as { ensureCandidateVectors: (c: unknown[]) => Promise<Float32Array[]> }).ensureCandidateVectors =
    async (_c: unknown[]) => { throw new Error('cosine shape mismatch (injected for coverage)'); };

  const candidate: ToolCandidate = {
    tool: 'test/tool',
    description: 'a test tool for coverage',
    inputSchema: { type: 'object' },
  };

  const result = await brain.route('find test tool', [candidate]);

  assert.equal(result, null, 'route() must return null on unexpected error');
  assert.equal(brain.getStats().errors, 1, 'errors counter must be incremented');
  assert.ok(brain.getStats().calls >= 1, 'calls counter must be incremented');
});
