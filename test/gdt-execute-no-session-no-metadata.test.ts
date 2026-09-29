/**
 * GDT drift guard: freeze `ch1tty/execute` live (non-dryRun) WITHOUT sessionId —
 * when no sessionId is supplied, no session metadata is appended to content.
 *
 * Source: handleMetaTool execute branch in src-stdio/aggregator.ts (~line 612–621).
 * The metadata append is gated on:
 *   if (execSessionId && this.coordinator.hasSession(execSessionId))
 *
 * So when no sessionId is present, execSessionId is undefined and the push never
 * fires — content remains exactly what the backend returned.
 *
 * Key invariants frozen here:
 *
 *   GDT-1  execute without sessionId → isError not set (response is valid)
 *   GDT-2  execute without sessionId → content.length === 1 (backend item only, no metadata)
 *   GDT-3  execute without sessionId → content[0].type === 'text' (backend item intact)
 *   GDT-4  execute without sessionId → content[0].text does NOT parse to an object with latencyMs
 *   GDT-5  multiple sequential executes without sessionId → content.length stays 1 every call
 *
 * Contrast: GDR verified the metadata IS appended at the last position when sessionId IS
 * present. GDT is the complementary invariant: no sessionId → no metadata appended.
 *
 * Frozen 2026-09-28.
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
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;

/** Build a fresh Aggregator backed by FixtureBackend with neon registered. */
function makeAgg(): { agg: Aggregator; backend: FixtureBackend } {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);

  const dlq = join(tmpdir(), `ch1tty-gdt-${Date.now()}-${++_seq}.jsonl`);
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

/** Call ch1tty/execute WITHOUT a sessionId and return the raw ToolCallResult. */
async function execNoSession(
  agg: Aggregator,
  tool: string,
): Promise<ToolCallResult & { content: Array<{ type: string; text?: string }> }> {
  return (await agg.callTool('ch1tty/execute', { tool })) as ToolCallResult & {
    content: Array<{ type: string; text?: string }>;
  };
}

// ── GDT-1: no sessionId → isError not set ────────────────────────────────────

test('GDT-1: execute without sessionId → isError not set (response is valid)', async () => {
  const { agg } = makeAgg();
  try {
    const result = await execNoSession(agg, 'neon/list_projects');
    assert.equal(
      result.isError,
      undefined,
      `GDT-1: isError must be undefined when tool exists and no sessionId given; got ${result.isError}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDT-2: no sessionId → content.length === 1 (no metadata appended) ────────

test('GDT-2: execute without sessionId → content.length is exactly 1 (no session metadata appended)', async () => {
  const { agg } = makeAgg();
  try {
    const result = await execNoSession(agg, 'neon/list_projects');
    assert.equal(
      result.content.length,
      1,
      `GDT-2: content must have exactly 1 item when no sessionId is provided; ` +
        `got ${result.content.length}. ` +
        'Session metadata (latencyMs + sessionContext) is only appended when execSessionId is set ' +
        'AND coordinator.hasSession() returns true. Without a sessionId there is nothing to track.',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDT-3: no sessionId → content[0].type === 'text' (backend item intact) ───

test('GDT-3: execute without sessionId → content[0].type is "text" (raw backend response intact)', async () => {
  const { agg } = makeAgg();
  try {
    const result = await execNoSession(agg, 'neon/list_projects');
    assert.equal(
      result.content[0]?.type,
      'text',
      `GDT-3: content[0].type must be "text" (the raw backend text item); got ${result.content[0]?.type}`,
    );
    assert.ok(
      typeof result.content[0]?.text === 'string' && result.content[0].text.length > 0,
      `GDT-3: content[0].text must be a non-empty string; got ${JSON.stringify(result.content[0]?.text)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDT-4: no sessionId → content[0] is raw backend text, not session metadata ──

test('GDT-4: execute without sessionId → content[0].text does not contain a top-level latencyMs key', async () => {
  const { agg } = makeAgg();
  try {
    const result = await execNoSession(agg, 'neon/list_projects');
    const text = result.content[0]?.text ?? '';

    // Attempt to parse and check that latencyMs is not at the top level.
    // The backend fixture returns a JSON array (projects list), not a {latencyMs, sessionContext} object.
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null; // non-JSON text is fine — it definitely doesn't have latencyMs
    }

    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      assert.ok(
        !('latencyMs' in (parsed as Record<string, unknown>)),
        `GDT-4: content[0].text must NOT contain a top-level "latencyMs" key; ` +
          'that key is only present in the session-metadata item appended when a sessionId is active. ' +
          `Got: ${JSON.stringify(Object.keys(parsed as object))}`,
      );
    }
    // If parsed is an array or non-JSON string, it definitively does not have latencyMs at top level.
  } finally {
    await agg.shutdown();
  }
});

// ── GDT-5: multiple executes without sessionId → content.length stays 1 ─────

test('GDT-5: multiple sequential executes without sessionId → content.length stays 1 every call', async () => {
  const { agg } = makeAgg();
  try {
    for (let i = 1; i <= 3; i++) {
      const result = await execNoSession(agg, 'neon/list_projects');
      assert.equal(
        result.content.length,
        1,
        `GDT-5: call ${i} — content.length must remain 1 without a sessionId; ` +
          `got ${result.content.length}. Session metadata must never accumulate across calls ` +
          'when no session tracking is active.',
      );
    }
  } finally {
    await agg.shutdown();
  }
});
