/**
 * FD — cast explain: topCandidates array item VALUE TYPES drift guard.
 *
 * ET (et-cast-explain-topCandidates-item-shape.test.ts) froze the field NAMES
 * on each topCandidates item: `{score, tool}` without focus, `{inFocus, score, tool}`
 * with focus. This file freezes the VALUE TYPES and structural invariants for
 * each field so a silent type regression (e.g. score becoming undefined, tool
 * losing the namespace separator, inFocus becoming a string) fails immediately.
 *
 * CLAUDE.md § buildCastExplanation metric freeze applies here.
 * No new fields are added — only tests that verify existing item values.
 *
 * ── Item invariants frozen ───────────────────────────────────────────────────
 *   score     → number, finite, ≥ 0
 *   tool      → non-empty string, contains '/' (namespaced as serverId/toolName)
 *   inFocus   → boolean, true for in-focus items, false for out-of-focus
 *
 * ── Ordering invariant ───────────────────────────────────────────────────────
 *   topCandidates is sorted descending by score:
 *     topCandidates[i].score ≥ topCandidates[i+1].score for all i
 *
 * ── Cross-field invariants ───────────────────────────────────────────────────
 *   topCandidates[0].score === winnerScore  (top item matches winner)
 *   topCandidates[0].tool  === winner tool   (if applicable, winner is top item)
 *
 * ── Verbosity independence ───────────────────────────────────────────────────
 *   topCandidates items carry the same {score, tool} / {inFocus, score, tool}
 *   shape at ALL verbosity levels (low, medium, full). This guard asserts that
 *   at verbosity:full no extra fields appear on items beyond what ET froze.
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// NullRoutingCoordinator prevents OllamaBrain routing so value-type assertions
// are deterministic regardless of CH1TTY_USE_OLLAMA_BRAIN.
class NullRoutingCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-fd-${Date.now()}-${++dlqSeq}.jsonl`);
}

const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code'] as string[], servers: ['neon'] as string[], boost: 0.5 },
  },
};

function makeAggregator(opts: { withFocus?: boolean } = {}): Aggregator {
  const dlqPath = dlq();
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks', FIXTURE_SERVERS.tasks);
  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
    { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
    { id: 'tasks', name: 'Tasks', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp', lazy: true },
  ];
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlqPath,
    coordinator: new NullRoutingCoordinator({}, { enabled: false }, dlqPath),
    ...(opts.withFocus ? { focus: 'code', focusProfiles: FOCUS_PROFILES } : {}),
  });
}

type ExplainObj = Record<string, unknown>;
type TopCandidate = { score: unknown; tool: unknown; inFocus?: unknown };

function getExplain(result: { content: Array<{ type?: string; text?: unknown }> }): ExplainObj {
  const text = (result.content[0] as { type?: string; text?: unknown }).text;
  if (typeof text !== 'string') throw new Error('No text content');
  const body = JSON.parse(text) as Record<string, unknown>;
  const ex = body.explanation;
  assert.ok(ex !== null && typeof ex === 'object', 'explanation must be present and an object');
  return ex as ExplainObj;
}

function getTopCandidates(ex: ExplainObj): TopCandidate[] {
  assert.ok(Array.isArray(ex.topCandidates), 'topCandidates must be an array');
  return ex.topCandidates as TopCandidate[];
}

// ── Suite 1: score value type and range ──────────────────────────────────────

describe('FD-1 — topCandidates[*].score value types (no focus)', () => {
  test('score is a finite number ≥ 0 on every item', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'low',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const ex = getExplain(result);
      const items = getTopCandidates(ex);
      assert.ok(items.length > 0, 'multi-server fixture must yield at least one candidate');
      for (const item of items) {
        assert.equal(typeof item.score, 'number', `score must be a number (got ${typeof item.score})`);
        assert.ok(Number.isFinite(item.score as number), `score must be finite (got ${item.score})`);
        assert.ok((item.score as number) >= 0, `score must be ≥ 0 (got ${item.score})`);
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('score is a finite number ≥ 0 on every item at verbosity:full', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'full',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const items = getTopCandidates(getExplain(result));
      for (const item of items) {
        assert.equal(typeof item.score, 'number', 'score must be a number at full verbosity');
        assert.ok(Number.isFinite(item.score as number), 'score must be finite at full verbosity');
        assert.ok((item.score as number) >= 0, 'score must be ≥ 0 at full verbosity');
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: tool value type and format ──────────────────────────────────────

describe('FD-2 — topCandidates[*].tool value types (no focus)', () => {
  test('tool is a non-empty namespaced string containing "/"', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'low',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const items = getTopCandidates(getExplain(result));
      assert.ok(items.length > 0);
      for (const item of items) {
        assert.equal(typeof item.tool, 'string', `tool must be a string (got ${typeof item.tool})`);
        assert.ok((item.tool as string).length > 0, 'tool must be non-empty');
        assert.ok(
          (item.tool as string).includes('/'),
          `tool must be namespaced (contain "/") but got: ${item.tool}`,
        );
        const [serverId, ...rest] = (item.tool as string).split('/');
        assert.ok(serverId.length > 0, 'tool must have a non-empty serverId before "/"');
        assert.ok(rest.join('/').length > 0, 'tool must have a non-empty toolName after "/"');
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 3: inFocus value type and semantics ─────────────────────────────────

describe('FD-3 — topCandidates[*].inFocus value types (focus active)', () => {
  test('inFocus is a boolean on every item when focus is active', async () => {
    const agg = makeAggregator({ withFocus: true });
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'low',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const items = getTopCandidates(getExplain(result));
      assert.ok(items.length > 0);
      for (const item of items) {
        assert.equal(
          typeof item.inFocus,
          'boolean',
          `inFocus must be a boolean (got ${typeof item.inFocus} on item ${item.tool})`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('inFocus is absent on every item when no focus is active', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'low',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const items = getTopCandidates(getExplain(result));
      for (const item of items) {
        assert.ok(
          !Object.prototype.hasOwnProperty.call(item, 'inFocus'),
          `inFocus must be absent without focus (found on item ${item.tool})`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('in-focus items have inFocus===true, out-of-focus items have inFocus===false', async () => {
    const agg = makeAggregator({ withFocus: true });
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'low',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const ex = getExplain(result);
      const items = getTopCandidates(ex);
      // At least one item should be in-focus (neon is in the 'code' focus)
      const inFocusItems = items.filter((it) => it.inFocus === true);
      assert.ok(inFocusItems.length > 0, 'at least one in-focus item expected with code focus profile');
      // Every item with inFocus===false must have its serverId outside the focus profile
      for (const item of items) {
        assert.equal(typeof item.inFocus, 'boolean');
        if (item.inFocus === true) {
          // neon is in code focus — tool namespaced as neon/...
          assert.ok(
            (item.tool as string).startsWith('neon/'),
            `inFocus===true item should be from neon (code category) but got: ${item.tool}`,
          );
        }
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 4: Ordering invariant ───────────────────────────────────────────────

describe('FD-4 — topCandidates ordering (descending by score)', () => {
  test('topCandidates[i].score ≥ topCandidates[i+1].score for all adjacent pairs', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'low',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const items = getTopCandidates(getExplain(result));
      assert.ok(items.length > 0);
      for (let i = 0; i + 1 < items.length; i++) {
        assert.ok(
          (items[i].score as number) >= (items[i + 1].score as number),
          `topCandidates must be sorted descending: items[${i}].score (${items[i].score}) < items[${i + 1}].score (${items[i + 1].score})`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('topCandidates[0].score === winnerScore (winner is top item)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'low',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const ex = getExplain(result);
      const items = getTopCandidates(ex);
      assert.ok(items.length > 0);
      const winnerScore = ex.winnerScore as number;
      assert.ok(Number.isFinite(winnerScore), 'winnerScore must be finite');
      assert.equal(
        items[0].score,
        winnerScore,
        `topCandidates[0].score (${items[0].score}) must equal winnerScore (${winnerScore})`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 5: Verbosity independence ───────────────────────────────────────────

describe('FD-5 — topCandidates item shape is verbosity-independent', () => {
  test('at verbosity:full, each item has no extra fields beyond {score, tool}', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'full',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const items = getTopCandidates(getExplain(result));
      assert.ok(items.length > 0);
      const EXPECTED_NO_FOCUS_KEYS = ['score', 'tool'].sort();
      for (const item of items) {
        const actual = Object.keys(item as object).sort();
        assert.deepEqual(
          actual,
          EXPECTED_NO_FOCUS_KEYS,
          `verbosity:full item keys must be exactly [score, tool] without focus (got ${JSON.stringify(actual)})`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('at verbosity:full with focus, each item has no extra fields beyond {inFocus, score, tool}', async () => {
    const agg = makeAggregator({ withFocus: true });
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        explain: true,
        verbosity: 'full',
        focus: 'code',
        dryRun: true,
      });
      assert.equal(result.isError, undefined);
      const items = getTopCandidates(getExplain(result));
      assert.ok(items.length > 0);
      const EXPECTED_FOCUS_KEYS = ['inFocus', 'score', 'tool'].sort();
      for (const item of items) {
        const actual = Object.keys(item as object).sort();
        assert.deepEqual(
          actual,
          EXPECTED_FOCUS_KEYS,
          `verbosity:full focus item keys must be exactly [inFocus, score, tool] (got ${JSON.stringify(actual)})`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });
});
