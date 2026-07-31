/**
 * Drift guard: freezes the field count of buildCastExplanation's output.
 *
 * CLAUDE.md declares a metric freeze on `cast explain`: no new statistical
 * fields, ratios, or percentile cross-comparisons may be added to
 * buildCastExplanation. Previous automated runs violated this by adding ~30
 * ratio/distribution fields on top of the original set. This test locks the
 * current counts so CI fails immediately if a future run attempts to add more.
 *
 * Measured counts (2026-07-30):
 *   no-focus,    verbosity:full, multi-candidate: 56 fields
 *   focus:code,  verbosity:full, multi-candidate: 87 fields
 *
 * If this test fails with a HIGHER count: a new metric was added — REJECT the
 * change per CLAUDE.md § buildCastExplanation metric freeze.
 * If it fails with a LOWER count: a field was deliberately removed — update
 * the constants and this comment only after confirming the removal.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

const DLQ = join(tmpdir(), `ch1tty-explain-drift-${Date.now()}.jsonl`);

// Field counts locked on 2026-07-30. Must not grow.
const EXPECTED_NO_FOCUS_FIELD_COUNT = 56;
const EXPECTED_WITH_FOCUS_FIELD_COUNT = 87;

function makeAggregator(): Aggregator {
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
    ledgerDlqPath: DLQ,
  });
}

test('cast explain field count — no focus — must equal 56 (metric freeze guard)', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'full',
    });
    assert.equal(result.isError, undefined, 'cast should not error');
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.ok(body.explanation !== undefined, 'explanation field must be present');
    const actual = Object.keys(body.explanation).length;
    assert.equal(
      actual,
      EXPECTED_NO_FOCUS_FIELD_COUNT,
      `cast explain must have exactly ${EXPECTED_NO_FOCUS_FIELD_COUNT} fields without focus; got ${actual}. ` +
        'count > expected → new metric added, REJECT per CLAUDE.md metric freeze. ' +
        'count < expected → field removed, update constant only after confirming intent.',
    );
  } finally {
    await agg.shutdown();
  }
});

test('cast explain field count — focus:code active — must equal 87 (metric freeze guard)', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list database projects',
      explain: true,
      verbosity: 'full',
      focus: 'code',
    });
    assert.equal(result.isError, undefined, 'cast should not error');
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.ok(body.explanation !== undefined, 'explanation field must be present');
    const actual = Object.keys(body.explanation).length;
    assert.equal(
      actual,
      EXPECTED_WITH_FOCUS_FIELD_COUNT,
      `cast explain must have exactly ${EXPECTED_WITH_FOCUS_FIELD_COUNT} fields with focus active; got ${actual}. ` +
        'count > expected → new metric added, REJECT per CLAUDE.md metric freeze. ' +
        'count < expected → field removed, update constant only after confirming intent.',
    );
  } finally {
    await agg.shutdown();
  }
});
