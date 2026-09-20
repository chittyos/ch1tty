/**
 * GM drift guard: freeze ch1tty/status TOP-LEVEL key set and primitive VALUE TYPES.
 *
 * GA freezes coordinator.ledger value types; GD freezes servers[] entry value types;
 * GE freezes systemHealth value types; GG freezes coordinator short-mode key set.
 * None of them assert:
 *   - the top-level key set of the full status response (renaming `totalTools` →
 *     `tool_count` would silently pass all prior guards)
 *   - `gateway` is exactly the string "ch1tty"
 *   - `version` is a non-empty string
 *   - `uptime` is a finite non-negative number
 *   - `totalServers`, `connectedServers`, `totalTools`, `activeSessions` are
 *     non-negative integers with connectedServers ≤ totalServers
 *   - `registryCached` is exactly a boolean primitive (not 1 or "true")
 *   - `availableFocusProfiles` is an array of strings
 *   - `catalog` has the exact key set {loaded, totalCombos, byFocus, activeFocusSuggestions}
 *     with value types (boolean, number, object, null-or-object)
 *   - `brainHealth` has the exact key set {status, embeddingCircuitOpen, ollamaCircuitOpen}
 *     with value types (string, boolean, boolean)
 *   - `ledgerHealth` has the exact key set {status, dropped, buffered, flushErrors, dlqEntries, dlqPath}
 *     with value types (string, numbers, string)
 *   - `ledgerDlq` has the exact key set {path, entryCount, entries} with value types
 *     (string, number, array)
 *   - `latencyMs` is a finite non-negative number
 *
 * GM closes those gaps:
 *
 *   GM-1  Top-level key set of full status response is exactly the expected set
 *          (any rename or addition silently passes all prior guards)
 *   GM-2  `gateway` is exactly "ch1tty" and `version` is a non-empty string
 *   GM-3  `uptime` is a finite non-negative number (seconds since start)
 *   GM-4  `totalServers`, `connectedServers`, `totalTools`, `activeSessions` are
 *          non-negative integers; connectedServers ≤ totalServers
 *   GM-5  `registryCached` is exactly a boolean primitive (not 1, "true", or truthy)
 *   GM-6  `availableFocusProfiles` is an array of strings (empty or populated)
 *   GM-7  `catalog` exact key set {loaded, totalCombos, byFocus, activeFocusSuggestions}
 *          and value types (loaded: boolean; totalCombos: non-negative integer;
 *          byFocus: non-null object; activeFocusSuggestions: null or non-null object)
 *   GM-8  `brainHealth` exact key set {status, embeddingCircuitOpen, ollamaCircuitOpen}
 *          and value types (status is "ok" or "degraded"; both circuit fields are booleans)
 *   GM-9  `ledgerHealth` exact key set {status, dropped, buffered, flushErrors, dlqEntries, dlqPath}
 *          and value types (status string; numeric fields non-negative integers; dlqPath non-empty string)
 *   GM-10 `ledgerDlq` exact key set {path, entryCount, entries}
 *          and value types (path string; entryCount non-negative integer; entries array)
 *   GM-11 `latencyMs` is a finite non-negative number
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
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

let _seq = 0;
/** Returns a unique temp-file path for this test's ledger DLQ, keeping each run isolated. */
function dlq(): string {
  return join(tmpdir(), `ch1tty-gm-${Date.now()}-${++_seq}.jsonl`);
}

const BASE_CONFIGS: ServerConfig[] = [
  { id: 'neon',   name: 'Neon DB', type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',  lazy: true },
  { id: 'stripe', name: 'Stripe',  type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
];

/** Creates a fully isolated Aggregator with two fixture servers and an injected focus profile. */
function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',   FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  return new Aggregator(BASE_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
    focusProfiles: {
      profiles: {
        code: { categories: ['code' as const], servers: [], boost: 0.5 },
      },
    },
    suggestionsCatalog: {},
  });
}

/** Calls ch1tty/status and parses the JSON response body, failing if the tool errors. */
async function getStatus(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined, 'ch1tty/status must not return isError');
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── GM-1: Top-level key set ───────────────────────────────────────────────────

const EXPECTED_TOP_LEVEL_KEYS = [
  'activeSessions', 'availableFocusProfiles', 'brainHealth', 'catalog',
  'connectedServers', 'coordinator', 'focus', 'gateway', 'latencyMs',
  'ledgerDlq', 'ledgerHealth', 'registryCached', 'servers',
  'systemHealth', 'totalServers', 'totalTools', 'uptime', 'version',
].sort();

test('GM-1: ch1tty/status top-level key set is exactly the expected set', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    const actual = Object.keys(snap).sort();
    assert.deepEqual(actual, EXPECTED_TOP_LEVEL_KEYS,
      `Top-level key set mismatch.\nExpected: ${JSON.stringify(EXPECTED_TOP_LEVEL_KEYS)}\nActual:   ${JSON.stringify(actual)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GM-2: gateway and version ─────────────────────────────────────────────────

test('GM-2: gateway is exactly "ch1tty" and version is a non-empty string', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    assert.equal(snap['gateway'], 'ch1tty',
      `gateway must be exactly "ch1tty", got ${JSON.stringify(snap['gateway'])}`);
    assert.equal(typeof snap['version'], 'string',
      `version must be a string, got ${typeof snap['version']}`);
    assert.ok((snap['version'] as string).length > 0, 'version must be a non-empty string');
  } finally {
    await agg.shutdown();
  }
});

// ── GM-3: uptime ──────────────────────────────────────────────────────────────

test('GM-3: uptime is a finite non-negative number', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    const uptime = snap['uptime'];
    assert.equal(typeof uptime, 'number', `uptime must be a number, got ${typeof uptime}`);
    assert.ok(Number.isFinite(uptime as number), `uptime must be finite, got ${uptime}`);
    assert.ok((uptime as number) >= 0, `uptime must be non-negative, got ${uptime}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GM-4: counter fields ──────────────────────────────────────────────────────

test('GM-4: totalServers, connectedServers, totalTools, activeSessions are non-negative integers with connectedServers ≤ totalServers', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    for (const key of ['totalServers', 'connectedServers', 'totalTools', 'activeSessions']) {
      const val = snap[key];
      assert.equal(typeof val, 'number',
        `${key} must be a number, got ${typeof val}`);
      assert.ok(Number.isInteger(val as number),
        `${key} must be an integer, got ${val}`);
      assert.ok((val as number) >= 0,
        `${key} must be non-negative, got ${val}`);
    }
    const total = snap['totalServers'] as number;
    const connected = snap['connectedServers'] as number;
    assert.ok(connected <= total,
      `connectedServers (${connected}) must be ≤ totalServers (${total})`);
  } finally {
    await agg.shutdown();
  }
});

// ── GM-5: registryCached ──────────────────────────────────────────────────────

test('GM-5: registryCached is exactly a boolean primitive (not 1, "true", or truthy)', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    const rc = snap['registryCached'];
    assert.equal(typeof rc, 'boolean',
      `registryCached must have type 'boolean', got '${typeof rc}' (value: ${JSON.stringify(rc)})`);
    assert.ok(rc === true || rc === false,
      `registryCached must be exactly true or false, got ${JSON.stringify(rc)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GM-6: availableFocusProfiles ─────────────────────────────────────────────

test('GM-6: availableFocusProfiles is an array of strings and reflects injected profiles', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    const profiles = snap['availableFocusProfiles'];
    assert.ok(Array.isArray(profiles),
      `availableFocusProfiles must be an array, got ${typeof profiles}`);
    for (const p of profiles as unknown[]) {
      assert.equal(typeof p, 'string',
        `each availableFocusProfiles entry must be a string, got ${typeof p} (${JSON.stringify(p)})`);
    }
    // makeAgg injects a 'code' profile — verify it is surfaced
    assert.ok((profiles as string[]).includes('code'),
      `injected "code" profile must appear in availableFocusProfiles, got ${JSON.stringify(profiles)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GM-7: catalog ─────────────────────────────────────────────────────────────

const EXPECTED_CATALOG_KEYS = ['activeFocusSuggestions', 'byFocus', 'loaded', 'totalCombos'].sort();

test('GM-7: catalog has exact key set {loaded, totalCombos, byFocus, activeFocusSuggestions} and correct value types', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    const catalog = snap['catalog'];
    assert.ok(catalog !== null && typeof catalog === 'object' && !Array.isArray(catalog),
      `catalog must be a non-null object, got ${typeof catalog}`);
    const catObj = catalog as Record<string, unknown>;
    assert.deepEqual(Object.keys(catObj).sort(), EXPECTED_CATALOG_KEYS,
      `catalog key set mismatch.\nExpected: ${JSON.stringify(EXPECTED_CATALOG_KEYS)}\nActual:   ${JSON.stringify(Object.keys(catObj).sort())}`);

    assert.equal(typeof catObj['loaded'], 'boolean',
      `catalog.loaded must be boolean, got ${typeof catObj['loaded']}`);

    assert.equal(typeof catObj['totalCombos'], 'number',
      `catalog.totalCombos must be a number, got ${typeof catObj['totalCombos']}`);
    assert.ok(Number.isInteger(catObj['totalCombos'] as number),
      `catalog.totalCombos must be an integer, got ${catObj['totalCombos']}`);
    assert.ok((catObj['totalCombos'] as number) >= 0,
      `catalog.totalCombos must be non-negative, got ${catObj['totalCombos']}`);

    assert.ok(catObj['byFocus'] !== null && typeof catObj['byFocus'] === 'object' && !Array.isArray(catObj['byFocus']),
      `catalog.byFocus must be a non-null non-array object, got ${typeof catObj['byFocus']}`);

    const afs = catObj['activeFocusSuggestions'];
    assert.ok(afs === null || (typeof afs === 'object' && !Array.isArray(afs) && afs !== null),
      `catalog.activeFocusSuggestions must be null or a non-null object, got ${JSON.stringify(afs)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GM-8: brainHealth ─────────────────────────────────────────────────────────

const EXPECTED_BRAIN_HEALTH_KEYS = ['embeddingCircuitOpen', 'ollamaCircuitOpen', 'status'].sort();
const VALID_BRAIN_STATUSES = new Set(['ok', 'degraded']);

test('GM-8: brainHealth has exact key set {status, embeddingCircuitOpen, ollamaCircuitOpen} and correct value types', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    const bh = snap['brainHealth'];
    assert.ok(bh !== null && typeof bh === 'object' && !Array.isArray(bh),
      `brainHealth must be a non-null object, got ${typeof bh}`);
    const bhObj = bh as Record<string, unknown>;
    assert.deepEqual(Object.keys(bhObj).sort(), EXPECTED_BRAIN_HEALTH_KEYS,
      `brainHealth key set mismatch.\nExpected: ${JSON.stringify(EXPECTED_BRAIN_HEALTH_KEYS)}\nActual:   ${JSON.stringify(Object.keys(bhObj).sort())}`);

    assert.ok(VALID_BRAIN_STATUSES.has(bhObj['status'] as string),
      `brainHealth.status must be "ok" or "degraded", got ${JSON.stringify(bhObj['status'])}`);

    for (const key of ['embeddingCircuitOpen', 'ollamaCircuitOpen']) {
      assert.equal(typeof bhObj[key], 'boolean',
        `brainHealth.${key} must be boolean, got '${typeof bhObj[key]}' (value: ${JSON.stringify(bhObj[key])})`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GM-9: ledgerHealth ────────────────────────────────────────────────────────

const EXPECTED_LEDGER_HEALTH_KEYS = ['buffered', 'dlqEntries', 'dlqPath', 'dropped', 'flushErrors', 'status'].sort();
const VALID_LEDGER_STATUSES = new Set(['ok', 'warn', 'degraded']);

test('GM-9: ledgerHealth has exact key set {status, dropped, buffered, flushErrors, dlqEntries, dlqPath} and correct value types', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    const lh = snap['ledgerHealth'];
    assert.ok(lh !== null && typeof lh === 'object' && !Array.isArray(lh),
      `ledgerHealth must be a non-null object, got ${typeof lh}`);
    const lhObj = lh as Record<string, unknown>;
    assert.deepEqual(Object.keys(lhObj).sort(), EXPECTED_LEDGER_HEALTH_KEYS,
      `ledgerHealth key set mismatch.\nExpected: ${JSON.stringify(EXPECTED_LEDGER_HEALTH_KEYS)}\nActual:   ${JSON.stringify(Object.keys(lhObj).sort())}`);

    assert.ok(VALID_LEDGER_STATUSES.has(lhObj['status'] as string),
      `ledgerHealth.status must be "ok", "warn", or "degraded", got ${JSON.stringify(lhObj['status'])}`);

    for (const key of ['dropped', 'buffered', 'flushErrors', 'dlqEntries']) {
      const val = lhObj[key];
      assert.equal(typeof val, 'number',
        `ledgerHealth.${key} must be a number, got ${typeof val}`);
      assert.ok(Number.isInteger(val as number),
        `ledgerHealth.${key} must be an integer, got ${val}`);
      assert.ok((val as number) >= 0,
        `ledgerHealth.${key} must be non-negative, got ${val}`);
    }

    assert.equal(typeof lhObj['dlqPath'], 'string',
      `ledgerHealth.dlqPath must be a string, got ${typeof lhObj['dlqPath']}`);
    assert.ok((lhObj['dlqPath'] as string).length > 0,
      'ledgerHealth.dlqPath must be non-empty');
  } finally {
    await agg.shutdown();
  }
});

// ── GM-10: ledgerDlq ──────────────────────────────────────────────────────────

const EXPECTED_LEDGER_DLQ_KEYS = ['entryCount', 'entries', 'path'].sort();

test('GM-10: ledgerDlq has exact key set {path, entryCount, entries} and correct value types', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    const ld = snap['ledgerDlq'];
    assert.ok(ld !== null && typeof ld === 'object' && !Array.isArray(ld),
      `ledgerDlq must be a non-null object, got ${typeof ld}`);
    const ldObj = ld as Record<string, unknown>;
    assert.deepEqual(Object.keys(ldObj).sort(), EXPECTED_LEDGER_DLQ_KEYS,
      `ledgerDlq key set mismatch.\nExpected: ${JSON.stringify(EXPECTED_LEDGER_DLQ_KEYS)}\nActual:   ${JSON.stringify(Object.keys(ldObj).sort())}`);

    assert.equal(typeof ldObj['path'], 'string',
      `ledgerDlq.path must be a string, got ${typeof ldObj['path']}`);

    assert.equal(typeof ldObj['entryCount'], 'number',
      `ledgerDlq.entryCount must be a number, got ${typeof ldObj['entryCount']}`);
    assert.ok(Number.isInteger(ldObj['entryCount'] as number),
      `ledgerDlq.entryCount must be an integer, got ${ldObj['entryCount']}`);
    assert.ok((ldObj['entryCount'] as number) >= 0,
      `ledgerDlq.entryCount must be non-negative, got ${ldObj['entryCount']}`);

    assert.ok(Array.isArray(ldObj['entries']),
      `ledgerDlq.entries must be an array, got ${typeof ldObj['entries']}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GM-11: latencyMs ──────────────────────────────────────────────────────────

test('GM-11: latencyMs is a finite non-negative number', async () => {
  const agg = makeAgg();
  try {
    const snap = await getStatus(agg);
    const lms = snap['latencyMs'];
    assert.equal(typeof lms, 'number', `latencyMs must be a number, got ${typeof lms}`);
    assert.ok(Number.isFinite(lms as number), `latencyMs must be finite, got ${lms}`);
    assert.ok((lms as number) >= 0, `latencyMs must be non-negative, got ${lms}`);
  } finally {
    await agg.shutdown();
  }
});
