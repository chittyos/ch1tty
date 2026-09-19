/**
 * ET: Drift guard — cast:executed latencyBreakdown sub-object shape.
 *
 * The latencyBreakdown object is constructed at aggregator lines 1535 and
 * 1657 for cast:chain_executed and cast:executed respectively:
 *   { scoringMs: execScoringMs, executionMs, registryMs,
 *     ...(castRoute === 'brain' ? { brainMs: brainRouteMs } : {}) }
 *
 * PERMITTED keys (keyword route, embedEnabled:false):
 *   scoringMs   — number (registry fetch + scoring wall time)
 *   executionMs — number (backend call wall time)
 *   registryMs  — number (registry fetch wall time; sub-component of scoringMs)
 *
 * CONDITIONAL:
 *   brainMs     — number, present only when brain route was taken (excluded
 *                 from this guard since embedEnabled:false prevents it)
 *
 * latencyBreakdown is NOT present on cast:resolved (dryRun:true) or
 * cast:plan (confirm:true) — no execution happens on those paths.
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Frozen permitted key set (keyword route only — brainMs excluded) ──────────

const LATENCY_PERMITTED: readonly string[] = ['scoringMs', 'executionMs', 'registryMs'];
const LATENCY_REQUIRED: readonly string[] = ['scoringMs', 'executionMs', 'registryMs'];

// ── Fixture setup ─────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-et-${Date.now()}-${++dlqSeq}.jsonl`);
}

function makeAggregator(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
    { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
  ];
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

function parseBody(result: { content: Array<{ type?: string; text?: unknown }> }): Record<string, unknown> {
  const first = result.content[0] as { type?: string; text?: unknown } | undefined;
  if (typeof first?.text !== 'string') throw new Error('No text content');
  return JSON.parse(first.text) as Record<string, unknown>;
}

// ── Suite 1: latencyBreakdown key shape in cast:executed ──────────────────────

describe('ET — latencyBreakdown sub-object shape in cast:executed', () => {
  test('latencyBreakdown has no unexpected keys (keyword route)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', { intent: 'list neon database projects' });
      const body = parseBody(result);
      assert.equal(body['cast'], 'executed', 'intent should resolve to cast:executed');
      const lb = body['latencyBreakdown'] as Record<string, unknown>;
      assert.ok(lb !== null && typeof lb === 'object', 'latencyBreakdown must be present on cast:executed');
      const unexpected = Object.keys(lb).filter((k) => !LATENCY_PERMITTED.includes(k));
      assert.deepEqual(unexpected, [], `Unexpected keys in latencyBreakdown: ${unexpected.join(', ')}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('latencyBreakdown contains all required keys', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', { intent: 'list neon database projects' });
      const body = parseBody(result);
      assert.equal(body['cast'], 'executed');
      const lb = body['latencyBreakdown'] as Record<string, unknown>;
      assert.ok(lb !== null && typeof lb === 'object', 'latencyBreakdown must be present');
      for (const key of LATENCY_REQUIRED) {
        assert.ok(key in lb, `latencyBreakdown must contain '${key}'`);
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('all latencyBreakdown values are non-negative numbers', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', { intent: 'list neon database projects' });
      const body = parseBody(result);
      assert.equal(body['cast'], 'executed');
      const lb = body['latencyBreakdown'] as Record<string, unknown>;
      assert.ok(lb !== null && typeof lb === 'object');
      for (const key of LATENCY_REQUIRED) {
        assert.equal(typeof lb[key], 'number', `latencyBreakdown.${key} must be a number`);
        assert.ok((lb[key] as number) >= 0, `latencyBreakdown.${key} must be non-negative`);
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('latencyBreakdown.brainMs absent when using keyword route (embedEnabled:false)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', { intent: 'list neon database projects' });
      const body = parseBody(result);
      assert.equal(body['cast'], 'executed');
      const lb = body['latencyBreakdown'] as Record<string, unknown>;
      assert.ok(lb !== null && typeof lb === 'object');
      assert.ok(!('brainMs' in lb), 'brainMs must NOT be present when keyword route is used');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: latencyBreakdown absent on non-execution paths ──────────────────

describe('ET — latencyBreakdown absent on non-execution cast paths', () => {
  test('latencyBreakdown absent from cast:resolved (dryRun:true)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        dryRun: true,
      });
      const body = parseBody(result);
      assert.equal(body['cast'], 'resolved', 'dryRun:true should produce cast:resolved');
      assert.ok(!('latencyBreakdown' in body), 'latencyBreakdown must NOT appear on cast:resolved');
    } finally {
      await agg.shutdown();
    }
  });

  test('latencyBreakdown absent from cast:plan (confirm:true)', async () => {
    const agg = makeAggregator();
    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'list neon database projects',
        confirm: true,
      });
      const body = parseBody(result);
      assert.equal(body['cast'], 'plan', 'confirm:true should produce cast:plan');
      assert.ok(!('latencyBreakdown' in body), 'latencyBreakdown must NOT appear on cast:plan');
    } finally {
      await agg.shutdown();
    }
  });
});
