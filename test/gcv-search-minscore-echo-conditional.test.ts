/**
 * GCV drift guard: freeze ch1tty/search top-level `minScore` echo conditional.
 *
 * Source: src-stdio/aggregator.ts
 *   Line 651: const minScore = typeof args.minScore === 'number' && args.minScore > 0
 *                               ? args.minScore : 0;
 *   Line 864: ...(minScore > 0 ? { minScore } : {}),
 *
 * FD-3 (fd-search-keyword-response-drift-guard) freezes absence when the param
 * is omitted. FD-16 freezes key presence when minScore > 0 (0.01). Neither test
 * covers:
 *   - explicit zero → still absent
 *   - negative value → coerced to 0, absent
 *   - echoed value equals the arg exactly (not just that the key exists)
 *   - non-number type → coerced to 0, absent
 *
 * GCV closes those gaps:
 *
 *   GCV-1  explicit minScore: 0 → key absent (coerced to 0 by the > 0 guard)
 *   GCV-2  negative minScore: -1 → key absent (guard rejects negatives)
 *   GCV-3  minScore: 0.5 → echoed value equals 0.5 (not just key presence)
 *   GCV-4  minScore: 1.3 → echoed value equals 1.3 (schema max boundary)
 *   GCV-5  non-number minScore: 'high' → key absent (typeof guard rejects strings)
 *
 * Frozen 2026-09-27.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (search, not cast)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gcv-${Date.now()}-${++dlqSeq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon', name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
];

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

async function search(agg: Aggregator, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/search', args);
  assert.equal(result.isError, undefined, 'search must not error');
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── GCV-1: explicit minScore: 0 → key absent ─────────────────────────────────

test('GCV-1: explicit minScore: 0 → minScore key absent in envelope', async () => {
  const agg = makeAgg();
  try {
    // minScore: 0 satisfies typeof === 'number' but fails > 0, so coerces to 0
    // and the echo conditional ...(minScore > 0 ? { minScore } : {}) emits nothing.
    const body = await search(agg, { query: 'database', minScore: 0 });
    assert.ok(
      !('minScore' in body),
      `minScore must be absent when passed as 0; got: ${JSON.stringify(body['minScore'])}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCV-2: negative minScore → key absent ────────────────────────────────────

test('GCV-2: negative minScore: -1 → minScore key absent (guard rejects negatives)', async () => {
  const agg = makeAgg();
  try {
    // typeof -1 === 'number' but -1 > 0 is false → coerces to 0 → not echoed.
    const body = await search(agg, { query: 'database', minScore: -1 });
    assert.ok(
      !('minScore' in body),
      `minScore must be absent when passed as -1; got: ${JSON.stringify(body['minScore'])}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GCV-3: minScore: 0.5 → echoed value equals 0.5 ───────────────────────────

test('GCV-3: minScore: 0.5 → echoed minScore equals 0.5 exactly', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, { query: 'database', minScore: 0.5 });
    assert.ok('minScore' in body, 'minScore key must be present when arg is 0.5');
    const echoed = body['minScore'];
    assert.equal(typeof echoed, 'number',
      `echoed minScore must be a number, got ${typeof echoed}`);
    assert.ok(Number.isFinite(echoed as number),
      `echoed minScore must be finite, got ${echoed}`);
    assert.equal(echoed, 0.5,
      `echoed minScore must equal arg value 0.5, got ${echoed}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GCV-4: minScore: 1.3 → echoed value equals 1.3 (schema max boundary) ────

test('GCV-4: minScore: 1.3 → echoed minScore equals 1.3 (schema max boundary)', async () => {
  const agg = makeAgg();
  try {
    const body = await search(agg, { query: 'database', minScore: 1.3 });
    assert.ok('minScore' in body, 'minScore key must be present when arg is 1.3');
    const echoed = body['minScore'];
    assert.equal(typeof echoed, 'number',
      `echoed minScore must be a number, got ${typeof echoed}`);
    assert.equal(echoed, 1.3,
      `echoed minScore must equal arg value 1.3, got ${echoed}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GCV-5: non-number minScore → key absent ───────────────────────────────────

test('GCV-5: non-number minScore: "high" → minScore key absent (typeof guard rejects strings)', async () => {
  const agg = makeAgg();
  try {
    // typeof 'high' !== 'number' → coerces to 0 → not echoed.
    const body = await search(agg, { query: 'database', minScore: 'high' });
    assert.ok(
      !('minScore' in body),
      `minScore must be absent when passed as a string; got: ${JSON.stringify(body['minScore'])}`,
    );
  } finally {
    await agg.shutdown();
  }
});
