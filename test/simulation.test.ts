/**
 * CI-runnable slice of the scenario simulation harness.
 *
 * Drives a real Aggregator wired to in-process FixtureBackends (real Backend
 * implementations, not module mocks) through realistic per-focus cast journeys.
 * Asserts: (a) cast resolves to the expected in-focus tool, (b) focus actually
 * boosts in-focus candidates and can reorder past a cross-focus near-miss, and
 * (c) out-of-focus tools remain reachable via search (lens, not gate).
 *
 * The embedding brain is disabled so the DETERMINISTIC keyword-fallback path is
 * exercised. embedding-brain.ts reads CH1TTY_EMBED_ENABLED into a module-level
 * const at import time, so we set it BEFORE the dynamic import of the harness.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

process.env.CH1TTY_EMBED_ENABLED = 'false';

const {
  SCENARIOS,
  buildSimAggregator,
  outOfFocusReachable,
  runFocusBiasProbe,
  runScenario,
  surfaceMisresolutions,
} = await import('../sim/scenarios.js');

test('cast resolves every scenario to its expected in-focus tool', async () => {
  const { aggregator } = buildSimAggregator();
  try {
    for (const sc of SCENARIOS) {
      const r = await runScenario(aggregator, sc);
      assert.equal(
        r.actual,
        r.expected,
        `[${sc.id}] intent="${sc.intent}" focus=${sc.focus} resolved ${r.actual} (alts: ${r.alternatives.map((a) => `${a.tool}@${a.score}`).join(', ')})`,
      );
    }
  } finally {
    await aggregator.shutdown();
  }
});

test('focus boosts in-focus candidates (every focused scenario)', async () => {
  const { aggregator } = buildSimAggregator();
  try {
    for (const sc of SCENARIOS) {
      if (!sc.focus) continue;
      const p = await runFocusBiasProbe(aggregator, sc);
      assert.notEqual(p.withFocusExpectedScore, null, `[${sc.id}] expected tool absent with focus`);
      assert.notEqual(p.noFocusExpectedScore, null, `[${sc.id}] expected tool absent without focus`);
      assert.ok(
        p.boosted,
        `[${sc.id}] focus did not boost ${sc.expect}: ${p.noFocusExpectedScore} -> ${p.withFocusExpectedScore}`,
      );
    }
  } finally {
    await aggregator.shutdown();
  }
});

test('focus reorders a cross-focus near-miss (lens flips the winner)', async () => {
  const { aggregator } = buildSimAggregator();
  try {
    const sc = SCENARIOS.find((s) => s.id === 'design.render-document-reorder');
    assert.ok(sc, 'reorder scenario present');
    const p = await runFocusBiasProbe(aggregator, sc!);
    // Without focus the out-of-focus pdf tool wins; with design focus it loses.
    assert.equal(p.noFocusTop, 'pdf/render_pdf', `without focus top was ${p.noFocusTop}`);
    assert.equal(p.withFocusTop, 'browser-rendering/render_page', `with focus top was ${p.withFocusTop}`);
    assert.ok(p.reordered, 'focus should have reordered the winner');
  } finally {
    await aggregator.shutdown();
  }
});

test('out-of-focus tools stay reachable via search (lens, not gate)', async () => {
  const { aggregator } = buildSimAggregator();
  try {
    // finance focus — code/communication tools still reachable
    assert.ok(
      await outOfFocusReachable(aggregator, 'pull request', 'finance', 'github/create_pull_request'),
      'github tool unreachable under finance focus',
    );
    assert.ok(
      await outOfFocusReachable(aggregator, 'message', 'finance', 'imessage/send_message'),
      'imessage tool unreachable under finance focus',
    );
    // design focus — code/finance tools still reachable
    assert.ok(
      await outOfFocusReachable(aggregator, 'sql', 'design', 'neon/run_sql'),
      'neon tool unreachable under design focus',
    );
    assert.ok(
      await outOfFocusReachable(aggregator, 'invoice', 'design', 'stripe/create_invoice'),
      'stripe tool unreachable under design focus',
    );
    // code focus — finance/communication tools still reachable
    assert.ok(
      await outOfFocusReachable(aggregator, 'invoice', 'code', 'stripe/create_invoice'),
      'stripe tool unreachable under code focus',
    );
    assert.ok(
      await outOfFocusReachable(aggregator, 'message', 'code', 'imessage/send_message'),
      'imessage tool unreachable under code focus',
    );
    // communication focus — code/finance tools still reachable
    assert.ok(
      await outOfFocusReachable(aggregator, 'sql', 'communication', 'neon/run_sql'),
      'neon tool unreachable under communication focus',
    );
    assert.ok(
      await outOfFocusReachable(aggregator, 'invoice', 'communication', 'stripe/create_invoice'),
      'stripe tool unreachable under communication focus',
    );
    // governance focus (covers ecosystem+documents) — code/desktop/communication tools still reachable
    assert.ok(
      await outOfFocusReachable(aggregator, 'pull request', 'governance', 'github/create_pull_request'),
      'github tool unreachable under governance focus',
    );
    assert.ok(
      await outOfFocusReachable(aggregator, 'headless', 'governance', 'browser-rendering/render_page'),
      'browser-rendering tool unreachable under governance focus',
    );
    assert.ok(
      await outOfFocusReachable(aggregator, 'message', 'governance', 'imessage/send_message'),
      'imessage tool unreachable under governance focus',
    );
    // ops focus (covers ecosystem+code) — desktop/communication/documents tools still reachable
    assert.ok(
      await outOfFocusReachable(aggregator, 'render page', 'ops', 'browser-rendering/render_page'),
      'browser-rendering tool unreachable under ops focus',
    );
    assert.ok(
      await outOfFocusReachable(aggregator, 'send message', 'ops', 'imessage/send_message'),
      'imessage tool unreachable under ops focus',
    );
    assert.ok(
      await outOfFocusReachable(aggregator, 'create page', 'ops', 'notion/create_page'),
      'notion tool unreachable under ops focus',
    );
  } finally {
    await aggregator.shutdown();
  }
});

test('no uncorrectable mis-resolutions (focus must fix every OOF intruder)', async () => {
  // Run every focused scenario WITHOUT focus to find cases where the wrong tool wins.
  // Classify each as corrected-by-focus or uncorrectable. Uncorrectable = scoring bug.
  // Focus-correctable mis-resolutions are diagnostic but expected (that is the point of focus).
  const { aggregator } = buildSimAggregator();
  try {
    const events = await surfaceMisresolutions(aggregator);
    const uncorrected = events.filter((e) => !e.correctedByFocus);

    // Print the mis-resolution report regardless of outcome for diagnostic visibility.
    if (events.length > 0) {
      const corrected = events.filter((e) => e.correctedByFocus);
      for (const e of corrected) {
        console.log(
          `  [mis-resolution corrected] ${e.id}: "${e.noFocusTop}" wins without focus → ` +
          `"${e.expected}" wins with ${e.focus} focus`,
        );
      }
      for (const e of uncorrected) {
        console.log(
          `  [UNCORRECTED MIS-RESOLUTION] ${e.id}: "${e.noFocusTop}" wins BOTH with and without ` +
          `${e.focus} focus — expected "${e.expected}"`,
        );
      }
    }

    assert.equal(
      uncorrected.length,
      0,
      `${uncorrected.length} uncorrectable mis-resolution(s): ` +
      uncorrected.map((e) => `${e.id}(expected=${e.expected},got=${e.noFocusTop})`).join(', '),
    );
  } finally {
    await aggregator.shutdown();
  }
});
