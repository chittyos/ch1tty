/**
 * test(BA): sim/scenarios.ts branch gaps — 8 tests
 *
 * Covers uncovered branches in castPlan / runScenario / scoreOf /
 * outOfFocusReachable / runFocusBiasProbe / runDegradedCastScenario /
 * runDegradedSearchScenario.
 *
 * The harness functions only need a callTool seam, so we inject a minimal
 * mock rather than spinning up the full FixtureBackend + Aggregator stack.
 * CH1TTY_EMBED_ENABLED is set before the scenarios module loads so the
 * module-level embedding-brain check sees it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.CH1TTY_EMBED_ENABLED = 'false';

// Dynamic import so the env var above is in place before the module's own
// imports resolve the embedding-brain module-level const.
const {
  castPlan,
  runScenario,
  runFocusBiasProbe,
  outOfFocusReachable,
  runDegradedCastScenario,
  runDegradedSearchScenario,
} = await import('../sim/scenarios.js');

// Minimal mock that satisfies the callTool seam used by all harness functions.
type CallToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean };
function makeMock(fn: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>) {
  return { callTool: fn } as unknown as Parameters<typeof castPlan>[0];
}

function textAgg(json: unknown) {
  return makeMock(async () => ({
    content: [{ type: 'text', text: JSON.stringify(json) }],
  }));
}

// ── castPlan: error throw when content has no text item ─────────────────────

describe('castPlan — throws when content has no text item', () => {
  it('throws "cast returned no text content" for image-only content', async () => {
    const agg = makeMock(async () => ({ content: [{ type: 'image', data: 'x' }] }));
    await assert.rejects(
      () => castPlan(agg, 'find something', 'finance'),
      /cast returned no text content/,
    );
  });
});

// ── castPlan: focus === undefined → args.focus not set ──────────────────────

describe('castPlan — focus undefined branch', () => {
  it('does not include focus key in callTool args when focus is omitted', async () => {
    let captured: Record<string, unknown> = {};
    const agg = makeMock(async (_name, args) => {
      captured = args;
      return { content: [{ type: 'text', text: '{"cast":"none"}' }] };
    });
    await castPlan(agg, 'some intent');  // no focus argument
    assert.ok(!('focus' in captured), 'args.focus must be absent when focus is undefined');
  });
});

// ── runScenario: null resolution → actual/actualScore null, pass false ───────

describe('runScenario — null resolution', () => {
  it('sets actual, actualScore to null and pass to false when resolved is absent', async () => {
    // Cast returns a JSON object with no resolved field
    const agg = textAgg({ cast: 'no match' });
    const sc = { id: 'test.null', focus: 'finance', intent: 'find foo', expect: 'server/tool' };
    const result = await runScenario(agg, sc);
    assert.equal(result.actual, null);
    assert.equal(result.actualScore, null);
    assert.equal(result.pass, false);
    assert.deepEqual(result.alternatives, []);
  });

  it('uses alternatives from plan when resolved is absent', async () => {
    const agg = textAgg({
      cast: 'partial',
      alternatives: [{ tool: 'other/thing', score: 0.3, description: 'alt' }],
    });
    const sc = { id: 'test.alts', focus: 'code', intent: 'some query', expect: 'server/expected' };
    const result = await runScenario(agg, sc);
    assert.equal(result.actual, null);
    assert.equal(result.alternatives.length, 1);
    assert.equal(result.alternatives[0].tool, 'other/thing');
  });
});

// ── outOfFocusReachable: false paths ─────────────────────────────────────────

describe('outOfFocusReachable — false paths', () => {
  it('returns false when content has no text item', async () => {
    const agg = makeMock(async () => ({ content: [{ type: 'image', data: 'x' }] }));
    const result = await outOfFocusReachable(agg, 'query', 'ops', 'target/tool');
    assert.equal(result, false);
  });

  it('returns false when the expected tool is absent from search text', async () => {
    const agg = textAgg({ tools: [{ tool: 'other/thing', score: 0.5 }] });
    const result = await outOfFocusReachable(agg, 'query', 'ops', 'absent/tool');
    assert.equal(result, false);
  });
});

// ── runFocusBiasProbe: reordered=false / boosted=false via null scores ────────

describe('runFocusBiasProbe — reordered=false, boosted=false', () => {
  it('reports reordered=false and boosted=false when both runs resolve to null', async () => {
    // Both without-focus and with-focus return no resolution.
    const agg = textAgg({ cast: 'none' });
    const sc = { id: 'test.probe', focus: 'finance', intent: 'vague', expect: 'server/tool' };
    const probe = await runFocusBiasProbe(agg, sc);
    assert.equal(probe.noFocusTop, null);
    assert.equal(probe.withFocusTop, null);
    assert.equal(probe.reordered, false);
    assert.equal(probe.boosted, false);
    assert.equal(probe.noFocusExpectedScore, null);
    assert.equal(probe.withFocusExpectedScore, null);
  });
});

// ── runDegradedCastScenario: null resolved + catch path ──────────────────────

describe('runDegradedCastScenario — null resolution and catch', () => {
  it('pass=true and resolved=(null) when cast resolves to null (not from degraded server)', async () => {
    const agg = textAgg({ cast: 'none' });
    const result = await runDegradedCastScenario(agg, {
      id: 'deg.null',
      intent: 'find something',
      focus: 'ops',
      degradedServer: 'neon',
    });
    assert.equal(result.pass, true);
    assert.match(result.detail, /null/);
  });

  it('pass=false and detail contains "unexpected throw" when castPlan throws', async () => {
    // Returning image-only content triggers the throw inside castPlan.
    const agg = makeMock(async () => ({ content: [{ type: 'image', data: 'x' }] }));
    const result = await runDegradedCastScenario(agg, {
      id: 'deg.throw',
      intent: 'find something',
      degradedServer: 'neon',
    });
    assert.equal(result.pass, false);
    assert.match(result.detail, /unexpected throw/);
  });
});

// ── runDegradedSearchScenario: isError path and no-text path ─────────────────

describe('runDegradedSearchScenario — error and no-text paths', () => {
  it('pass=false when search returns isError=true', async () => {
    const agg = makeMock(async () => ({
      content: [{ type: 'text', text: 'error' }],
      isError: true,
    }));
    const result = await runDegradedSearchScenario(agg, {
      id: 'dsg.iserror',
      query: 'list tasks',
      degradedServer: 'tasks',
      expectToolFromOther: 'neon/run_sql',
    });
    assert.equal(result.pass, false);
    assert.match(result.detail, /isError/);
  });

  it('pass=false with empty body when content has no text item', async () => {
    const agg = makeMock(async () => ({ content: [{ type: 'image', data: 'x' }] }));
    const result = await runDegradedSearchScenario(agg, {
      id: 'dsg.notext',
      query: 'database query',
      degradedServer: 'tasks',
      expectToolFromOther: 'neon/run_sql',
    });
    // body is '' so expectToolFromOther won't be found → pass=false
    assert.equal(result.pass, false);
  });
});
