/**
 * GFB drift guard: freeze cast:executed outer content array passthrough.
 *
 * Background
 * ----------
 * cast:executed builds its outer response content as:
 *   content[0]   = { type: 'text', text: JSON.stringify({cast:'executed', ...}) }
 *   content[1..] = ...result.content   ← backend items spread verbatim
 *   isError      = result.isError       ← hoisted from backend result
 *
 * Source: src-stdio/aggregator.ts
 *   line ~1671: ...result.content,
 *   line ~1673: isError: result.isError,
 *
 * What prior tests freeze
 * -----------------------
 *   go (test 4): content.length >= 2 — confirmed at least one backend item exists.
 *   gfa/gv/gei/geh/gvf etc: content[0].type === 'text', content[0].text parses
 *     as cast metadata — frozen extensively.
 *   GAY/EA/GFA etc: body keys, resolved, intent, etc. — frozen.
 *
 * Remaining gaps
 * --------------
 *   (a) content.length is EXACTLY 1 + backendItemCount for a single-item backend.
 *       go only checks >= 2, not the exact count. A regression that appends an
 *       extra synthetic item would pass go silently.
 *
 *   (b) content[1].type === 'text'.
 *       No test verifies the item-type of the backend passthrough item in
 *       cast:executed. A regression wrapping the result in a sub-object or
 *       changing type to 'image' passes silently.
 *
 *   (c) content[1].text equals the backend's response text exactly (passthrough,
 *       not rewritten or truncated). No test freezes the value.
 *
 *   (d) Outer isError is undefined when backend succeeds. Several test helpers
 *       assert isError === undefined, but specifically for the OUTER envelope of
 *       cast:executed (not execute) is never individually frozen.
 *
 *   (e) Multi-item backend: all N items are preserved in content[1..N] exactly.
 *       A regression that drops any item beyond the first would pass all prior
 *       tests (which only inspect content[0]).
 *
 * GFB closes those gaps:
 *
 *   GFB-1  cast:executed outer content has EXACTLY 2 items for a single-item
 *          backend (metadata + 1 backend item; no extra items injected).
 *
 *   GFB-2  content[1].type === 'text' (backend item type preserved verbatim).
 *
 *   GFB-3  content[1].text equals the backend's response text exactly
 *          (passthrough — not rewritten, not truncated).
 *
 *   GFB-4  Outer isError is undefined when backend succeeds (no spurious error
 *          flag hoisted from a successful backend call).
 *
 *   GFB-5  Multi-item backend: content.length === 1 + N, and each content[1..N]
 *          text matches the backend's Nth item exactly (exact array passthrough).
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (outer content array
 *     passthrough, not explanation sub-object fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gfb-${Date.now()}-${++_seq}.jsonl`);
}

const NEON_CFG: ServerConfig = {
  id: 'neon',
  name: 'Neon DB',
  type: 'remote',
  access: 'readwrite',
  category: 'code',
  endpoint: 'https://neon.tech/mcp',
  lazy: true,
};

// Single-item backend: returns one text content item.
function makeAgg(backendItemCount: number = 1): Aggregator {
  const backend = new FixtureBackend();

  const singleItem = {
    name: 'run_sql',
    description: 'execute a sql query on neon database',
    inputSchema: { type: 'object', properties: {} },
    response: backendItemCount === 1
      ? { content: [{ type: 'text', text: 'query-result-row-1' }] }
      : {
          content: Array.from({ length: backendItemCount }, (_, i) => ({
            type: 'text',
            text: `query-result-row-${i + 1}`,
          })),
        },
  };

  backend.defineServer('neon', { tools: [singleItem] });

  return new Aggregator([NEON_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

async function castExecuted(
  agg: Aggregator,
  intent: string = 'run sql query on neon database',
): Promise<{ body: Record<string, unknown>; outerContent: Array<{ type: string; text?: string }>; outerIsError: unknown }> {
  const result = await agg.callTool('ch1tty/cast', { intent });
  const outerContent = result.content as Array<{ type: string; text?: string }>;
  const outerIsError = (result as Record<string, unknown>)['isError'];

  assert.ok(Array.isArray(outerContent) && outerContent.length >= 1,
    `outer content must have ≥1 items: ${JSON.stringify(result.content)}`);
  assert.equal(outerContent[0]!.type, 'text',
    `content[0].type must be 'text'`);

  const body = JSON.parse(outerContent[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'executed',
    `expected cast:executed, got cast:${String(body['cast'])}`);

  return { body, outerContent, outerIsError };
}

// ── GFB-1: outer content is exactly 2 items for single-item backend ───────────

test('GFB-1: cast:executed outer content has exactly 2 items for a single-item backend (no extra items injected)', async () => {
  const agg = makeAgg(1);
  try {
    const { outerContent } = await castExecuted(agg);
    assert.equal(
      outerContent.length,
      2,
      `GFB-1: content.length must be exactly 2 (1 metadata + 1 backend item); got ${outerContent.length}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GFB-2: content[1].type === 'text' ─────────────────────────────────────────

test('GFB-2: cast:executed content[1].type === "text" (backend item type preserved verbatim)', async () => {
  const agg = makeAgg(1);
  try {
    const { outerContent } = await castExecuted(agg);
    assert.ok(outerContent.length >= 2,
      `GFB-2: outer content must have at least 2 items; got ${outerContent.length}`);
    assert.equal(
      outerContent[1]!.type,
      'text',
      `GFB-2: content[1].type must be 'text' (backend item type preserved); got '${outerContent[1]!.type}'`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GFB-3: content[1].text equals backend response text exactly ───────────────

test('GFB-3: cast:executed content[1].text equals the backend response text exactly (passthrough, not rewritten)', async () => {
  const agg = makeAgg(1);
  try {
    const { outerContent } = await castExecuted(agg);
    assert.ok(outerContent.length >= 2,
      `GFB-3: outer content must have at least 2 items; got ${outerContent.length}`);
    const EXPECTED_TEXT = 'query-result-row-1';
    assert.equal(
      outerContent[1]!.text,
      EXPECTED_TEXT,
      `GFB-3: content[1].text must equal backend output "${EXPECTED_TEXT}" exactly; got "${String(outerContent[1]!.text)}"`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GFB-4: outer isError is undefined when backend succeeds ───────────────────

test('GFB-4: cast:executed outer isError is undefined when backend succeeds (no spurious error flag)', async () => {
  const agg = makeAgg(1);
  try {
    const { outerIsError } = await castExecuted(agg);
    assert.equal(
      outerIsError,
      undefined,
      `GFB-4: outer isError must be undefined on successful backend call; got ${JSON.stringify(outerIsError)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GFB-5: multi-item backend — all items preserved exactly in content[1+] ────

test('GFB-5: cast:executed with multi-item backend preserves all N backend items at content[1..N] exactly', async () => {
  const N = 3;
  const agg = makeAgg(N);
  try {
    const { outerContent } = await castExecuted(agg);
    assert.equal(
      outerContent.length,
      1 + N,
      `GFB-5: content.length must be exactly ${1 + N} (1 metadata + ${N} backend items); got ${outerContent.length}`,
    );
    for (let i = 0; i < N; i++) {
      const item = outerContent[1 + i]!;
      const expectedText = `query-result-row-${i + 1}`;
      assert.equal(
        item.type,
        'text',
        `GFB-5: content[${1 + i}].type must be 'text'; got '${item.type}'`,
      );
      assert.equal(
        item.text,
        expectedText,
        `GFB-5: content[${1 + i}].text must be "${expectedText}" (exact passthrough); got "${String(item.text)}"`,
      );
    }
  } finally {
    await agg.shutdown();
  }
});
