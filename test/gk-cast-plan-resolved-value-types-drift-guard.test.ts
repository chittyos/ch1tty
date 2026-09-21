/**
 * GK drift guard: freeze cast:plan and cast:resolved top-level primitive VALUE TYPES
 * and constraints.
 *
 * EA froze required key presence for both modes.
 * GI froze the resolved sub-object key sets and value types.
 * Together they leave these gaps for cast:plan (confirm:true) and cast:resolved
 * (dryRun:true):
 *
 *   cast:plan (confirm:true):
 *   — resolvedBy: EA checks key presence; never asserts it is 'keyword' | 'brain'
 *   — latencyMs:  EA checks key presence only; no isFinite or ≥ 0 assertion
 *   — intent:     EA checks key presence only; never asserts it echoes the input
 *
 *   cast:resolved (dryRun:true):
 *   — resolvedBy: EA checks key presence; never asserts enum constraint
 *   — latencyMs:  EA checks key presence only; no isFinite or ≥ 0 assertion
 *   — intent:     EA checks key presence; never asserts it echoes the input
 *
 * GK closes those gaps:
 *
 *   GK-1  cast:plan resolvedBy is one of {keyword, brain}
 *   GK-2  cast:plan latencyMs is a finite non-negative number
 *   GK-3  cast:plan intent echoes the input intent string exactly
 *   GK-4  cast:resolved resolvedBy is one of {keyword, brain}
 *   GK-5  cast:resolved latencyMs is a finite non-negative number
 *   GK-6  cast:resolved intent echoes the input intent string exactly
 *
 * Source: resolvedBy typed as 'brain' | 'keyword' at src-stdio/aggregator.ts:1340.
 *
 * Frozen 2026-09-20.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (cast:plan and
 *     cast:resolved top-level fields, not the explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Valid resolvedBy enum values ──────────────────────────────────────────────

// resolvedBy is declared as 'brain' | 'keyword' at aggregator.ts:1340.
// catalog matches surface via resolvedFromCatalog, not as a resolvedBy value.
const VALID_RESOLVED_BY: readonly string[] = ['keyword', 'brain'];

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_CONFIGS: ServerConfig[] = [
  {
    id: 'neon',
    name: 'Neon DB',
    type: 'remote',
    access: 'readwrite',
    category: 'code',
    endpoint: 'https://neon.tech/mcp',
    lazy: true,
  },
];

let _seq = 0;
function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-gk-${Date.now()}-${++_seq}.jsonl`),
  });
}

async function castPlan(agg: Aggregator, intent: string): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent, confirm: true });
  assert.equal(result.isError, undefined, `cast:plan must not error for intent "${intent}"`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body.cast, 'plan', `expected cast:plan, got cast:${body.cast}`);
  return body;
}

async function castResolved(agg: Aggregator, intent: string): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent, dryRun: true });
  assert.equal(result.isError, undefined, `cast:resolved must not error for intent "${intent}"`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body.cast, 'resolved', `expected cast:resolved, got cast:${body.cast}`);
  return body;
}

// ── GK-1: cast:plan resolvedBy is one of {keyword, brain} ────────────────────

test('GK-1: cast:plan resolvedBy is one of {keyword, brain}', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, 'list database projects');
    const resolvedBy = body['resolvedBy'];
    assert.equal(typeof resolvedBy, 'string', 'resolvedBy must be a string');
    assert.ok(
      VALID_RESOLVED_BY.includes(resolvedBy as string),
      `resolvedBy must be one of ${VALID_RESOLVED_BY.join(' | ')}, got "${resolvedBy}"`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GK-2: cast:plan latencyMs is a finite non-negative number ────────────────

test('GK-2: cast:plan latencyMs is a finite non-negative number', async () => {
  const agg = makeAgg();
  try {
    const body = await castPlan(agg, 'list database projects');
    const latencyMs = body['latencyMs'];
    assert.equal(typeof latencyMs, 'number', 'latencyMs must be a number');
    assert.ok(Number.isFinite(latencyMs as number), `latencyMs must be finite, got ${latencyMs}`);
    assert.ok((latencyMs as number) >= 0, `latencyMs must be >= 0, got ${latencyMs}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GK-3: cast:plan intent echoes the input intent string exactly ─────────────

test('GK-3: cast:plan intent echoes the input intent string exactly', async () => {
  const agg = makeAgg();
  const inputIntent = 'list database projects';
  try {
    const body = await castPlan(agg, inputIntent);
    const intent = body['intent'];
    assert.equal(typeof intent, 'string', 'intent must be a string');
    assert.equal(intent, inputIntent, `intent must echo the input, got "${intent}"`);
  } finally {
    await agg.shutdown();
  }
});

// ── GK-4: cast:resolved resolvedBy is one of {keyword, brain} ────────────────

test('GK-4: cast:resolved resolvedBy is one of {keyword, brain}', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, 'list database projects');
    const resolvedBy = body['resolvedBy'];
    assert.equal(typeof resolvedBy, 'string', 'resolvedBy must be a string');
    assert.ok(
      VALID_RESOLVED_BY.includes(resolvedBy as string),
      `resolvedBy must be one of ${VALID_RESOLVED_BY.join(' | ')}, got "${resolvedBy}"`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GK-5: cast:resolved latencyMs is a finite non-negative number ─────────────

test('GK-5: cast:resolved latencyMs is a finite non-negative number', async () => {
  const agg = makeAgg();
  try {
    const body = await castResolved(agg, 'list database projects');
    const latencyMs = body['latencyMs'];
    assert.equal(typeof latencyMs, 'number', 'latencyMs must be a number');
    assert.ok(Number.isFinite(latencyMs as number), `latencyMs must be finite, got ${latencyMs}`);
    assert.ok((latencyMs as number) >= 0, `latencyMs must be >= 0, got ${latencyMs}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GK-6: cast:resolved intent echoes the input intent string exactly ──────────

test('GK-6: cast:resolved intent echoes the input intent string exactly', async () => {
  const agg = makeAgg();
  const inputIntent = 'list database projects';
  try {
    const body = await castResolved(agg, inputIntent);
    const intent = body['intent'];
    assert.equal(typeof intent, 'string', 'intent must be a string');
    assert.equal(intent, inputIntent, `intent must echo the input, got "${intent}"`);
  } finally {
    await agg.shutdown();
  }
});
