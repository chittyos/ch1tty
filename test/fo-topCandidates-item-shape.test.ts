/**
 * FO: Freeze the per-item key set of the `topCandidates` array in cast explain.
 *
 * Existing tests (search-explain, rrrr, bj) confirm topCandidates is an array
 * and topCandidates[0].tool matches the winner, but no test freezes the FULL
 * key set of each item. This guard catches silent additions or removals of
 * per-item properties.
 *
 * topCandidates item shape (cast explain):
 *   • No focus active:   { tool: string, score: number }
 *   • Focus active:      { tool: string, score: number, inFocus: boolean }
 *
 * Note: `server` is NOT part of the topCandidates item in cast explain
 * (unlike search result items). The per-item keys are strictly the two or
 * three listed above.
 *
 * CLAUDE.md compliance:
 *   - 5-tool surface: unchanged (test-only change)
 *   - buildCastExplanation metric freeze: no new fields added; this test
 *     freezes the per-item shape of existing topCandidates entries only.
 *
 * Frozen 2026-09-20.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

class NullRoutingCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon',   type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',      lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp',      lazy: true },
  { id: 'tasks',  name: 'Tasks',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp', lazy: true },
];

/**
 * Inline focus profiles keep the suite hermetic: CH1TTY_FOCUS_PROFILES env var
 * cannot override the 'code' profile definition at runtime.
 * neon is in-focus (category 'code'); stripe and tasks are out-of-focus.
 */
const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code'] as string[], servers: ['neon'] as string[], boost: 0.5 },
  },
};

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-fo-${Date.now()}-${++dlqSeq}.jsonl`);
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks',  FIXTURE_SERVERS.tasks);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    focusProfiles: FOCUS_PROFILES,
    coordinator: new NullRoutingCoordinator({}, { enabled: false }),
  } as Parameters<typeof Aggregator>[1]);
}

async function getTopCandidates(
  agg: Aggregator,
  focusArg?: string,
): Promise<Array<Record<string, unknown>>> {
  const result = await agg.callTool('ch1tty/cast', {
    intent: 'list database projects',
    explain: true,
    verbosity: 'low',
    dryRun: true,
    ...(focusArg !== undefined ? { focus: focusArg } : {}),
  });
  assert.equal(result.isError, undefined, 'cast must not error');
  const body = JSON.parse(
    (result.content[0] as { text: string }).text,
  ) as Record<string, unknown>;
  const exp = body.explanation as Record<string, unknown>;
  assert.ok(exp !== undefined, 'explanation must be present');
  const tc = exp.topCandidates;
  assert.ok(Array.isArray(tc), 'topCandidates must be an array');
  assert.ok((tc as unknown[]).length > 0, 'topCandidates must be non-empty');
  return tc as Array<Record<string, unknown>>;
}

// ── Suite FO-1: No-focus item key set ────────────────────────────────────────
// Without a focus profile, each topCandidates item must have exactly
// { tool, score } — no extra or missing keys.

describe('FO-1: topCandidates item shape — no focus', () => {
  test('FO-1a: each item has exactly the keys [tool, score]', async () => {
    const agg = makeAgg();
    const items = await getTopCandidates(agg); // no focus
    for (const [i, item] of items.entries()) {
      const keys = Object.keys(item).sort();
      assert.deepEqual(
        keys,
        ['score', 'tool'],
        `topCandidates[${i}] must have exactly keys [tool, score]; got [${keys.join(', ')}]`,
      );
    }
  });

  test('FO-1b: item.tool is a non-empty string', async () => {
    const agg = makeAgg();
    const items = await getTopCandidates(agg);
    for (const [i, item] of items.entries()) {
      assert.equal(typeof item.tool, 'string', `topCandidates[${i}].tool must be string`);
      assert.ok((item.tool as string).length > 0, `topCandidates[${i}].tool must be non-empty`);
    }
  });

  test('FO-1c: item.score is a finite non-negative number', async () => {
    const agg = makeAgg();
    const items = await getTopCandidates(agg);
    for (const [i, item] of items.entries()) {
      assert.equal(typeof item.score, 'number', `topCandidates[${i}].score must be number`);
      assert.ok(Number.isFinite(item.score as number), `topCandidates[${i}].score must be finite`);
      assert.ok((item.score as number) >= 0, `topCandidates[${i}].score must be >= 0`);
    }
  });

  test('FO-1d: item has no inFocus key when no focus is active', async () => {
    const agg = makeAgg(); // no focus
    const items = await getTopCandidates(agg);
    for (const [i, item] of items.entries()) {
      assert.equal(
        'inFocus' in item,
        false,
        `topCandidates[${i}].inFocus must be absent when no focus is active`,
      );
    }
  });
});

// ── Suite FO-2: Focus-active item key set ─────────────────────────────────────
// With focus active (code), each topCandidates item must have exactly
// { tool, score, inFocus } where inFocus is a boolean.

describe('FO-2: topCandidates item shape — focus active (code)', () => {
  test('FO-2a: each item has exactly the keys [inFocus, score, tool]', async () => {
    const agg = makeAgg();
    const items = await getTopCandidates(agg, 'code');
    for (const [i, item] of items.entries()) {
      const keys = Object.keys(item).sort();
      assert.deepEqual(
        keys,
        ['inFocus', 'score', 'tool'],
        `topCandidates[${i}] with focus must have exactly keys [tool, score, inFocus]; got [${keys.join(', ')}]`,
      );
    }
  });

  test('FO-2b: item.inFocus is a boolean', async () => {
    const agg = makeAgg();
    const items = await getTopCandidates(agg, 'code');
    for (const [i, item] of items.entries()) {
      assert.equal(
        typeof item.inFocus,
        'boolean',
        `topCandidates[${i}].inFocus must be boolean; got ${typeof item.inFocus}`,
      );
    }
  });

  test('FO-2c: item.tool is a non-empty string (focus path)', async () => {
    const agg = makeAgg();
    const items = await getTopCandidates(agg, 'code');
    for (const [i, item] of items.entries()) {
      assert.equal(typeof item.tool, 'string', `topCandidates[${i}].tool must be string`);
      assert.ok((item.tool as string).length > 0, `topCandidates[${i}].tool must be non-empty`);
    }
  });

  test('FO-2d: item.score is a finite non-negative number (focus path)', async () => {
    const agg = makeAgg();
    const items = await getTopCandidates(agg, 'code');
    for (const [i, item] of items.entries()) {
      assert.equal(typeof item.score, 'number', `topCandidates[${i}].score must be number`);
      assert.ok(Number.isFinite(item.score as number), `topCandidates[${i}].score must be finite`);
      assert.ok((item.score as number) >= 0, `topCandidates[${i}].score must be >= 0`);
    }
  });

  test('FO-2e: at least one item has inFocus:true (neon is in-focus for category:code)', async () => {
    const agg = makeAgg();
    const items = await getTopCandidates(agg, 'code');
    const anyInFocus = items.some((item) => item.inFocus === true);
    assert.ok(anyInFocus, 'at least one topCandidates item must have inFocus:true when focus:code active');
  });

  test('FO-2f: items with out-of-focus server have inFocus:false', async () => {
    const agg = makeAgg();
    const items = await getTopCandidates(agg, 'code');
    // stripe/tasks are category:ecosystem, out of focus for code profile
    for (const [i, item] of items.entries()) {
      const toolName = item.tool as string;
      const server = toolName.split('/')[0];
      if (server === 'stripe' || server === 'tasks') {
        assert.equal(
          item.inFocus,
          false,
          `topCandidates[${i}] (${toolName}) is out-of-focus for code profile — inFocus must be false`,
        );
      }
    }
  });
});

// ── Suite FO-3: Ordering invariants ──────────────────────────────────────────
// Scores in topCandidates must be non-increasing (highest first).

describe('FO-3: topCandidates ordering', () => {
  test('FO-3a: topCandidates scores are non-increasing (no-focus)', async () => {
    const agg = makeAgg();
    const items = await getTopCandidates(agg);
    for (let i = 1; i < items.length; i++) {
      assert.ok(
        (items[i - 1].score as number) >= (items[i].score as number),
        `topCandidates[${i - 1}].score (${items[i - 1].score}) must be >= topCandidates[${i}].score (${items[i].score})`,
      );
    }
  });

  test('FO-3b: topCandidates scores are non-increasing (focus active)', async () => {
    const agg = makeAgg();
    const items = await getTopCandidates(agg, 'code');
    for (let i = 1; i < items.length; i++) {
      assert.ok(
        (items[i - 1].score as number) >= (items[i].score as number),
        `topCandidates[${i - 1}].score (${items[i - 1].score}) must be >= topCandidates[${i}].score (${items[i].score}) with focus active`,
      );
    }
  });
});
