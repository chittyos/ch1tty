/**
 * GZ drift guard: freeze ch1tty/execute live-path content[0] type+shape invariants
 * when a real backend responds successfully and a sessionId is active.
 *
 * Existing coverage leaves a gap:
 *   GDT-3 freezes content[0].type === 'text' WITHOUT sessionId (no metadata appended).
 *   GDR-5 freezes content[0].type using a custom multi-item backend WITH sessionId.
 *   Neither test uses a STANDARD single-item fixture backend WITH sessionId and asserts
 *   the exact shape (type, text, key set) of content[0] independently.
 *
 * Source: handleExecute → backend.callTool; wrapping path aggregator.ts ~595–624
 *         (live, non-dryRun branch: appends session metadata at END, does NOT touch content[0])
 *
 * Invariants frozen:
 *
 *   GZ-1  live + sessionId → content[0].type === 'text'
 *           (standard stripe fixture, single-item backend response)
 *
 *   GZ-2  live + sessionId → content[0].text is a non-empty string
 *           (the raw backend payload, never undefined or null)
 *
 *   GZ-3  live + sessionId → content[0] has EXACTLY two keys: {type, text}
 *           (no annotations, no id, no extra fields appended by the aggregator path)
 *
 *   GZ-4  live + sessionId → content[0].text !== content[content.length-1].text
 *           (raw backend response is NOT the same object/text as the appended metadata)
 *
 *   GZ-5  live + sessionId → content[0].text does NOT parse to an object containing
 *           both latencyMs AND sessionContext — i.e. content[0] is the raw backend
 *           response; the metadata item is only appended at content[content.length-1]
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
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
const GZ_SESSION = 'gz-session-live-content';

function makeAgg(): { agg: Aggregator; stripeTool: string } {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);

  const dlq = join(tmpdir(), `ch1tty-gz-${Date.now()}-${++_seq}.jsonl`);
  const agg = new Aggregator(
    [{
      id: 'stripe',
      name: 'Stripe',
      type: 'remote',
      access: 'readwrite',
      category: 'ecosystem',
      endpoint: 'https://stripe.com/mcp',
      lazy: true,
    } as ServerConfig],
    { backendFactory: () => backend, embedEnabled: false, ledgerDlqPath: dlq },
  );

  const stripeTool = `stripe/${FIXTURE_SERVERS.stripe.tools[0].name}`; // stripe/list_payments
  return { agg, stripeTool };
}

// ── GZ-1: content[0].type === 'text' (with sessionId) ────────────────────────

test('GZ-1: live execute + sessionId → content[0].type is "text"', async () => {
  const { agg, stripeTool } = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/execute', { tool: stripeTool, sessionId: GZ_SESSION });
    assert.equal(result.isError, undefined, 'GZ-1: execute must not error');
    assert.equal(
      result.content[0]?.type,
      'text',
      `GZ-1: content[0].type must be "text" for a successful live execute with sessionId; got ${JSON.stringify(result.content[0]?.type)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GZ-2: content[0].text is a non-empty string (with sessionId) ─────────────

test('GZ-2: live execute + sessionId → content[0].text is a non-empty string', async () => {
  const { agg, stripeTool } = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/execute', { tool: stripeTool, sessionId: GZ_SESSION });
    assert.equal(result.isError, undefined, 'GZ-2: execute must not error');
    assert.equal(
      typeof result.content[0]?.text,
      'string',
      `GZ-2: content[0].text must be a string; got ${typeof result.content[0]?.text}`,
    );
    assert.ok(
      (result.content[0]?.text as string).length > 0,
      'GZ-2: content[0].text must be non-empty',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GZ-3: content[0] has EXACTLY {type, text} keys (with sessionId) ──────────

test('GZ-3: live execute + sessionId → content[0] has exactly the keys {type, text} and no extras', async () => {
  const { agg, stripeTool } = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/execute', { tool: stripeTool, sessionId: GZ_SESSION });
    assert.equal(result.isError, undefined, 'GZ-3: execute must not error');
    const keys = Object.keys(result.content[0] ?? {}).sort();
    assert.deepEqual(
      keys,
      ['text', 'type'],
      `GZ-3: content[0] must have exactly {type, text}; got ${JSON.stringify(keys)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GZ-4: content[0].text !== session metadata text (with sessionId) ──────────

test('GZ-4: live execute + sessionId → content[0].text differs from the appended session metadata text', async () => {
  const { agg, stripeTool } = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/execute', { tool: stripeTool, sessionId: GZ_SESSION });
    assert.equal(result.isError, undefined, 'GZ-4: execute must not error');
    assert.ok(
      result.content.length >= 2,
      `GZ-4: must have at least 2 content items (backend + metadata) when sessionId is active; got ${result.content.length}`,
    );
    assert.notEqual(
      result.content[0]?.text,
      result.content[result.content.length - 1]?.text,
      'GZ-4: content[0].text must differ from the last item text (session metadata); they must not be identical',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GZ-5: content[0].text is NOT session metadata JSON (with sessionId) ───────

test('GZ-5: live execute + sessionId → content[0].text does not contain latencyMs+sessionContext (raw backend response, not metadata)', async () => {
  const { agg, stripeTool } = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/execute', { tool: stripeTool, sessionId: GZ_SESSION });
    assert.equal(result.isError, undefined, 'GZ-5: execute must not error');
    const firstText = result.content[0]?.text as string;
    assert.equal(typeof firstText, 'string', `GZ-5: content[0].text must be a string; got ${typeof firstText}`);

    let parsed: unknown = null;
    try { parsed = JSON.parse(firstText); } catch { /* non-JSON text is fine — definitely not metadata */ }

    if (parsed !== null && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      assert.ok(
        !('latencyMs' in obj && 'sessionContext' in obj),
        `GZ-5: content[0].text must NOT be the session-metadata JSON (latencyMs + sessionContext); ` +
        `content[0] is the raw backend response — metadata is only at content[content.length-1]`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});
