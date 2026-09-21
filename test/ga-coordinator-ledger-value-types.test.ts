/**
 * GA drift guard: freeze coordinator.ledger VALUE TYPES in ch1tty/status.
 *
 * ED froze the exact key set for coordinator.ledger (LedgerStats) and asserted
 * that its six numeric fields are non-negative numbers. Neither ED nor FZ
 * asserts the VALUE TYPES of the two non-numeric fields:
 *
 *   - dlqPath    — must be a non-empty string
 *   - lastFlushAt — must be null (no flush yet) or a valid ISO date string
 *
 * GA closes that gap:
 *
 *   GA-1  coordinator.ledger.dlqPath is a non-empty string
 *   GA-2  coordinator.ledger.lastFlushAt is null or a valid ISO date string
 *   GA-3  coordinator.ledger.flushIntervalMs is a finite positive number (> 0)
 *
 * Frozen 2026-09-20.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (status, not cast)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { LedgerClient } from '../src/ledger.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon',   type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',  lazy: true },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
];

let _seq = 0;
function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-ga-${Date.now()}-${++_seq}.jsonl`),
  } as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

async function getLedger(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined, 'status must not error');
  const snap = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  const coord = snap.coordinator as Record<string, unknown>;
  const ledger = coord.ledger as Record<string, unknown>;
  assert.ok(ledger && typeof ledger === 'object' && !Array.isArray(ledger), 'coordinator.ledger must be an object');
  return ledger;
}

// ── GA-1: dlqPath is a non-empty string ──────────────────────────────────────

test('GA-1: coordinator.ledger.dlqPath is a non-empty string', async () => {
  const agg = makeAgg();
  try {
    const ledger = await getLedger(agg);
    assert.equal(typeof ledger.dlqPath, 'string', 'coordinator.ledger.dlqPath must be a string');
    assert.ok((ledger.dlqPath as string).length > 0, 'coordinator.ledger.dlqPath must be non-empty');
  } finally {
    await agg.shutdown?.();
  }
});

// ── GA-2: lastFlushAt is null or ISO date string ──────────────────────────────

test('GA-2: coordinator.ledger.lastFlushAt is null or a valid ISO date string', async () => {
  const agg = makeAgg();
  try {
    const ledger = await getLedger(agg);
    const v = ledger.lastFlushAt;
    if (v === null) {
      // No flush yet — null is valid.
      assert.equal(v, null, 'coordinator.ledger.lastFlushAt must be null when no flush has occurred');
    } else {
      assert.equal(typeof v, 'string', 'coordinator.ledger.lastFlushAt must be a string when set');
      const d = new Date(v as string);
      assert.ok(!Number.isNaN(d.getTime()), `coordinator.ledger.lastFlushAt must parse as a valid date, got "${v}"`);
      assert.equal(v, d.toISOString(), `coordinator.ledger.lastFlushAt must be a canonical ISO 8601 string, got "${v}"`);
    }
  } finally {
    await agg.shutdown?.();
  }
});

// ── GA-2b: lastFlushAt is an ISO date string after a real flush ──────────────
//
// GA-2 only exercises the null path (no flush occurs through the Aggregator
// fixture). GA-2b drives LedgerClient directly with a minimal stub backend so
// the post-flush non-null branch is also covered.

test('GA-2b: coordinator.ledger.lastFlushAt is a valid ISO date string after a flush', async () => {
  // Minimal stub — only callTool is exercised by LedgerClient.flush()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stubBackend = {
    callTool: async (_serverId: string, toolName: string) => {
      if (toolName === 'chitty_ledger_record') {
        return { content: [{ type: 'text', text: 'ok' }] };
      }
      return { isError: true, content: [{ type: 'text', text: 'not found' }] };
    },
  } as any;

  const client = new LedgerClient(join(tmpdir(), `ch1tty-ga2b-${Date.now()}-${++_seq}.jsonl`));
  try {
    client.bind(stubBackend, 'echo');
    client.record('sess-ga2b', 'test_event', { x: 1 });
    await client.flush();

    const stats = client.getStats();
    assert.equal(typeof stats.lastFlushAt, 'string', 'lastFlushAt must be a string after a successful flush');
    const d = new Date(stats.lastFlushAt as string);
    assert.ok(!Number.isNaN(d.getTime()), `lastFlushAt must be a valid ISO date after flush, got "${stats.lastFlushAt}"`);
    assert.equal(stats.lastFlushAt, d.toISOString(), `lastFlushAt must be a canonical ISO 8601 string after flush, got "${stats.lastFlushAt}"`);
  } finally {
    client.unbind();
    await client.shutdown();
  }
});

// ── GA-3: flushIntervalMs is a finite positive number ────────────────────────

test('GA-3: coordinator.ledger.flushIntervalMs is a finite positive number', async () => {
  const agg = makeAgg();
  try {
    const ledger = await getLedger(agg);
    assert.equal(typeof ledger.flushIntervalMs, 'number', 'coordinator.ledger.flushIntervalMs must be a number');
    assert.ok(Number.isFinite(ledger.flushIntervalMs as number), 'coordinator.ledger.flushIntervalMs must be finite');
    assert.ok((ledger.flushIntervalMs as number) > 0, 'coordinator.ledger.flushIntervalMs must be > 0');
  } finally {
    await agg.shutdown?.();
  }
});
