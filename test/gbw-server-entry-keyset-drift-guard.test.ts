/**
 * GBW drift guard: freeze servers[] entry exact key set in ch1tty/status.
 *
 * DZ froze the top-level + sub-object KEY SETS of the status response.
 * FY froze VALUE TYPES of all fields including servers[] entry primitives
 * (FY-10). Neither DZ nor FY freezes the EXACT key set of each individual
 * servers[] entry: a regression adding a new field (e.g. `endpoint`,
 * `latencyMs`, `lastError`, `auth`) or removing a required field would
 * pass both DZ and FY silently.
 *
 * GBW closes that gap by asserting:
 *
 *   GBW-1  connected server entry has exactly the 7 required keys and no more
 *   GBW-2  disconnected server entry (listToolsError) has exactly the same 7-key
 *          set — no extra keys emitted only on disconnected entries
 *   GBW-3  no phantom keys appear in any entry (no key outside the allowed set)
 *   GBW-4  key set is consistent across all entries in a multi-server config,
 *          covering both remote and local (type:'local') server config variants
 *   GBW-5  optional missingEnvVars key absent when no env vars are missing
 *
 * The fixture includes both a remote and a local server so neither config
 * variant can escape the exact-key-set assertion. Optional keys (missingEnvVars,
 * error) never appear in the fixture environment.
 *
 * Frozen 2026-09-26.
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
import type { FocusProfiles } from '../src-stdio/focus.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// ── Frozen key sets ────────────────────────────────────────────────────────────

// Required keys always present in every servers[] entry regardless of state.
const REQUIRED_KEYS = ['id', 'name', 'type', 'enabled', 'connected', 'toolCount', 'toolCacheAge'];

// In production, `error` (string) and `missingEnvVars` (string[]) may optionally appear.
// The FixtureBackend never emits `error` and the test CONFIGS have no envHeaders, so
// neither optional key appears in the fixture environment. GBW-3 asserts exactly the
// 7-key set so a regression emitting `error` on healthy entries is caught immediately.

const CONFIGS: ServerConfig[] = [
  { id: 'neon',       name: 'Neon',       type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://neon.tech/mcp',  lazy: true },
  { id: 'stripe',     name: 'Stripe',     type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
  { id: 'local-test', name: 'Local Test', type: 'local',  access: 'readwrite', category: 'code',      command: 'local-mcp',               lazy: true },
];

const FOCUS_PROFILES: FocusProfiles = {
  profiles: {
    code: { description: 'Code tools', categories: ['code' as const], servers: ['neon'], boost: 0.5 },
  },
};

let _seq = 0;
function makeAgg(disconnectStripe = false): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon',       FIXTURE_SERVERS.neon);
  backend.defineServer('stripe',     disconnectStripe
    ? { ...FIXTURE_SERVERS.stripe, listToolsError: true }
    : FIXTURE_SERVERS.stripe);
  backend.defineServer('local-test', FIXTURE_SERVERS.neon);
  return new Aggregator(CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-gbw-${Date.now()}-${++_seq}.jsonl`),
    focusProfiles: FOCUS_PROFILES,
  } as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

async function getServers(agg: Aggregator): Promise<Array<Record<string, unknown>>> {
  const result = await agg.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined, 'status must not error');
  const snap = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  return snap.servers as Array<Record<string, unknown>>;
}

// ── GBW-1: connected server entry has exactly the 7 required keys ─────────────

test('GBW-1: servers[] entry has all 7 required keys when server is connected', async () => {
  const agg = makeAgg(false);
  try {
    const servers = await getServers(agg);
    assert.ok(servers.length > 0, 'servers array must be non-empty');
    for (const s of servers) {
      for (const k of REQUIRED_KEYS) {
        assert.ok(Object.prototype.hasOwnProperty.call(s, k),
          `servers[] entry for "${s.id}" must have required key "${k}"`);
      }
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GBW-2: disconnected server entry has exactly the 7 required keys ──────────

test('GBW-2: servers[] entry has EXACTLY the 7 required keys when server is disconnected', async () => {
  const agg = makeAgg(true);  // stripe is disconnected (listToolsError)
  try {
    const servers = await getServers(agg);
    const disconnected = servers.filter((s) => s.connected === false);
    assert.ok(disconnected.length > 0,
      'at least one disconnected server must be present in this fixture');
    const exact = new Set(REQUIRED_KEYS);
    for (const s of disconnected) {
      for (const k of REQUIRED_KEYS) {
        assert.ok(Object.prototype.hasOwnProperty.call(s, k),
          `disconnected entry for "${s.id}" must have required key "${k}"`);
      }
      for (const k of Object.keys(s)) {
        assert.ok(exact.has(k),
          `disconnected entry for "${s.id}" has unexpected key "${k}" — expected only: ${REQUIRED_KEYS.join(', ')}`);
      }
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GBW-3: exact 7-key set — no phantom keys, no optional extras ──────────────

test('GBW-3: servers[] entry has EXACTLY the 7 required keys — no extras in fixture env', async () => {
  const agg = makeAgg(false);
  try {
    const servers = await getServers(agg);
    const exact = new Set(REQUIRED_KEYS);
    for (const s of servers) {
      for (const k of Object.keys(s)) {
        assert.ok(exact.has(k),
          `servers[] entry for "${s.id}" has unexpected key "${k}" — expected only: ${REQUIRED_KEYS.join(', ')}`);
      }
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GBW-4: key set is consistent across all entries in a multi-server config ──

test('GBW-4: key set is consistent across all servers[] entries', async () => {
  const agg = makeAgg(false);
  try {
    const servers = await getServers(agg);
    assert.ok(servers.length >= 2, 'must have at least 2 server entries to compare');
    const keysets = servers.map((s) => JSON.stringify(Object.keys(s).sort()));
    const first = keysets[0];
    for (let i = 1; i < keysets.length; i++) {
      assert.equal(keysets[i], first,
        `servers[${i}] key set (${keysets[i]}) differs from servers[0] (${first})`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GBW-5: missingEnvVars absent when no env vars are missing ─────────────────

test('GBW-5: missingEnvVars key absent in fixture env (no unset envHeaders)', async () => {
  const agg = makeAgg(false);
  try {
    const servers = await getServers(agg);
    for (const s of servers) {
      assert.ok(!Object.prototype.hasOwnProperty.call(s, 'missingEnvVars'),
        `servers[] entry for "${s.id}" must not have missingEnvVars when all env vars are set`);
    }
  } finally {
    await agg.shutdown();
  }
});
