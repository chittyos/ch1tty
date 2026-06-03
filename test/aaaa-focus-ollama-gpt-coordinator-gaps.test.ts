/**
 * AAAA batch — 9 targeted branch/line tests for paths not yet covered:
 *
 * 1. focus.ts:156        — resolveFocus: unknown profile name → warn + undefined
 * 2. ollama-brain.ts:323 — safeParseJson catch: Ollama model returns invalid JSON → null
 * 3. ollama-brain.ts:360 — extractRoutedTools: parsed is a non-object (string) → []
 * 4. ollama-brain.ts:361 — extractRoutedTools: parsed.matches is not an array → []
 * 5. ollama-brain.ts:369 — extractRoutedTools: item.tool is not a string → skipped
 * 6. gpt-actions.ts:41   — /session/save without conversation_id → key uses 'unknown' fallback
 * 7. gpt-actions.ts:61-63 — /tasks/list route (chitty_task_list mapping)
 * 8. gpt-actions.ts:64-65 — /state/reconcile route (chitty_memory_recall mapping)
 * 9. coordinator.ts:358-359 — callEcosystem with no bound backend → throws
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import test from 'node:test';

import { resolveFocus, validateFocusProfiles } from '../src/focus.js';
import { OllamaBrain, type ToolCandidate } from '../src/ollama-brain.js';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';
import { SessionCoordinator } from '../src/coordinator.js';

// ── Helpers ───────────────────────────────────────────────────

let _seq = 0;
function dlqPath(): string {
  return join(tmpdir(), `ch1tty-aaaa-${process.pid}-${++_seq}.dlq.jsonl`);
}

type OllamaResp = { status: number; body: string };

async function startFakeOllama(
  handler: (req: http.IncomingMessage) => Promise<OllamaResp | 'hang'>,
): Promise<{ url: string; stop: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    // Drain body so the socket stays clean
    req.resume();
    req.on('end', () => {
      handler(req).then((result) => {
        if (result === 'hang') return;
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(result.body);
      }).catch((err) => {
        res.writeHead(500);
        res.end(String(err));
      });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const stop = () => new Promise<void>((res, rej) => {
    server.closeAllConnections?.();
    server.close((err) => (err ? rej(err) : res()));
  });
  return { url, stop };
}

function ollamaPayload(modelResponse: string): string {
  return JSON.stringify({ model: 'test', created_at: new Date().toISOString(), response: modelResponse, done: true });
}

function makeBrain(url: string): OllamaBrain {
  return new OllamaBrain({ url, model: 'test', timeoutMs: 3000, enabled: true, minConfidence: 0.5, maxCandidates: 10, circuitBreakerThreshold: 99, circuitBreakerCooldownMs: 60000 });
}

const CANDIDATES: ToolCandidate[] = [
  { namespacedName: 'svc/tool_a', description: 'Tool A does things', category: 'code' },
  { namespacedName: 'svc/tool_b', description: 'Tool B does other things', category: 'ecosystem' },
  // Empty description exercises the `|| '(no description)'` fallback in buildPrompt (line 323)
  { namespacedName: 'svc/tool_c', description: '' },
];

interface GptCtx {
  server: HttpMcpServer;
  aggregator: Aggregator;
  base: string;
  dlq: string;
}

async function startGptServer(): Promise<GptCtx> {
  const dlq = dlqPath();
  const aggregator = new Aggregator([], { ledgerDlqPath: dlq, embedEnabled: false });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  return { server, aggregator, base: `http://127.0.0.1:${server.getPort()}`, dlq };
}

async function stopGptServer(ctx: GptCtx): Promise<void> {
  await ctx.server.stop();
  await ctx.aggregator.shutdown();
  rmSync(ctx.dlq, { force: true });
}

// ── 1. focus.ts:156 ───────────────────────────────────────────

test('resolveFocus: unknown profile name → returns undefined (soft lens, not a hard error)', () => {
  const profiles = validateFocusProfiles({
    profiles: {
      finance: { categories: ['ecosystem'], servers: [], boost: 0.5 },
    },
  });

  const result = resolveFocus(profiles, 'totally-unknown-profile');
  assert.equal(result, undefined, 'unknown profile must silently return undefined');
});

// ── 2. ollama-brain.ts:323 (safeParseJson catch) ──────────────

test('OllamaBrain.route: model returns invalid JSON → safeParseJson catch fires → route returns null', async () => {
  const { url, stop } = await startFakeOllama(async () => ({
    status: 200,
    body: ollamaPayload('THIS IS NOT VALID JSON AT ALL {{{'),
  }));
  try {
    const brain = makeBrain(url);
    const result = await brain.route('find something', CANDIDATES);
    assert.equal(result, null, 'should return null when model output is not parseable JSON');
  } finally {
    await stop();
  }
});

// ── 3. ollama-brain.ts:360 (extractRoutedTools non-object parsed) ──

test('OllamaBrain.route: model returns a JSON string (non-object) → extractRoutedTools guards at !object → null', async () => {
  // JSON.parse of '"a-string"' returns the JS string "a-string" — truthy but not an object.
  const { url, stop } = await startFakeOllama(async () => ({
    status: 200,
    body: ollamaPayload('"a-string-result"'),
  }));
  try {
    const brain = makeBrain(url);
    const result = await brain.route('find something', CANDIDATES);
    assert.equal(result, null, 'string (non-object) parsed value must yield null from route');
  } finally {
    await stop();
  }
});

// ── 4. ollama-brain.ts:361 (extractRoutedTools no matches array) ─

test('OllamaBrain.route: model returns JSON object without matches array → !Array.isArray guard → null', async () => {
  const { url, stop } = await startFakeOllama(async () => ({
    status: 200,
    body: ollamaPayload('{"explanation":"I found nothing","tools":[]}'),
  }));
  try {
    const brain = makeBrain(url);
    const result = await brain.route('find something', CANDIDATES);
    assert.equal(result, null, 'object without "matches" array must yield null from route');
  } finally {
    await stop();
  }
});

// ── 5. ollama-brain.ts:369 (item.tool not a string → skip) ────

test('OllamaBrain.route: matches contain item with numeric tool → typeof !== string guard skips item → null', async () => {
  const { url, stop } = await startFakeOllama(async () => ({
    status: 200,
    // All items have non-string `tool` fields — they are all skipped by the guard.
    body: ollamaPayload('{"matches":[{"tool":42,"confidence":0.9,"reason":"test"},{"tool":true,"confidence":0.8,"reason":"other"}]}'),
  }));
  try {
    const brain = makeBrain(url);
    const result = await brain.route('find something', CANDIDATES);
    assert.equal(result, null, 'all-non-string-tool matches must yield empty result → null');
  } finally {
    await stop();
  }
});

// ── 6. gpt-actions.ts:41 (/session/save without conversation_id) ─

test('gpt-actions /session/save: missing conversation_id → mapArgs uses "unknown" fallback (key = session:unknown)', async () => {
  const ctx = await startGptServer();
  // Capture the args that flow into aggregator.callTool
  let capturedArgs: Record<string, unknown> | undefined;
  const origCallTool = ctx.aggregator.callTool.bind(ctx.aggregator);
  ctx.aggregator.callTool = async (tool, args, sessionId) => {
    if (tool === 'chitty_memory_persist') capturedArgs = args as Record<string, unknown>;
    return origCallTool(tool, args, sessionId);
  };

  try {
    const res = await fetch(`${ctx.base}/gpt-actions/session/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Deliberately omit conversation_id — triggers the ?? 'unknown' fallback
      body: JSON.stringify({ summary: 'testing the unknown fallback', tags: ['test'] }),
    });
    assert.ok(res.status === 200 || res.status === 500, `unexpected status ${res.status}`);
    assert.ok(capturedArgs !== undefined, 'callTool should have been invoked with chitty_memory_persist');
    assert.equal(capturedArgs!.key, 'session:unknown', 'key must be "session:unknown" when conversation_id is absent');
  } finally {
    await stopGptServer(ctx);
  }
});

// ── 7. gpt-actions.ts:61-63 (/tasks/list route) ─────────────

test('gpt-actions /tasks/list: route is reachable and mapped to chitty_task_list', async () => {
  const ctx = await startGptServer();
  let calledTool: string | undefined;
  const origCallTool = ctx.aggregator.callTool.bind(ctx.aggregator);
  ctx.aggregator.callTool = async (tool, args, sessionId) => {
    calledTool = tool;
    return origCallTool(tool, args, sessionId);
  };

  try {
    const res = await fetch(`${ctx.base}/gpt-actions/tasks/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: 'p-1', status: 'open' }),
    });
    // Route exists → not a 404; may be 200 or 500 depending on backend availability
    assert.notEqual(res.status, 404, '/tasks/list route must exist (not 404)');
    assert.equal(calledTool, 'chitty_task_list', 'should route to chitty_task_list');
  } finally {
    await stopGptServer(ctx);
  }
});

// ── 8. gpt-actions.ts:64-65 (/state/reconcile route) ────────

test('gpt-actions /state/reconcile: route is reachable and mapped to chitty_memory_recall', async () => {
  const ctx = await startGptServer();
  let calledTool: string | undefined;
  const origCallTool = ctx.aggregator.callTool.bind(ctx.aggregator);
  ctx.aggregator.callTool = async (tool, args, sessionId) => {
    calledTool = tool;
    return origCallTool(tool, args, sessionId);
  };

  try {
    const res = await fetch(`${ctx.base}/gpt-actions/state/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: 'p-1', current_summary: 'in progress' }),
    });
    assert.notEqual(res.status, 404, '/state/reconcile route must exist (not 404)');
    assert.equal(calledTool, 'chitty_memory_recall', 'should route to chitty_memory_recall');
  } finally {
    await stopGptServer(ctx);
  }
});

// ── 9. coordinator.ts:358-359 (callEcosystem without backend) ─

test('SessionCoordinator.callEcosystem: no ecosystem backend bound → throws "No ecosystem backend bound"', async () => {
  const coord = new SessionCoordinator({}, { enabled: false });
  // callEcosystem is private but fully accessible at JS runtime
  await assert.rejects(
    () => (coord as unknown as Record<string, (a: string, b: unknown) => Promise<unknown>>)['callEcosystem']('test_tool', {}),
    (err: Error) => {
      assert.match(err.message, /No ecosystem backend bound/);
      return true;
    },
  );
});
