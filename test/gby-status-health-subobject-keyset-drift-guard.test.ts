/**
 * GBY drift guard: freeze ch1tty/status health sub-object exact key sets.
 *
 * FY-2 through FY-5 freeze VALUE TYPES for four health sub-objects in the
 * status snapshot:
 *   - systemHealth:  status, brainDegraded, ledgerStatus
 *   - brainHealth:   status, embeddingCircuitOpen, ollamaCircuitOpen
 *   - ledgerHealth:  status, dropped, buffered, flushErrors, dlqEntries, dlqPath
 *   - ledgerDlq:     path, entryCount, entries
 *
 * DZ-4 asserts each of these keys exists at the top level of the status
 * response.  But NO existing test freezes the EXACT KEY SET of any of these
 * four sub-objects.  A regression that:
 *   - adds `circuitBreakerCount` to brainHealth
 *   - adds `lastFlushAt` or `totalFlushed` to ledgerHealth
 *   - adds `maxEntries` or `overflowDropped` to ledgerDlq
 *   - adds `degradedSince` or `uptime` to systemHealth
 * would pass FY and DZ silently because those tests only probe individual
 * field types, not whether unexpected keys are absent.
 *
 * GBY freezes:
 *
 *   GBY-1  status.systemHealth has EXACTLY { status, brainDegraded, ledgerStatus }
 *           (3 keys — a regression adding a 4th field is invisible to FY-2 and DZ).
 *
 *   GBY-2  status.brainHealth has EXACTLY { status, embeddingCircuitOpen, ollamaCircuitOpen }
 *           (3 keys — a regression adding a 4th field is invisible to FY-3 and DZ).
 *
 *   GBY-3  status.ledgerHealth has EXACTLY
 *           { status, dropped, buffered, flushErrors, dlqEntries, dlqPath }
 *           (6 keys — a regression adding a 7th field is invisible to FY-4 and DZ).
 *
 *   GBY-4  status.ledgerDlq has EXACTLY { path, entryCount, entries }
 *           (3 keys — a regression adding a 4th field is invisible to FY-5 and DZ).
 *
 *   GBY-5  Cross-sub-object consistency: systemHealth.ledgerStatus === ledgerHealth.status
 *           Both fields derive from the same computed `ledgerStatus` variable
 *           (src-stdio/aggregator.ts line ~1049); a refactor copying one side without
 *           updating the other would diverge silently.
 *
 * Frozen 2026-09-26.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (status, not cast explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gby-${Date.now()}-${++_seq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  {
    id: 'stripe',
    name: 'Stripe',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://stripe.com/mcp',
    lazy: true,
  },
  {
    id: 'neon',
    name: 'Neon',
    type: 'remote',
    access: 'readwrite',
    category: 'code',
    endpoint: 'https://neon.tech/mcp',
    lazy: true,
  },
];

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

async function getStatus(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined, 'ch1tty/status must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1);
  assert.equal(content[0]!.type, 'text');
  return JSON.parse(content[0]!.text!) as Record<string, unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GBY-1: status.systemHealth has EXACTLY { status, brainDegraded, ledgerStatus } (3 keys — no extras)', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    const sh = snap['systemHealth'];
    assert.ok(sh !== null && typeof sh === 'object' && !Array.isArray(sh),
      'systemHealth must be a plain object');
    const actual = Object.keys(sh as object).sort();
    const expected = ['brainDegraded', 'ledgerStatus', 'status'];
    assert.deepEqual(
      actual,
      expected,
      `systemHealth must have exactly ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GBY-2: status.brainHealth has EXACTLY { status, embeddingCircuitOpen, ollamaCircuitOpen } (3 keys — no extras)', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    const bh = snap['brainHealth'];
    assert.ok(bh !== null && typeof bh === 'object' && !Array.isArray(bh),
      'brainHealth must be a plain object');
    const actual = Object.keys(bh as object).sort();
    const expected = ['embeddingCircuitOpen', 'ollamaCircuitOpen', 'status'];
    assert.deepEqual(
      actual,
      expected,
      `brainHealth must have exactly ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GBY-3: status.ledgerHealth has EXACTLY { status, dropped, buffered, flushErrors, dlqEntries, dlqPath } (6 keys — no extras)', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    const lh = snap['ledgerHealth'];
    assert.ok(lh !== null && typeof lh === 'object' && !Array.isArray(lh),
      'ledgerHealth must be a plain object');
    const actual = Object.keys(lh as object).sort();
    const expected = ['buffered', 'dlqEntries', 'dlqPath', 'dropped', 'flushErrors', 'status'];
    assert.deepEqual(
      actual,
      expected,
      `ledgerHealth must have exactly ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GBY-4: status.ledgerDlq has EXACTLY { path, entryCount, entries } (3 keys — no extras)', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    const ld = snap['ledgerDlq'];
    assert.ok(ld !== null && typeof ld === 'object' && !Array.isArray(ld),
      'ledgerDlq must be a plain object');
    const actual = Object.keys(ld as object).sort();
    const expected = ['entries', 'entryCount', 'path'];
    assert.deepEqual(
      actual,
      expected,
      `ledgerDlq must have exactly ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GBY-5: status.systemHealth.ledgerStatus === status.ledgerHealth.status (cross-sub-object consistency)', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    const sh = snap['systemHealth'] as Record<string, unknown>;
    const lh = snap['ledgerHealth'] as Record<string, unknown>;
    assert.ok(sh !== null && typeof sh === 'object', 'systemHealth must be an object');
    assert.ok(lh !== null && typeof lh === 'object', 'ledgerHealth must be an object');
    assert.equal(
      sh['ledgerStatus'],
      lh['status'],
      `systemHealth.ledgerStatus ("${sh['ledgerStatus']}") must equal ledgerHealth.status ("${lh['status']}") — both derive from the same computed ledgerStatus variable`,
    );
  } finally {
    await agg.shutdown();
  }
});
