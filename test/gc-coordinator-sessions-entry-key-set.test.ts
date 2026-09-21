/**
 * GC: Freeze coordinator.sessions[] entry exact key set in ch1tty/status.
 *
 * FZ-6 froze the VALUE TYPES of coordinator.sessions[] entry fields but did
 * not assert the exact key set. A new field added to the snapshot (e.g.
 * lastActiveAt, serverAffinity) would pass FZ-6 unchanged.
 *
 * This guard freezes the key sets:
 *
 *   GC-1  coordinator.sessions is [] when no sessions are active
 *   GC-2  fresh session entry key set: exactly {sessionId, stagingComplete, toolPatterns, topTools}
 *   GC-3  session entry with sessionFocus key set: exactly
 *          {sessionFocus, sessionId, stagingComplete, toolPatterns, topTools}
 *   GC-4  all session entry keys are a strict subset of the maximum set
 *          {entity, sessionFocus, sessionId, stagingComplete, toolPatterns, topTools}
 *          — no extra keys allowed even when all optional fields are present
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

const BASE_ENTRY_KEYS  = ['sessionId', 'stagingComplete', 'toolPatterns', 'topTools'].sort();
const FOCUS_ENTRY_KEYS = ['sessionFocus', 'sessionId', 'stagingComplete', 'toolPatterns', 'topTools'].sort();
const MAX_ENTRY_KEYS   = new Set(['entity', 'sessionFocus', 'sessionId', 'stagingComplete', 'toolPatterns', 'topTools']);

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
    ledgerDlqPath: join(tmpdir(), `ch1tty-gc-${Date.now()}-${++_seq}.jsonl`),
  } as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

async function getCoordSessions(agg: Aggregator, args: Record<string, unknown> = {}): Promise<unknown[]> {
  const result = await agg.callTool('ch1tty/status', args);
  assert.equal(result.isError, undefined, 'status must not error');
  const snap = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  const coord = snap.coordinator as Record<string, unknown>;
  assert.ok(Array.isArray(coord.sessions), 'coordinator.sessions must be an array');
  return coord.sessions as unknown[];
}

function sortedKeys(obj: object): string[] {
  return Object.keys(obj).sort();
}

// ── GC-1: coordinator.sessions is [] when no sessions active ──────────────────

test('GC-1: coordinator.sessions is [] when no sessions are active', async () => {
  const agg = makeAgg();
  try {
    const sessions = await getCoordSessions(agg);
    assert.deepEqual(sessions, [], 'coordinator.sessions must be [] with no active sessions');
  } finally {
    await agg.shutdown?.();
  }
});

// ── GC-2: fresh session entry key set ────────────────────────────────────────

test('GC-2: fresh session entry key set is exactly {sessionId, stagingComplete, toolPatterns, topTools}', async () => {
  const agg = makeAgg();
  try {
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: 'gc2-seed' });
    const sessions = await getCoordSessions(agg, { sessionId: 'gc2-seed' });
    const entry = sessions.find((s) => (s as Record<string, unknown>).sessionId === 'gc2-seed') as object | undefined;
    assert.ok(entry !== undefined, 'gc2-seed session must appear in coordinator.sessions');
    assert.deepEqual(
      sortedKeys(entry),
      BASE_ENTRY_KEYS,
      `fresh session entry keys: expected ${JSON.stringify(BASE_ENTRY_KEYS)}, got ${JSON.stringify(sortedKeys(entry))}`,
    );
  } finally {
    await agg.shutdown?.();
  }
});

// ── GC-3: session entry with sessionFocus key set ─────────────────────────────

test('GC-3: session entry with sessionFocus key set is exactly {sessionFocus, sessionId, stagingComplete, toolPatterns, topTools}', async () => {
  const agg = makeAgg();
  try {
    await agg.callTool('ch1tty/search', { query: 'neon', focus: 'code', sessionId: 'gc3-seed' });
    const sessions = await getCoordSessions(agg, { sessionId: 'gc3-seed' });
    const entry = sessions.find((s) => (s as Record<string, unknown>).sessionId === 'gc3-seed') as object | undefined;
    assert.ok(entry !== undefined, 'gc3-seed session must appear in coordinator.sessions');
    assert.deepEqual(
      sortedKeys(entry),
      FOCUS_ENTRY_KEYS,
      `focus session entry keys: expected ${JSON.stringify(FOCUS_ENTRY_KEYS)}, got ${JSON.stringify(sortedKeys(entry))}`,
    );
    assert.equal((entry as Record<string, unknown>).sessionFocus, 'code', 'sessionFocus must equal the focus passed to search');
  } finally {
    await agg.shutdown?.();
  }
});

// ── GC-4: no extra keys beyond max set ───────────────────────────────────────

test('GC-4: all session entry keys are within the max set {entity, sessionFocus, sessionId, stagingComplete, toolPatterns, topTools}', async () => {
  const agg = makeAgg();
  try {
    // Seed two sessions: one bare, one with focus
    await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', args: {}, sessionId: 'gc4-bare' });
    await agg.callTool('ch1tty/search', { query: 'neon', focus: 'finance', sessionId: 'gc4-focus' });
    const sessions = await getCoordSessions(agg, { sessionId: 'gc4-bare' });
    assert.ok(sessions.length >= 2, 'expected at least 2 sessions');
    for (const entry of sessions) {
      const keys = sortedKeys(entry as object);
      for (const key of keys) {
        assert.ok(
          MAX_ENTRY_KEYS.has(key),
          `unexpected key '${key}' in coordinator.sessions entry — not in max set ${JSON.stringify([...MAX_ENTRY_KEYS].sort())}`,
        );
      }
    }
  } finally {
    await agg.shutdown?.();
  }
});
