/**
 * Covers two previously-uncovered branches in the cast handler:
 *
 *   Line 1498 — cast:plan (confirm:true) with explain:true → explanation truthy
 *   Line 1553 — cast:executed with explain:true → explanation truthy
 *
 * Both branches are `...(explanation ? { explanation } : {})`. They are only
 * reached when `explain: true` is passed; without it, explanation is null and
 * the false branch (empty spread) fires instead. Existing cast:plan tests
 * (suggestion-ranking) and the kkkk test (dryRun mode) never set explain:true
 * on the confirm / execute paths, leaving the true branches uncovered.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

const DLQ = join(tmpdir(), `ch1tty-cast-expl-branch-${Date.now()}.jsonl`);

function makeAggregator(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
  ];
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: DLQ,
  });
}

// ── Line 1498: cast:plan + explain:true → explanation field present ───────────

test('cast:plan with explain:true → explanation field present in plan response (line 1498 true branch)', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list neon database projects',
      confirm: true,
      explain: true,
    });
    assert.equal(result.isError, undefined, 'cast:plan should not error');
    const body = JSON.parse(result.content[0].text as string);
    assert.equal(body.cast, 'plan', 'confirm=true → plan mode');
    assert.ok(body.explanation !== undefined, 'explanation field must be present when explain:true is set on cast:plan');
    assert.equal(typeof body.explanation, 'object', 'explanation is an object');
  } finally {
    await agg.shutdown();
  }
});

// ── Line 1553: cast:executed + explain:true → explanation field present ───────

test('cast:executed with explain:true → explanation field present in executed response (line 1553 true branch)', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list neon database projects',
      explain: true,
    });
    assert.equal(result.isError, undefined, 'cast:executed should not error');
    const body = JSON.parse(result.content[0].text as string);
    assert.equal(body.cast, 'executed', 'no confirm → executed mode');
    assert.ok(body.explanation !== undefined, 'explanation field must be present when explain:true is set on cast:executed');
    assert.equal(typeof body.explanation, 'object', 'explanation is an object');
  } finally {
    await agg.shutdown();
  }
});
