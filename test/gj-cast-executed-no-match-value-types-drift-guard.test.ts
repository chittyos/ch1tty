/**
 * GJ drift guard: freeze cast:executed and cast:no_match primitive VALUE TYPES
 * and constraints.
 *
 * EA froze required key presence and coarse type checks for both modes.
 * NNNN froze latencyBreakdown.scoringMs ≥ 0 and latencyBreakdown.executionMs ≥ 0.
 * Together they leave these gaps:
 *
 *   cast:executed:
 *   — resolved: EA checks includes('/'); never asserts EXACTLY ONE '/'
 *   — resolvedBy: EA checks non-empty string; never asserts it is one of the
 *     three valid values ('keyword' | 'brain' | 'catalog')
 *   — score (top-level): EA lists it as a required key; no value type test
 *   — latencyMs: EA lists it as a required key; no value type test (finite/≥0)
 *   — latencyBreakdown.registryMs: NNNN misses it; EA checks typeof 'number'
 *     but not finite or ≥ 0; registryMs was added alongside scoringMs/executionMs
 *     but never separately asserted
 *   — latencyBreakdown all sub-fields: NNNN checks ≥ 0 for scoringMs and
 *     executionMs but not Number.isFinite for any of them
 *
 *   cast:no_match:
 *   — resolvedBy: EA checks key presence; no value type test
 *   — latencyMs: EA checks number ≥ 0; never asserts Number.isFinite
 *   — intent: EA checks key presence; never asserts it echoes the input
 *
 * GJ closes those gaps:
 *
 *   GJ-1  cast:executed resolved contains exactly one '/' (namespaced)
 *   GJ-2  cast:executed resolvedBy is one of {keyword, brain, catalog}
 *   GJ-3  cast:executed top-level score is a finite non-negative number
 *   GJ-4  cast:executed latencyMs is a finite non-negative number
 *   GJ-5  cast:executed latencyBreakdown.registryMs is finite and >= 0
 *   GJ-6  cast:executed latencyBreakdown all sub-fields are finite and >= 0
 *   GJ-7  cast:no_match resolvedBy is a non-empty string
 *   GJ-8  cast:no_match latencyMs is finite (EA: number >= 0; not isFinite)
 *   GJ-9  cast:no_match intent echoes the input intent string exactly
 *
 * Frozen 2026-09-20.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (cast:executed and
 *     cast:no_match top-level fields, not explanation sub-object)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Valid resolvedBy enum values ──────────────────────────────────────────────

// resolvedBy is declared as 'brain' | 'keyword' in aggregator.ts:1340;
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
/** Build a fresh Aggregator backed by the neon FixtureBackend for each test. */
function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-gj-${Date.now()}-${++_seq}.jsonl`),
  });
}

/** Invoke cast without flags and assert the response is cast:executed. */
async function castExecuted(agg: Aggregator, intent: string): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent });
  assert.equal(result.isError, undefined, `cast must not return isError for intent "${intent}"`);
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body.cast, 'executed', `expected cast:executed, got cast:${body.cast}`);
  return body;
}

/** Invoke cast with a gibberish intent that produces cast:no_match. */
async function castNoMatch(agg: Aggregator): Promise<Record<string, unknown>> {
  const intent = 'zzzzzzzzz_gj_no_match_unique_99999';
  const result = await agg.callTool('ch1tty/cast', { intent });
  assert.equal(result.isError, undefined, 'cast:no_match must not return isError');
  const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.equal(body.cast, 'no_match', `expected cast:no_match, got cast:${body.cast}`);
  return body;
}

// ── GJ-1: cast:executed resolved contains exactly one '/' ────────────────────

test('GJ-1: cast:executed resolved contains exactly one slash (namespaced "serverId/toolName")', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg, 'list database projects');
    const resolved = body.resolved;
    assert.equal(typeof resolved, 'string', `resolved must be a string, got ${typeof resolved}`);
    assert.ok((resolved as string).length > 0, 'resolved must be non-empty');
    const slashCount = ((resolved as string).match(/\//g) ?? []).length;
    assert.equal(slashCount, 1,
      `resolved must contain exactly one slash (got "${resolved}" with ${slashCount} slashes). ` +
      `EA only checks includes('/') — GJ-1 tightens to exactly one.`);
    const [serverId, toolName] = (resolved as string).split('/');
    assert.ok(serverId.length > 0,
      `resolved serverId (before '/') must be non-empty, got "${resolved}"`);
    assert.ok(toolName.length > 0,
      `resolved toolName (after '/') must be non-empty, got "${resolved}"`);
  } finally {
    await agg.shutdown();
  }
});

// ── GJ-2: cast:executed resolvedBy is one of the valid enum values ────────────

test('GJ-2: cast:executed resolvedBy is one of {keyword, brain, catalog}', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg, 'run sql query on database');
    const resolvedBy = body.resolvedBy;
    assert.equal(typeof resolvedBy, 'string',
      `resolvedBy must be a string, got ${typeof resolvedBy}`);
    assert.ok(VALID_RESOLVED_BY.includes(resolvedBy as string),
      `resolvedBy must be one of ${JSON.stringify(VALID_RESOLVED_BY)}, got "${resolvedBy}". ` +
      `EA checks non-empty string; GJ-2 tightens to the valid enum set.`);
  } finally {
    await agg.shutdown();
  }
});

// ── GJ-3: cast:executed top-level score is finite and >= 0 ───────────────────

test('GJ-3: cast:executed top-level score is a finite non-negative number', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg, 'list database projects');
    const score = body.score;
    assert.equal(typeof score, 'number',
      `score must be a number, got ${typeof score}`);
    assert.ok(Number.isFinite(score as number),
      `score must be finite, got ${score}`);
    assert.ok((score as number) >= 0,
      `score must be >= 0, got ${score}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GJ-4: cast:executed latencyMs is finite and >= 0 ─────────────────────────

test('GJ-4: cast:executed latencyMs is a finite non-negative number', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg, 'describe table schema');
    const latencyMs = body.latencyMs;
    assert.equal(typeof latencyMs, 'number',
      `latencyMs must be a number, got ${typeof latencyMs}`);
    assert.ok(Number.isFinite(latencyMs as number),
      `latencyMs must be finite, got ${latencyMs}`);
    assert.ok((latencyMs as number) >= 0,
      `latencyMs must be >= 0, got ${latencyMs}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GJ-5: cast:executed latencyBreakdown.registryMs is finite and >= 0 ────────

test('GJ-5: cast:executed latencyBreakdown.registryMs is finite and >= 0', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg, 'list database projects');
    const breakdown = body.latencyBreakdown as Record<string, unknown>;
    assert.ok(breakdown !== null && typeof breakdown === 'object' && !Array.isArray(breakdown),
      'latencyBreakdown must be a plain object');
    assert.ok('registryMs' in breakdown,
      'latencyBreakdown must contain registryMs');
    const registryMs = breakdown.registryMs;
    assert.equal(typeof registryMs, 'number',
      `latencyBreakdown.registryMs must be a number, got ${typeof registryMs}`);
    assert.ok(Number.isFinite(registryMs as number),
      `latencyBreakdown.registryMs must be finite, got ${registryMs}`);
    assert.ok((registryMs as number) >= 0,
      `latencyBreakdown.registryMs must be >= 0, got ${registryMs}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GJ-6: cast:executed latencyBreakdown all sub-fields are finite and >= 0 ───

test('GJ-6: cast:executed latencyBreakdown all present sub-fields are finite and >= 0', async () => {
  const agg = makeAgg();
  try {
    const body = await castExecuted(agg, 'run sql query on database');
    const breakdown = body.latencyBreakdown as Record<string, unknown>;
    assert.ok(breakdown !== null && typeof breakdown === 'object', 'latencyBreakdown must be an object');
    for (const field of Object.keys(breakdown)) {
      const v = breakdown[field];
      assert.equal(typeof v, 'number',
        `latencyBreakdown.${field} must be a number, got ${typeof v}`);
      assert.ok(Number.isFinite(v as number),
        `latencyBreakdown.${field} must be finite, got ${v}`);
      assert.ok((v as number) >= 0,
        `latencyBreakdown.${field} must be >= 0, got ${v}`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GJ-7: cast:no_match resolvedBy is a non-empty string ─────────────────────

test('GJ-7: cast:no_match resolvedBy is a non-empty string', async () => {
  const agg = makeAgg();
  try {
    const body = await castNoMatch(agg);
    const resolvedBy = body.resolvedBy;
    assert.equal(typeof resolvedBy, 'string',
      `resolvedBy must be a string, got ${typeof resolvedBy}`);
    assert.ok((resolvedBy as string).length > 0,
      `resolvedBy must be non-empty, got "${resolvedBy}"`);
  } finally {
    await agg.shutdown();
  }
});

// ── GJ-8: cast:no_match latencyMs is finite ───────────────────────────────────

test('GJ-8: cast:no_match latencyMs is finite (EA checks number >= 0; GJ-8 adds isFinite)', async () => {
  const agg = makeAgg();
  try {
    const body = await castNoMatch(agg);
    const latencyMs = body.latencyMs;
    assert.equal(typeof latencyMs, 'number',
      `latencyMs must be a number, got ${typeof latencyMs}`);
    assert.ok(Number.isFinite(latencyMs as number),
      `latencyMs must be finite, got ${latencyMs}`);
    assert.ok((latencyMs as number) >= 0,
      `latencyMs must be >= 0, got ${latencyMs}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GJ-9: cast:no_match intent echoes the input intent string exactly ─────────

test('GJ-9: cast:no_match intent echoes the input intent string exactly', async () => {
  const expectedIntent = 'zzzzzzzzz_gj_no_match_unique_99999';
  const agg = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: expectedIntent });
    assert.equal(result.isError, undefined, 'cast must not return isError');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body.cast, 'no_match', `expected cast:no_match, got cast:${body.cast}`);
    assert.equal(body.intent, expectedIntent,
      `cast:no_match intent must echo the input intent exactly. Got "${body.intent}", expected "${expectedIntent}".`);
  } finally {
    await agg.shutdown();
  }
});
