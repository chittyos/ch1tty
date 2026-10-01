/**
 * GZ drift guard: freeze `ch1tty/execute` error-path behavior.
 *
 * When a backend returns `isError: true`, two distinct behaviors are frozen here:
 *
 *   1. The error response is passed through UNCHANGED — no session metadata is
 *      appended (content.length stays at the backend's error content length, not +1).
 *      Source: handleMetaTool execute branch gates the metadata append on
 *      `if (!execResult.isError)` (src-stdio/aggregator.ts ~line 601).
 *
 *   2. The error call IS still tracked in the session state. The coordinator.onToolCall()
 *      and sessions.recordToolCall() calls happen unconditionally right after
 *      backend.callTool() returns, regardless of isError (src-stdio/aggregator.ts ~line 942).
 *      So a backend error increments callCount and adds to recentTools.
 *
 * These two invariants are complementary and together define the full contract for
 * the error path. No existing GD test covers this combination:
 *   GDT — no-sessionId path (no tracking, no metadata either way)
 *   GDR — multi-item success path (metadata appended as last item)
 *   GDW — metadata outer key set on success path
 *   GDD — sessionContext exact key sets on success path
 *   GY  — session eviction resets state
 *
 * Key invariants frozen here:
 *
 *   GZ-1  execute + sessionId + backend isError:true → result.isError is truthy
 *   GZ-2  execute + sessionId + backend isError:true → content.length equals
 *         the backend error content count (no +1 metadata appended)
 *   GZ-3  execute + sessionId + backend isError:true → content[0] is the exact
 *         backend error item (text passthrough, not rewritten)
 *   GZ-4  execute + sessionId + backend isError:true → subsequent SUCCESS call's
 *         callCount reflects the prior error call (error IS tracked)
 *   GZ-5  execute + sessionId + backend isError:true → no content item contains
 *         a top-level latencyMs key (metadata never appended on error)
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (execute path, not cast explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig, ToolCallResult } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;

const ERROR_TOOL_TEXT = 'Simulated error in neon/fail_tool';

function makeAgg(): { agg: Aggregator; backend: FixtureBackend } {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'fail_tool',
        description: 'A tool that always returns isError:true',
        inputSchema: { type: 'object', properties: {} },
        response: 'error',
      },
      {
        name: 'list_projects',
        description: 'A tool that returns a successful response',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '[]' }] },
      },
    ],
  });

  const dlq = join(tmpdir(), `ch1tty-gz-${Date.now()}-${++_seq}.jsonl`);
  const agg = new Aggregator(
    [
      {
        id: 'neon',
        name: 'Neon',
        type: 'remote',
        access: 'readwrite',
        category: 'code',
        endpoint: 'https://neon.tech/mcp',
        lazy: true,
      } as ServerConfig,
    ],
    { backendFactory: () => backend, embedEnabled: false, ledgerDlqPath: dlq },
  );
  return { agg, backend };
}

type ContentItem = { type: string; text?: string };

async function callWithSession(
  agg: Aggregator,
  tool: string,
  sessionId: string,
): Promise<{ isError?: boolean; content: ContentItem[] }> {
  return (await agg.callTool('ch1tty/execute', { tool, sessionId })) as {
    isError?: boolean;
    content: ContentItem[];
  };
}

// ── GZ-1: backend isError:true → result.isError is truthy ────────────────────

test('GZ-1: execute + sessionId + backend isError:true → result.isError is truthy', async () => {
  const { agg } = makeAgg();
  try {
    const result = await callWithSession(agg, 'neon/fail_tool', 'gz-session-1');
    assert.ok(
      result.isError === true,
      `GZ-1: isError must be true when backend returns an error; got ${result.isError}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GZ-2: backend isError:true → content.length equals backend error content count ──

test('GZ-2: execute + sessionId + backend isError:true → content.length equals backend error item count (no metadata appended)', async () => {
  const { agg } = makeAgg();
  try {
    const result = await callWithSession(agg, 'neon/fail_tool', 'gz-session-2');
    assert.equal(
      result.content.length,
      1,
      `GZ-2: content.length must equal the backend error content count (1). ` +
        `Session metadata is only appended when execResult.isError is falsy — ` +
        `the guard is "if (!execResult.isError)" in handleMetaTool. ` +
        `Got content.length = ${result.content.length}.`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GZ-3: backend isError:true → content[0] is the exact backend error item ──

test('GZ-3: execute + sessionId + backend isError:true → content[0].text is the backend error text (passthrough, not rewritten)', async () => {
  const { agg } = makeAgg();
  try {
    const result = await callWithSession(agg, 'neon/fail_tool', 'gz-session-3');
    assert.equal(
      result.content[0]?.type,
      'text',
      `GZ-3: content[0].type must be "text"; got ${result.content[0]?.type}`,
    );
    assert.equal(
      result.content[0]?.text,
      ERROR_TOOL_TEXT,
      `GZ-3: content[0].text must be the exact backend error text "${ERROR_TOOL_TEXT}"; ` +
        `got "${result.content[0]?.text}"`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GZ-4: backend isError:true → error call IS tracked (callCount increments) ─

test('GZ-4: execute + sessionId + backend isError:true → the error call IS counted in subsequent callCount', async () => {
  const { agg } = makeAgg();
  try {
    const sessionId = `gz-session-4-${Date.now()}`;

    // First call: error tool (isError:true) — this should STILL be tracked.
    const errResult = await callWithSession(agg, 'neon/fail_tool', sessionId);
    assert.ok(errResult.isError === true, 'GZ-4 setup: error tool must return isError:true');

    // Second call: success tool (isError not set) — metadata is appended.
    const successResult = await callWithSession(agg, 'neon/list_projects', sessionId);
    assert.ok(!successResult.isError, 'GZ-4: second call (success) must not return isError');

    // Extract session metadata from the last content item.
    const metaItem = successResult.content[successResult.content.length - 1];
    assert.ok(metaItem?.type === 'text', 'GZ-4: last content item must be type:text');
    const meta = JSON.parse(metaItem.text!) as { latencyMs: number; sessionContext: { callCount: number; recentTools: string[] } };

    // callCount must be 2: error call (tracked) + success call.
    assert.equal(
      meta.sessionContext.callCount,
      2,
      `GZ-4: callCount must be 2 after one error call + one success call. ` +
        `backend.callTool() returns the result and coordinator.onToolCall() is called ` +
        `unconditionally right after, regardless of isError — so error calls are tracked. ` +
        `Got callCount = ${meta.sessionContext.callCount}.`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GZ-5: backend isError:true → no content item has a top-level latencyMs key ─

test('GZ-5: execute + sessionId + backend isError:true → no content item contains a top-level latencyMs key', async () => {
  const { agg } = makeAgg();
  try {
    const result = await callWithSession(agg, 'neon/fail_tool', 'gz-session-5');
    for (let i = 0; i < result.content.length; i++) {
      const item = result.content[i];
      if (item.type !== 'text' || typeof item.text !== 'string') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(item.text);
      } catch {
        continue; // non-JSON → definitely not metadata
      }
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        assert.ok(
          !('latencyMs' in (parsed as Record<string, unknown>)),
          `GZ-5: content[${i}].text must NOT contain a top-level "latencyMs" key. ` +
            'Session metadata (with latencyMs) is ONLY appended when isError is falsy. ' +
            `Got keys: ${Object.keys(parsed as object).join(', ')}`,
        );
      }
    }
  } finally {
    await agg.shutdown();
  }
});
