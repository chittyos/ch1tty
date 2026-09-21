/**
 * EA: Drift guard — ch1tty/cast result top-level shape.
 *
 * Freezes the required top-level fields for each cast result type:
 *   cast: 'executed'      — normal cast (tool resolved + executed)
 *   cast: 'plan'          — confirm: true (resolve without execute)
 *   cast: 'resolved'      — dryRun: true (resolve-only, no schema)
 *   cast: 'no_match'      — no tools matched the intent
 *
 * Also freezes:
 *   latencyBreakdown shape (sub-object of cast:executed)
 *   resolved sub-object shape (cast:plan)
 *   resolved sub-object shape (cast:resolved/dryRun)
 *   alternatives item shape (array present in cast:plan)
 *
 * These guards catch renames and removals of top-level response fields that
 * would silently break API clients without changing test counts elsewhere.
 * Does NOT guard explanation fields (DW + zzzz tests cover those).
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

const DLQ = join(tmpdir(), `ch1tty-ea-${Date.now()}.jsonl`);

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

// ── cast:executed ───────────────────────────────────────────────────────────

/** Always-present required fields for cast:executed */
const EXECUTED_REQUIRED_KEYS: readonly string[] = [
  'cast',
  'intent',
  'latencyBreakdown',
  'latencyMs',
  'resolved',
  'resolvedBy',
  'score',
];

/** Always-present required keys of latencyBreakdown (sub-object of cast:executed) */
const LATENCY_BREAKDOWN_KEYS: readonly string[] = [
  'executionMs',
  'registryMs',
  'scoringMs',
];

test('cast:executed — required top-level keys present', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list database projects' });
    assert.equal(result.isError, undefined, 'cast should not error');
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(body.cast, 'executed', 'result type must be executed');

    const actual = Object.keys(body).sort();
    const missing = EXECUTED_REQUIRED_KEYS.filter((k) => !actual.includes(k));
    assert.deepEqual(missing, [], `Missing required keys from cast:executed: ${missing.join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('cast:executed — latencyBreakdown sub-object shape', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list database projects' });
    assert.equal(result.isError, undefined);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(body.cast, 'executed');
    assert.ok(body.latencyBreakdown !== null && typeof body.latencyBreakdown === 'object', 'latencyBreakdown must be an object');

    const breakdown = Object.keys(body.latencyBreakdown).sort();
    const missing = LATENCY_BREAKDOWN_KEYS.filter((k) => !breakdown.includes(k));
    assert.deepEqual(missing, [], `Missing keys from latencyBreakdown: ${missing.join(', ')}`);

    for (const k of LATENCY_BREAKDOWN_KEYS) {
      assert.equal(typeof body.latencyBreakdown[k], 'number', `latencyBreakdown.${k} must be a number`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('cast:executed — resolved is a non-empty string (namespaced tool name)', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list database projects' });
    assert.equal(result.isError, undefined);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(body.cast, 'executed');
    assert.equal(typeof body.resolved, 'string', 'cast:executed resolved must be a string');
    assert.ok(body.resolved.includes('/'), 'cast:executed resolved must be a namespaced tool name (serverId/toolName)');
  } finally {
    await agg.shutdown();
  }
});

test('cast:executed — resolvedBy is a non-empty string', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list database projects' });
    assert.equal(result.isError, undefined);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(body.cast, 'executed');
    assert.ok(typeof body.resolvedBy === 'string' && body.resolvedBy.length > 0, 'resolvedBy must be a non-empty string');
  } finally {
    await agg.shutdown();
  }
});

// ── cast:plan (confirm:true) ────────────────────────────────────────────────

/** Always-present required fields for cast:plan */
const PLAN_REQUIRED_KEYS: readonly string[] = [
  'alternatives',
  'args',
  'cast',
  'hint',
  'intent',
  'latencyMs',
  'resolved',
  'resolvedBy',
];

/** Always-present fields inside resolved sub-object for cast:plan */
const PLAN_RESOLVED_KEYS: readonly string[] = [
  'category',
  'description',
  'inputSchema',
  'score',
  'server',
  'tool',
];

test('cast:plan — required top-level keys present', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list database projects', confirm: true });
    assert.equal(result.isError, undefined);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(body.cast, 'plan', 'result type must be plan');

    const actual = Object.keys(body).sort();
    const missing = PLAN_REQUIRED_KEYS.filter((k) => !actual.includes(k));
    assert.deepEqual(missing, [], `Missing required keys from cast:plan: ${missing.join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('cast:plan — resolved sub-object has required fields', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list database projects', confirm: true });
    assert.equal(result.isError, undefined);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(body.cast, 'plan');
    assert.ok(body.resolved !== null && typeof body.resolved === 'object' && !Array.isArray(body.resolved), 'plan resolved must be an object');

    const resolvedKeys = Object.keys(body.resolved).sort();
    const missing = PLAN_RESOLVED_KEYS.filter((k) => !resolvedKeys.includes(k));
    assert.deepEqual(missing, [], `Missing keys from cast:plan resolved: ${missing.join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('cast:plan — alternatives is an array', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list database projects', confirm: true });
    assert.equal(result.isError, undefined);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(body.cast, 'plan');
    assert.ok(Array.isArray(body.alternatives), 'alternatives must be an array');
  } finally {
    await agg.shutdown();
  }
});

test('cast:plan — alternatives items have tool, score, description', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list database projects', confirm: true });
    assert.equal(result.isError, undefined);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(body.cast, 'plan');
    if (body.alternatives.length > 0) {
      for (const alt of body.alternatives as unknown[]) {
        assert.ok(typeof alt === 'object' && alt !== null, 'each alternative must be an object');
        const a = alt as Record<string, unknown>;
        assert.ok('tool' in a, 'alternative must have tool');
        assert.ok('score' in a, 'alternative must have score');
        assert.ok('description' in a, 'alternative must have description');
        assert.equal(typeof a['tool'], 'string', 'alternative.tool must be a string');
        assert.equal(typeof a['score'], 'number', 'alternative.score must be a number');
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('cast:plan — hint is the expected static string', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list database projects', confirm: true });
    assert.equal(result.isError, undefined);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(body.cast, 'plan');
    assert.equal(
      body.hint,
      'Call cast again without confirm to execute, or use ch1tty/execute directly.',
      'plan hint must match frozen string',
    );
  } finally {
    await agg.shutdown();
  }
});

// ── cast:resolved (dryRun:true) ─────────────────────────────────────────────

/** Always-present required fields for cast:resolved */
const RESOLVED_REQUIRED_KEYS: readonly string[] = [
  'cast',
  'intent',
  'latencyMs',
  'resolved',
  'resolvedBy',
];

/** Always-present fields inside resolved sub-object for cast:resolved */
const RESOLVED_RESOLVED_KEYS: readonly string[] = ['score', 'tool'];

test('cast:resolved (dryRun) — required top-level keys present', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list database projects', dryRun: true });
    assert.equal(result.isError, undefined);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(body.cast, 'resolved', 'result type must be resolved');

    const actual = Object.keys(body).sort();
    const missing = RESOLVED_REQUIRED_KEYS.filter((k) => !actual.includes(k));
    assert.deepEqual(missing, [], `Missing required keys from cast:resolved: ${missing.join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('cast:resolved (dryRun) — resolved sub-object has tool and score', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list database projects', dryRun: true });
    assert.equal(result.isError, undefined);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(body.cast, 'resolved');
    assert.ok(body.resolved !== null && typeof body.resolved === 'object' && !Array.isArray(body.resolved), 'resolved must be an object');

    const resolvedKeys = Object.keys(body.resolved).sort();
    const missing = RESOLVED_RESOLVED_KEYS.filter((k) => !resolvedKeys.includes(k));
    assert.deepEqual(missing, [], `Missing keys from cast:resolved resolved: ${missing.join(', ')}`);
    assert.equal(typeof body.resolved.tool, 'string', 'resolved.tool must be a string');
    assert.equal(typeof body.resolved.score, 'number', 'resolved.score must be a number');
  } finally {
    await agg.shutdown();
  }
});

// ── cast:no_match ───────────────────────────────────────────────────────────

/** Always-present required fields for cast:no_match */
const NO_MATCH_REQUIRED_KEYS: readonly string[] = [
  'cast',
  'hint',
  'intent',
  'latencyMs',
  'resolvedBy',
];

test('cast:no_match — required top-level keys present', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'zzzzzzzzz_no_matching_tool_xyz_unique_9999' });
    assert.equal(result.isError, undefined);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(body.cast, 'no_match', 'result type must be no_match');

    const actual = Object.keys(body).sort();
    const missing = NO_MATCH_REQUIRED_KEYS.filter((k) => !actual.includes(k));
    assert.deepEqual(missing, [], `Missing required keys from cast:no_match: ${missing.join(', ')}`);
  } finally {
    await agg.shutdown();
  }
});

test('cast:no_match — hint is the expected static string', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'zzzzzzzzz_no_matching_tool_xyz_unique_9999' });
    assert.equal(result.isError, undefined);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(body.cast, 'no_match');
    assert.equal(
      body.hint,
      'No tools, prompts, or resources matched your intent. Try ch1tty/search with different keywords.',
      'no_match hint must match frozen string',
    );
  } finally {
    await agg.shutdown();
  }
});

test('cast:no_match — latencyMs is a non-negative number', async () => {
  const agg = makeAggregator();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'zzzzzzzzz_no_matching_tool_xyz_unique_9999' });
    assert.equal(result.isError, undefined);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(body.cast, 'no_match');
    assert.equal(typeof body.latencyMs, 'number', 'latencyMs must be a number');
    assert.ok(body.latencyMs >= 0, 'latencyMs must be non-negative');
  } finally {
    await agg.shutdown();
  }
});
