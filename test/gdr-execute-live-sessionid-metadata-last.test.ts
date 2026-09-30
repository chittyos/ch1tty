/**
 * GDR drift guard: freeze `ch1tty/execute` live (non-dryRun) with sessionId — session
 * metadata is appended as the LAST content item.
 *
 * The execute path in handleMetaTool (src-stdio/aggregator.ts ~line 620) appends the
 * session-metadata item via `execResult.content.push(...)`. For a single-item backend
 * response this places the metadata at content[1] — coincidentally the same as
 * content[content.length - 1]. No merged test has verified the index using a
 * multi-item backend result, where only content[content.length - 1] is correct and
 * content[1] is wrong.
 *
 * GDR closes that gap by using a fixture backend whose tool returns THREE content items.
 * After execute with sessionId, content must have four items total; the metadata must be
 * the fourth (index 3 = content.length - 1), NOT the second (index 1).
 *
 *   GDR-1  multi-item backend + sessionId → content.length equals backend items + 1 (4)
 *   GDR-2  last item (content[length-1]) parses as metadata JSON ({ latencyMs, sessionContext })
 *   GDR-3  item at index 1 is NOT the metadata (verifies push, not splice-at-1)
 *   GDR-4  item at index 2 is NOT the metadata
 *   GDR-5  items [0..2] are the original backend content items, unmodified
 *
 * Contrast with existing tests (execute-session-context.test.ts, GN) that only verify
 * content[1] on single-item backends — correct there but wrong mental model for N > 1.
 *
 * Source: handleMetaTool in src-stdio/aggregator.ts (~line 612–622).
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
const TEST_SESSION = 'gdr-session-test';

/** Build a fresh Aggregator backed by FixtureBackend. */
function makeAgg(): { agg: Aggregator; backend: FixtureBackend } {
  const backend = new FixtureBackend();

  // Register the standard neon/stripe fixtures for registry population.
  backend.defineServer('neon', FIXTURE_SERVERS.neon);

  // Register a custom server whose tool returns THREE content items —
  // the key fixture that distinguishes index 1 from index (length - 1).
  backend.defineServer('multiitem', {
    tools: [
      {
        name: 'multi_result',
        description: 'A tool that returns three content items to test metadata append position',
        inputSchema: { type: 'object', properties: {} },
        response: {
          content: [
            { type: 'text', text: 'item-zero' },
            { type: 'text', text: 'item-one' },
            { type: 'text', text: 'item-two' },
          ],
        } satisfies ToolCallResult,
      },
    ],
  });

  const dlq = join(tmpdir(), `ch1tty-gdr-${Date.now()}-${++_seq}.jsonl`);
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
      {
        id: 'multiitem',
        name: 'MultiItem',
        type: 'remote',
        access: 'readwrite',
        category: 'ecosystem',
        endpoint: 'https://multiitem.example.com/mcp',
        lazy: true,
      } as ServerConfig,
    ],
    { backendFactory: () => backend, embedEnabled: false, ledgerDlqPath: dlq },
  );
  return { agg, backend };
}

/** Call ch1tty/execute (live, no dryRun) with sessionId and return the result. */
async function callExecuteLive(
  agg: Aggregator,
  tool: string,
): Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }> {
  return agg.callTool('ch1tty/execute', {
    tool,
    sessionId: TEST_SESSION,
  }) as Promise<{ isError?: boolean; content: Array<{ type: string; text?: string }> }>;
}

// ── GDR-1: multi-item backend + sessionId → content.length = backend items + 1 (4) ──

test('GDR-1: execute live with sessionId on multi-item backend → content.length is backend count + 1', async () => {
  const { agg } = makeAgg();
  try {
    const result = await callExecuteLive(agg, 'multiitem/multi_result');
    assert.equal(
      (result as { isError?: boolean }).isError,
      undefined,
      'GDR-1: execute must not return isError for a valid tool',
    );
    assert.equal(
      result.content.length,
      4,
      `GDR-1: multi-item backend returns 3 items; with sessionId the aggregator appends 1 metadata item → 4 total. Got ${result.content.length}.`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDR-2: last item (content[length-1]) parses as metadata JSON ──────────────

test('GDR-2: execute live with sessionId → content[content.length - 1] is the session metadata item', async () => {
  const { agg } = makeAgg();
  try {
    const result = await callExecuteLive(agg, 'multiitem/multi_result');
    const lastItem = result.content[result.content.length - 1];
    assert.ok(lastItem, 'GDR-2: result must have at least one content item');
    assert.equal(lastItem.type, 'text', 'GDR-2: last item must be type:text');

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(lastItem.text ?? '{}') as Record<string, unknown>;
    } catch {
      assert.fail(`GDR-2: last item text must be valid JSON; got "${lastItem.text?.slice(0, 80)}"`);
    }

    assert.ok(
      'latencyMs' in parsed,
      `GDR-2: last item must have latencyMs field; got keys: ${Object.keys(parsed).join(', ')}`,
    );
    assert.ok(
      'sessionContext' in parsed,
      `GDR-2: last item must have sessionContext field; got keys: ${Object.keys(parsed).join(', ')}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDR-3: content[1] is NOT the metadata (push, not splice-at-1) ────────────

test('GDR-3: execute live with sessionId on multi-item backend → content[1] is the SECOND backend item, not metadata', async () => {
  const { agg } = makeAgg();
  try {
    const result = await callExecuteLive(agg, 'multiitem/multi_result');
    assert.ok(result.content.length >= 2, 'GDR-3: result must have at least 2 items');
    const secondItem = result.content[1];

    // The second item should be the original 'item-one' backend text, not the metadata JSON.
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(secondItem.text ?? '');
    } catch {
      // Not JSON at all → definitely not metadata
    }

    const isMetadata =
      parsed !== null &&
      typeof parsed === 'object' &&
      'latencyMs' in (parsed as Record<string, unknown>) &&
      'sessionContext' in (parsed as Record<string, unknown>);

    assert.equal(
      isMetadata,
      false,
      'GDR-3: content[1] must be the second original backend item ("item-one"), ' +
        'not the appended session metadata. The aggregator uses push(), so metadata lands at ' +
        'content[content.length - 1] (index 3 for a 3-item backend), never at index 1.',
    );
    assert.equal(
      secondItem.text,
      'item-one',
      `GDR-3: content[1].text must be the second backend item "item-one"; got "${secondItem.text?.slice(0, 80)}"`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDR-4: content[2] is NOT the metadata ────────────────────────────────────

test('GDR-4: execute live with sessionId on multi-item backend → content[2] is the THIRD backend item, not metadata', async () => {
  const { agg } = makeAgg();
  try {
    const result = await callExecuteLive(agg, 'multiitem/multi_result');
    assert.ok(result.content.length >= 3, 'GDR-4: result must have at least 3 items');
    const thirdItem = result.content[2];

    let parsed: unknown = null;
    try {
      parsed = JSON.parse(thirdItem.text ?? '');
    } catch {
      // Not JSON at all → definitely not metadata
    }

    const isMetadata =
      parsed !== null &&
      typeof parsed === 'object' &&
      'latencyMs' in (parsed as Record<string, unknown>) &&
      'sessionContext' in (parsed as Record<string, unknown>);

    assert.equal(
      isMetadata,
      false,
      'GDR-4: content[2] must be the third original backend item ("item-two"), ' +
        'not the appended session metadata.',
    );
    assert.equal(
      thirdItem.text,
      'item-two',
      `GDR-4: content[2].text must be the third backend item "item-two"; got "${thirdItem.text?.slice(0, 80)}"`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GDR-5: items [0..2] are the original backend content items, unmodified ───

test('GDR-5: execute live with sessionId on multi-item backend → content[0..2] are original backend items unmodified', async () => {
  const { agg } = makeAgg();
  try {
    const result = await callExecuteLive(agg, 'multiitem/multi_result');
    assert.equal(result.content.length, 4, 'GDR-5: must have 4 content items (3 backend + 1 metadata)');

    const expected = ['item-zero', 'item-one', 'item-two'];
    for (let i = 0; i < expected.length; i++) {
      assert.equal(
        result.content[i].type,
        'text',
        `GDR-5: content[${i}].type must be "text"`,
      );
      assert.equal(
        result.content[i].text,
        expected[i],
        `GDR-5: content[${i}].text must equal "${expected[i]}" (original backend item ${i}); got "${result.content[i].text?.slice(0, 60)}"`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});
