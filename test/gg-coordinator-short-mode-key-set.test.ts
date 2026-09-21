/**
 * GG: Freeze coordinator exact key set in ch1tty/status short mode.
 *
 * ED froze the coordinator key set for normal mode:
 *   {activeSessions, boundEntity, brain, embeddingBrain, evictedSessions,
 *    ledger, sessionTtlMs, sessions, toolsByServer, topTools}  (10 keys)
 *
 * FZ-7 confirmed short mode omits `sessions` and checks value types, but
 * never asserts the EXACT key set of coordinator in short mode. DZ-21 only
 * checks that `sessions` is absent. If a new field (e.g. `serverAffinity`)
 * were added to the short-mode coordinator snapshot, nothing would catch it.
 *
 * GG closes that gap:
 *
 *   GG-1  short-mode coordinator exact key set when no sessions are active:
 *          exactly {activeSessions, boundEntity, brain, embeddingBrain,
 *          evictedSessions, ledger, sessionTtlMs, toolsByServer, topTools}
 *   GG-2  short-mode coordinator exact key set with an active session:
 *          same 9 keys — `sessions` must NOT bleed in even when sessions exist
 *   GG-3  short-mode coordinator key set is a strict subset of the normal-mode
 *          coordinator key set (all 9 short-mode keys are valid coordinator fields)
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
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen key sets (sorted alphabetically) ───────────────────────────────────

const SHORT_COORDINATOR_KEYS = [
  'activeSessions',
  'boundEntity',
  'brain',
  'embeddingBrain',
  'evictedSessions',
  'ledger',
  'sessionTtlMs',
  'toolsByServer',
  'topTools',
].sort();

const NORMAL_COORDINATOR_KEYS = new Set([
  ...SHORT_COORDINATOR_KEYS,
  'sessions',
]);

// ── Helpers ────────────────────────────────────────────────────────────────────

const CONFIGS: ServerConfig[] = [
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
];

let _seq = 0;
function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  return new Aggregator(CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-gg-${Date.now()}-${++_seq}.jsonl`),
  } as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

async function getShortCoord(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/status', { short: true });
  assert.equal(result.isError, undefined, 'short status must not error');
  const snap = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  const coord = snap.coordinator as Record<string, unknown>;
  assert.ok(coord !== null && typeof coord === 'object' && !Array.isArray(coord), 'coordinator must be a plain object');
  return coord;
}

function sortedKeys(obj: object): string[] {
  return Object.keys(obj).sort();
}

// ── GG-1: short-mode coordinator exact key set with no active sessions ────────

test('GG-1: short-mode coordinator exact key set with no active sessions', async () => {
  const agg = makeAgg();
  try {
    const coord = await getShortCoord(agg);
    assert.deepEqual(
      sortedKeys(coord),
      SHORT_COORDINATOR_KEYS,
      `short-mode coordinator keys: expected ${JSON.stringify(SHORT_COORDINATOR_KEYS)}, got ${JSON.stringify(sortedKeys(coord))}`,
    );
  } finally {
    await agg.shutdown?.();
  }
});

// ── GG-2: short-mode coordinator exact key set with an active session ─────────

test('GG-2: short-mode coordinator exact key set with an active session (sessions must not bleed in)', async () => {
  const agg = makeAgg();
  try {
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: 'ge2-seed' });
    const coord = await getShortCoord(agg);
    assert.deepEqual(
      sortedKeys(coord),
      SHORT_COORDINATOR_KEYS,
      `short-mode coordinator keys with active session: expected ${JSON.stringify(SHORT_COORDINATOR_KEYS)}, got ${JSON.stringify(sortedKeys(coord))}`,
    );
    assert.ok(!('sessions' in coord), 'short-mode coordinator must NOT contain sessions even when a session exists');
  } finally {
    await agg.shutdown?.();
  }
});

// ── GG-3: short-mode keys are a strict subset of normal-mode keys ─────────────

test('GG-3: all short-mode coordinator keys are valid normal-mode coordinator keys', async () => {
  const agg = makeAgg();
  try {
    const coord = await getShortCoord(agg);
    for (const key of Object.keys(coord)) {
      assert.ok(
        NORMAL_COORDINATOR_KEYS.has(key),
        `short-mode coordinator key '${key}' is not in the normal-mode key set ${JSON.stringify([...NORMAL_COORDINATOR_KEYS].sort())}`,
      );
    }
  } finally {
    await agg.shutdown?.();
  }
});
