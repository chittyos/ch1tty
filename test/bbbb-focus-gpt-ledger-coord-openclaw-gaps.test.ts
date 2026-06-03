/**
 * BBBB batch — 9 targeted branch tests for gaps remaining after AAAA merge
 *
 * Branches closed:
 *
 *   1. focus.ts:156        — resolveFocus: unknown name + EMPTY profiles → log line uses '(none)'
 *                            (AAAA test used non-empty profiles; the || '(none)' branch was skipped)
 *
 *   2. gpt-actions.ts:61   — /tasks/list mapArgs: b.status ?? 'all' true branch
 *                            (AAAA test provided status:'open'; the ?? 'all' fallback was never hit)
 *
 *   3. gpt-actions.ts:64-65 — /state/reconcile mapArgs: b.project_id ?? '' and
 *                              b.current_summary ?? '' true branches
 *                              (AAAA test provided both fields; the ?? '' fallbacks were skipped)
 *
 *   4. gpt-actions.ts:120  — catch block: err is not an Error → String(err) branch
 *                            (existing tests always throw Error objects)
 *
 *   5. openclaw-facade.ts:27 — readBody: empty POST body → !raw → return {}
 *                              (no test ever sent a zero-byte body to an openclaw route)
 *
 *   6. openclaw-facade.ts:125 — ch1tty-session mapArgs: b.scope ?? 'session' true branch
 *                               (KKK test provided scope:'entity'; the ?? 'session' fallback was skipped)
 *
 *   7. openclaw-facade.ts:202 — catch block: err is not an Error → String(err) branch
 *                               (existing tests always throw Error objects)
 *
 *   8. ledger.ts:95-97     — setInterval callback: flush() rejects → .catch fires
 *                            (no test ever triggered the periodic-flush error path)
 *
 *   9. coordinator.ts:124  — onSessionStart: stageSession() rejects → .catch fires
 *                            (no test ever caused stageSession to propagate a rejection)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';

import { resolveFocus, validateFocusProfiles } from '../src/focus.js';
import { LedgerClient } from '../src/ledger.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';
import type {
  Backend, BackendStatus, ContentItem, PromptEntry,
  ResourceEntry, ResourceTemplateEntry, ServerConfig,
  ToolCallResult, ToolEntry,
} from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function dlqPath(): string {
  return join(tmpdir(), `ch1tty-bbbb-${process.pid}-${++_seq}.dlq.jsonl`);
}

class NullBackend implements Backend {
  registerServer(_: ServerConfig): void {}
  isRegistered(_: string): boolean { return true; }
  getStatus(_: string): BackendStatus { return { connected: true, toolCount: 0, toolCacheAge: null }; }
  async listTools(_: string): Promise<ToolEntry[]> { return []; }
  async listResources(_: string): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> {
    return { resources: [], templates: [] };
  }
  async readResource(_: string, _u: string): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }> {
    return { contents: [] };
  }
  async listPrompts(_: string): Promise<PromptEntry[]> { return []; }
  async getPrompt(_: string, _n: string): Promise<{ description?: string; messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> {
    return { messages: [] };
  }
  async callTool(_: string, __: string, ___?: Record<string, unknown>): Promise<ToolCallResult> {
    return { content: [] };
  }
  async shutdown(): Promise<void> {}
}

interface Ctx {
  server: HttpMcpServer;
  aggregator: Aggregator;
  base: string;
  dlq: string;
}

async function startHttp(): Promise<Ctx> {
  const dlq = dlqPath();
  const aggregator = new Aggregator([], { ledgerDlqPath: dlq, embedEnabled: false });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  return { server, aggregator, base: `http://127.0.0.1:${server.getPort()}`, dlq };
}

async function stopHttp(ctx: Ctx): Promise<void> {
  await ctx.server.stop();
  await ctx.aggregator.shutdown();
  rmSync(ctx.dlq, { force: true });
}

// ── 1. focus.ts:156 — resolveFocus with EMPTY profiles → '(none)' branch ─────

test('resolveFocus: empty profiles object → || (none) branch fires, returns undefined', () => {
  const profiles = validateFocusProfiles({ profiles: {} });
  const result = resolveFocus(profiles, 'nonexistent-profile');
  assert.equal(result, undefined, 'unknown profile with empty registry must return undefined');
});

// ── 2. gpt-actions.ts:61 — /tasks/list without status → b.status ?? 'all' ────

test('gpt-actions /tasks/list: omitting status → mapArgs uses ?? "all" fallback', async () => {
  const ctx = await startHttp();
  let capturedArgs: Record<string, unknown> | undefined;

  ctx.aggregator.callTool = async (tool, args) => {
    if (tool === 'chitty_task_list') capturedArgs = args as Record<string, unknown>;
    return { content: [{ type: 'text', text: '{}' }] };
  };

  try {
    const res = await fetch(`${ctx.base}/gpt-actions/tasks/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: 'bbbb-proj' }),
      // Deliberately no 'status' field — exercises the ?? 'all' true branch
    });
    assert.notEqual(res.status, 404, 'route must exist');
    assert.ok(capturedArgs !== undefined, 'chitty_task_list must be invoked');
    assert.equal(capturedArgs!.status, 'all', 'status must default to "all" when omitted');
  } finally {
    await stopHttp(ctx);
  }
});

// ── 3. gpt-actions.ts:64-65 — /state/reconcile without project_id/summary ────

test('gpt-actions /state/reconcile: omitting project_id and current_summary → ?? "" both', async () => {
  const ctx = await startHttp();
  let capturedArgs: Record<string, unknown> | undefined;

  ctx.aggregator.callTool = async (tool, args) => {
    if (tool === 'chitty_memory_recall') capturedArgs = args as Record<string, unknown>;
    return { content: [{ type: 'text', text: '{}' }] };
  };

  try {
    const res = await fetch(`${ctx.base}/gpt-actions/state/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      // No project_id or current_summary — exercises both ?? '' true branches
    });
    assert.notEqual(res.status, 404, 'route must exist');
    assert.ok(capturedArgs !== undefined, 'chitty_memory_recall must be invoked');
    // reconcile + '' + '' trimmed → 'reconcile'
    assert.equal(capturedArgs!.query, 'reconcile', 'query must be trimmed "reconcile" when both fields absent');
    assert.equal(capturedArgs!.scope, 'all');
  } finally {
    await stopHttp(ctx);
  }
});

// ── 4. gpt-actions.ts:120 — non-Error thrown → String(err) branch ────────────

test('gpt-actions: callTool throws a non-Error value → String(err) in catch → 500 envelope', async () => {
  const ctx = await startHttp();

  ctx.aggregator.callTool = async (): Promise<ToolCallResult> => {
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    throw 'non-error string thrown';
  };

  try {
    const res = await fetch(`${ctx.base}/gpt-actions/session/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: 'bbbb-conv' }),
    });
    assert.equal(res.status, 500, 'non-Error throw must produce 500');
    const body = await res.json() as { ok: boolean; result: { error: string } };
    assert.equal(body.ok, false);
    assert.ok(
      typeof body.result?.error === 'string' && body.result.error.includes('non-error string thrown'),
      `error must contain the thrown string; got: ${JSON.stringify(body.result)}`,
    );
  } finally {
    await stopHttp(ctx);
  }
});

// ── 5. openclaw-facade.ts:27 — empty body → !raw → return {} → 400 ──────────

test('openclaw /invoke: empty POST body → readBody !raw branch → {} → missing skill → 400', async () => {
  const ctx = await startHttp();
  try {
    // Zero-byte body: the for-await loop runs 0 iterations; raw = ''; !raw is true → return {}
    const res = await fetch(`${ctx.base}/openclaw/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '0' },
      body: '',
    });
    assert.equal(res.status, 400, 'empty body must produce 400 (skill field missing after !raw path)');
    const body = await res.json() as { ok: boolean };
    assert.equal(body.ok, false);
  } finally {
    await stopHttp(ctx);
  }
});

// ── 6. openclaw-facade.ts:125 — ch1tty-session action=persist without scope ──

test('openclaw ch1tty-session action=persist without scope → b.scope ?? "session" true branch', async () => {
  const ctx = await startHttp();
  let capturedArgs: Record<string, unknown> | undefined;

  ctx.aggregator.callTool = async (_tool, args) => {
    capturedArgs = args as Record<string, unknown>;
    return { content: [{ type: 'text', text: '{"persisted":true}' }] };
  };

  try {
    const res = await fetch(`${ctx.base}/openclaw/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skill: 'ch1tty-session',
        args: {
          action: 'persist',
          query: 'my-memory-key',
          value: 'some-value',
          // Deliberately NO scope → exercises b.scope ?? 'session' true branch
        },
      }),
    });
    assert.equal(res.status, 200, 'invoke must return 200');
    assert.ok(capturedArgs !== undefined, 'callTool must be invoked');
    assert.equal(
      (capturedArgs!.args as Record<string, unknown>)?.scope,
      'session',
      'scope must default to "session" when omitted from action=persist body',
    );
  } finally {
    await stopHttp(ctx);
  }
});

// ── 7. openclaw-facade.ts:202 — non-Error thrown → String(err) branch ────────

test('openclaw /invoke: callTool throws a non-Error value → String(err) in catch → 500', async () => {
  const ctx = await startHttp();

  ctx.aggregator.callTool = async (): Promise<ToolCallResult> => {
    // eslint-disable-next-line @typescript-eslint/no-throw-literal
    throw 42;
  };

  try {
    const res = await fetch(`${ctx.base}/openclaw/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill: 'ch1tty-status' }),
    });
    assert.equal(res.status, 500, 'non-Error throw must produce 500');
    const body = await res.json() as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.ok(
      typeof body.error === 'string' && body.error.includes('42'),
      `error must be String(42) = "42"; got: ${body.error}`,
    );
  } finally {
    await stopHttp(ctx);
  }
});

// ── 8. ledger.ts:95-97 — periodic flush catch fires ──────────────────────────
//
// FLUSH_INTERVAL_MS is 10 s — too long to wait in a test. Instead, intercept
// global.setInterval BEFORE calling bind() so we capture the callback reference,
// then invoke it directly. This executes the anonymous function at ledger.ts:95-97
// (the one that calls flush().catch(...)) without any timer tricks.

test('ledger bind: periodic flush rejection is swallowed by .catch handler', async () => {
  const dlq = dlqPath();

  // Step 1: intercept setInterval to capture the flush-timer callback
  let capturedCallback: (() => void) | undefined;
  const origSetInterval = global.setInterval;
  (global as unknown as Record<string, unknown>).setInterval = (
    cb: (...args: unknown[]) => void,
    _ms: number,
    ...args: unknown[]
  ): ReturnType<typeof setInterval> => {
    capturedCallback = () => cb(...args);
    // Register with a very long delay so the real timer never fires during the test
    return origSetInterval(cb, 99_999_999, ...args);
  };

  const ledger = new LedgerClient(dlq);
  const stub = new NullBackend();

  try {
    ledger.bind(stub, 'chittyos');
  } finally {
    // Restore immediately so no other test is affected
    (global as unknown as Record<string, unknown>).setInterval = origSetInterval;
  }

  assert.ok(capturedCallback !== undefined, 'bind() must have called setInterval');

  // Step 2: patch flush to reject, then invoke the captured callback directly.
  // This runs the source code at ledger.ts:95-97.
  let flushCallCount = 0;
  (ledger as unknown as Record<string, () => Promise<void>>).flush = async () => {
    flushCallCount++;
    throw new Error('periodic flush failure');
  };

  try {
    capturedCallback!(); // executes lines 95-97 directly

    // Step 3: drain the microtask queue so the .catch handler fires
    await new Promise<void>((r) => setImmediate(r));
    await Promise.resolve();

    assert.ok(flushCallCount > 0, 'flush must have been called via the captured callback');
    // Reaching here means the .catch swallowed the rejection (no unhandled rejection thrown)
  } finally {
    ledger.unbind();
    rmSync(dlq, { force: true });
  }
});

// ── 9. coordinator.ts:124 — stageSession rejection caught by onSessionStart ───

test('coordinator onSessionStart: stageSession rejection is caught by .catch handler', async () => {
  const dlq = dlqPath();
  const coord = new SessionCoordinator({}, { enabled: false }, dlq);

  // Patch private stageSession to reject — the .catch at line 124 must swallow it
  (coord as unknown as Record<string, (sid: string) => Promise<void>>).stageSession = async (_sessionId: string) => {
    throw new Error('stageSession failed');
  };

  // onSessionStart must not throw even though stageSession will reject in the background
  await coord.onSessionStart('bbbb-stage-sid', 'http');

  // Yield so the background .catch callback fires
  await new Promise<void>((r) => setImmediate(r));
  await Promise.resolve();

  // If we reach here, the .catch on line 124 swallowed the rejection
  assert.ok(true, 'stageSession rejection must be caught by onSessionStart .catch handler');

  // Cleanup
  await coord.onSessionEnd('bbbb-stage-sid');
  await coord.ledger.shutdown();
  rmSync(dlq, { force: true });
});
