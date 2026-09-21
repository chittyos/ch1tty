/**
 * GD drift guard: freeze servers[] entry remaining VALUE TYPES in ch1tty/status.
 *
 * ED froze the exact key set for servers[] entries and asserted the basic value
 * types for id/name/type (non-empty strings), enabled/connected (booleans), and
 * toolCount (non-negative integer). Two gaps remain:
 *
 *   1. `toolCacheAge` — ED confirms the key is present but never asserts its
 *      type or constraint. It must be null when the server is not connected, or
 *      a finite non-negative number (milliseconds since cache was populated)
 *      when connected.
 *
 *   2. `missingEnvVars` — a conditional field that appears ONLY when a remote
 *      server's envHeaders references an env-var name that is absent from
 *      process.env. ED's key-set test runs against servers that never trigger
 *      this branch, so neither the extended key set nor the array-of-strings
 *      value type is frozen.
 *
 * GD closes those gaps:
 *
 *   GD-1  toolCacheAge is null when server is not connected (lazy, no cache)
 *   GD-2  toolCacheAge is null or a finite non-negative number (connected does NOT
 *          guarantee a populated cache — RemoteProxy returns null when listTools
 *          hasn't run yet; the FixtureBackend exercises the non-null path)
 *   GD-3  missingEnvVars is absent when envHeaders is not configured
 *   GD-3b missingEnvVars is absent when envHeaders IS configured but every
 *          referenced env var is present in process.env
 *   GD-4  missingEnvVars is present and a non-empty array when an envHeaders
 *          env-var is unset
 *   GD-5  each entry in missingEnvVars is a non-empty string
 *   GD-6  servers[] entry key set when missingEnvVars is present equals the
 *          required set plus 'missingEnvVars' (no extra keys)
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

// ── Helpers ──────────────────────────────────────────────────────────────────

const REQUIRED_SERVER_ENTRY_KEYS = [
  'connected',
  'enabled',
  'id',
  'name',
  'toolCacheAge',
  'toolCount',
  'type',
].sort();

let _seq = 0;

function makeDlq(): string {
  return join(tmpdir(), `ch1tty-gd-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(
  configs: ServerConfig[],
  definedServers: Record<string, (typeof FIXTURE_SERVERS)[keyof typeof FIXTURE_SERVERS]>,
): Aggregator {
  const backend = new FixtureBackend();
  for (const [id, def] of Object.entries(definedServers)) {
    backend.defineServer(id, def);
  }
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: makeDlq(),
  } as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

async function getServers(agg: Aggregator): Promise<Array<Record<string, unknown>>> {
  const result = await agg.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined, 'status must not error');
  const snap = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  assert.ok(Array.isArray(snap.servers), 'snap.servers must be an array');
  return snap.servers as Array<Record<string, unknown>>;
}

// ── GD-1: toolCacheAge is null when server not connected ─────────────────────

test('GD-1: servers[] entry — toolCacheAge is null when server is not connected', async () => {
  // Server 'neon' is in configs but NOT defined in the fixture → not connected
  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
  ];
  const agg = makeAgg(configs, {});
  try {
    const servers = await getServers(agg);
    assert.equal(servers.length, 1, 'must have exactly one server entry');
    const entry = servers[0];
    assert.equal(entry.connected, false, 'server must not be connected');
    assert.equal(entry.toolCacheAge, null, 'toolCacheAge must be null when not connected');
  } finally {
    await agg.shutdown?.();
  }
});

// ── GD-2: toolCacheAge is null or a finite non-negative number when connected ──
//
// RemoteProxy.getStatus() (src-stdio/remote-proxy.ts:480-485) returns
// connected:true with toolCacheAge:null when listTools hasn't run yet — a
// connected-but-uncached server is a valid production state. The FixtureBackend
// returns 0 for defined servers, exercising the non-null path. The correct
// invariant is null | finite non-negative number, NOT "number if connected".

test('GD-2: servers[] entry — toolCacheAge is null or a finite non-negative number when connected', async () => {
  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
  ];
  const agg = makeAgg(configs, { neon: FIXTURE_SERVERS.neon });
  try {
    const servers = await getServers(agg);
    assert.equal(servers.length, 1, 'must have exactly one server entry');
    const entry = servers[0];
    assert.equal(entry.connected, true, 'server must be connected');
    // toolCacheAge must be null OR a finite non-negative number — both are valid
    const age = entry.toolCacheAge;
    if (age !== null) {
      assert.equal(typeof age, 'number', 'toolCacheAge must be a number when non-null');
      assert.ok(Number.isFinite(age as number), 'toolCacheAge must be finite when non-null');
      assert.ok((age as number) >= 0, 'toolCacheAge must be non-negative when non-null');
    }
    assert.ok(
      age === null || (typeof age === 'number' && Number.isFinite(age as number) && (age as number) >= 0),
      `toolCacheAge must be null or a finite non-negative number, got ${JSON.stringify(age)}`,
    );
  } finally {
    await agg.shutdown?.();
  }
});

// ── GD-3: missingEnvVars absent when no envHeaders configured ─────────────────

test('GD-3: servers[] entry — missingEnvVars is absent when server has no envHeaders', async () => {
  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
    { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
  ];
  const agg = makeAgg(configs, { neon: FIXTURE_SERVERS.neon, stripe: FIXTURE_SERVERS.stripe });
  try {
    const servers = await getServers(agg);
    for (const entry of servers) {
      assert.ok(
        !('missingEnvVars' in entry),
        `servers[${entry.id}] must NOT have missingEnvVars key when no envHeaders are configured`,
      );
    }
  } finally {
    await agg.shutdown?.();
  }
});

// ── GD-3b: missingEnvVars absent when envHeaders IS configured and var is set ──
//
// GD-3 only tests servers without envHeaders. A regression that emits
// missingEnvVars for every server that HAS envHeaders — regardless of whether
// the var is set — would still pass GD-3. GD-3b closes that gap.

test('GD-3b: servers[] entry — missingEnvVars is absent when envHeaders var IS present in process.env', async () => {
  const PRESENT_VAR = 'CH1TTY_GD_DRIFT_GUARD_PRESENT_ENV_VAR_001';
  const saved = process.env[PRESENT_VAR];
  process.env[PRESENT_VAR] = 'present-value';

  const configs: ServerConfig[] = [
    {
      id: 'satisfied',
      name: 'Satisfied Server',
      type: 'remote',
      access: 'readwrite',
      category: 'ecosystem',
      endpoint: 'https://satisfied.example.com/mcp',
      envHeaders: { 'X-Satisfied': PRESENT_VAR },
      lazy: true,
    },
  ];
  const agg = makeAgg(configs, {});
  try {
    const servers = await getServers(agg);
    assert.equal(servers.length, 1, 'must have exactly one server entry');
    const entry = servers[0];
    assert.ok(
      !('missingEnvVars' in entry),
      'missingEnvVars must be absent when envHeaders var IS present in process.env',
    );
  } finally {
    await agg.shutdown?.();
    if (saved === undefined) {
      delete process.env[PRESENT_VAR];
    } else {
      process.env[PRESENT_VAR] = saved;
    }
  }
});

// ── GD-4: missingEnvVars present and non-empty when envHeaders var is unset ───

test('GD-4: servers[] entry — missingEnvVars is a non-empty array when envHeaders var is unset', async () => {
  // Use a var name that is guaranteed not to be set in any CI/test environment
  const MISSING_VAR = 'CH1TTY_GD_DRIFT_GUARD_UNSET_ENV_VAR_001';
  // Safety: unset it in case some stray process set it
  const saved = process.env[MISSING_VAR];
  delete process.env[MISSING_VAR];

  const configs: ServerConfig[] = [
    {
      id: 'guarded',
      name: 'Guarded Server',
      type: 'remote',
      access: 'readwrite',
      category: 'ecosystem',
      endpoint: 'https://guarded.example.com/mcp',
      envHeaders: { 'X-Auth-Token': MISSING_VAR },
      lazy: true,
    },
  ];
  const agg = makeAgg(configs, {});
  try {
    const servers = await getServers(agg);
    assert.equal(servers.length, 1, 'must have exactly one server entry');
    const entry = servers[0];
    assert.ok('missingEnvVars' in entry, 'missingEnvVars must be present when envHeaders var is unset');
    assert.ok(Array.isArray(entry.missingEnvVars), 'missingEnvVars must be an array');
    assert.ok(
      (entry.missingEnvVars as unknown[]).length > 0,
      'missingEnvVars must be non-empty when a var is unset',
    );
  } finally {
    await agg.shutdown?.();
    // Restore env if it was set
    if (saved !== undefined) process.env[MISSING_VAR] = saved;
  }
});

// ── GD-5: each entry in missingEnvVars is a non-empty string ─────────────────

test('GD-5: servers[] entry — each missingEnvVars entry is a non-empty string', async () => {
  const MISSING_VAR_A = 'CH1TTY_GD_DRIFT_GUARD_UNSET_VAR_A';
  const MISSING_VAR_B = 'CH1TTY_GD_DRIFT_GUARD_UNSET_VAR_B';
  const savedA = process.env[MISSING_VAR_A];
  const savedB = process.env[MISSING_VAR_B];
  delete process.env[MISSING_VAR_A];
  delete process.env[MISSING_VAR_B];

  const configs: ServerConfig[] = [
    {
      id: 'guarded2',
      name: 'Guarded Server 2',
      type: 'remote',
      access: 'readwrite',
      category: 'ecosystem',
      endpoint: 'https://guarded2.example.com/mcp',
      envHeaders: {
        'X-Token-A': MISSING_VAR_A,
        'X-Token-B': MISSING_VAR_B,
      },
      lazy: true,
    },
  ];
  const agg = makeAgg(configs, {});
  try {
    const servers = await getServers(agg);
    assert.equal(servers.length, 1, 'must have exactly one server entry');
    const entry = servers[0];
    assert.ok('missingEnvVars' in entry, 'missingEnvVars must be present');
    const missing = entry.missingEnvVars as unknown[];
    assert.ok(Array.isArray(missing), 'missingEnvVars must be an array');
    for (const v of missing) {
      assert.equal(typeof v, 'string', `each missingEnvVars entry must be a string, got ${typeof v}`);
      assert.ok((v as string).length > 0, `each missingEnvVars entry must be a non-empty string, got "${v}"`);
    }
    // Both unset vars should appear
    assert.ok(missing.includes(MISSING_VAR_A), `missingEnvVars must include "${MISSING_VAR_A}"`);
    assert.ok(missing.includes(MISSING_VAR_B), `missingEnvVars must include "${MISSING_VAR_B}"`);
  } finally {
    await agg.shutdown?.();
    if (savedA !== undefined) process.env[MISSING_VAR_A] = savedA;
    if (savedB !== undefined) process.env[MISSING_VAR_B] = savedB;
  }
});

// ── GD-6: key set when missingEnvVars is present = required + missingEnvVars ──

test('GD-6: servers[] entry key set when missingEnvVars present equals required keys + missingEnvVars', async () => {
  const MISSING_VAR = 'CH1TTY_GD_DRIFT_GUARD_KEYSET_VAR';
  const saved = process.env[MISSING_VAR];
  delete process.env[MISSING_VAR];

  const configs: ServerConfig[] = [
    {
      id: 'guarded3',
      name: 'Guarded Server 3',
      type: 'remote',
      access: 'readwrite',
      category: 'ecosystem',
      endpoint: 'https://guarded3.example.com/mcp',
      envHeaders: { 'X-Secret': MISSING_VAR },
      lazy: true,
    },
  ];
  const agg = makeAgg(configs, {});
  try {
    const servers = await getServers(agg);
    assert.equal(servers.length, 1, 'must have exactly one server entry');
    const entry = servers[0];

    const expectedKeys = [...REQUIRED_SERVER_ENTRY_KEYS, 'missingEnvVars'].sort();
    const actualKeys = Object.keys(entry).sort();
    assert.deepEqual(
      actualKeys,
      expectedKeys,
      `servers[] entry key set with missingEnvVars must be exactly ${JSON.stringify(expectedKeys)}, got ${JSON.stringify(actualKeys)}`,
    );
  } finally {
    await agg.shutdown?.();
    if (saved !== undefined) process.env[MISSING_VAR] = saved;
  }
});
