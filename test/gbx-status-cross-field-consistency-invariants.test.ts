/**
 * GBX drift guard: freeze ch1tty/status cross-field consistency invariants.
 *
 * DZ froze the top-level key set (18 fields). FY froze value types. GBW (PR
 * #1526) froze each servers[] entry's exact key set. None of these tests
 * freeze the RELATIONSHIPS between the derived aggregate fields and the
 * servers[] array they summarise:
 *
 *   - `totalServers` is computed as `statuses.length` (core.ts line ~816)
 *   - `connectedServers` is computed as `statuses.filter(s => s.connected).length`
 *   - `totalTools` is computed as `statuses.reduce((sum, s) => sum + s.toolCount, 0)`
 *
 * A refactor that changes one side of these derivations without updating the
 * other (e.g. filtering out disabled servers from `servers[]` but not from
 * `totalServers`, or rewriting `connectedServers` as a cached field that
 * diverges from the live array) would pass DZ, FY, and GBW silently.
 *
 * GBX freezes these cross-field consistency invariants:
 *
 *   GBX-1  `totalServers` === `servers.length` (aggregate matches source array)
 *   GBX-2  `connectedServers` === `servers.filter(s => s.connected).length`
 *             (aggregate matches live connected count in source array)
 *   GBX-3  `totalTools` === `servers.reduce((sum, s) => sum + s.toolCount, 0)`
 *             (aggregate matches sum of per-server tool counts)
 *   GBX-4  `connectedServers` <= `totalServers`
 *             (connected count can never exceed total count)
 *   GBX-5  `servers.length` equals the number of active (enabled) configs
 *             (no server entry silently dropped or duplicated)
 *
 * Fixture: stripe (3 tools) + neon (6 tools), both enabled. Both use
 * FixtureBackend so they are "connected" in tests (backend always responds).
 * A third disabled config is included to verify it is excluded from servers[].
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
  return join(tmpdir(), `ch1tty-gbx-${Date.now()}-${++_seq}.jsonl`);
}

// Two enabled servers + one explicitly disabled server.
// GBX-5 verifies the disabled entry does NOT appear in servers[].
const ACTIVE_CONFIGS: ServerConfig[] = [
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
    category: 'data',
    endpoint: 'https://neon.tech/mcp',
    lazy: true,
  },
];

const DISABLED_CONFIG: ServerConfig = {
  id: 'disabled-server',
  name: 'Disabled Server',
  type: 'remote',
  access: 'read',
  category: 'ecosystem',
  endpoint: 'https://disabled.example.com/mcp',
  lazy: true,
  enabled: false,
};

const ALL_CONFIGS: ServerConfig[] = [...ACTIVE_CONFIGS, DISABLED_CONFIG];

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  return new Aggregator(ALL_CONFIGS, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlq(),
  });
}

async function getStatus(agg: Aggregator): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined, 'status must not return isError');
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1);
  assert.equal(content[0]!.type, 'text');
  return JSON.parse(content[0]!.text!) as Record<string, unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GBX-1: status.totalServers === status.servers.length (aggregate matches source array length)', async () => {
  const agg = makeAgg();
  const snap = await getStatus(agg);
  const totalServers = snap['totalServers'] as number;
  const servers = snap['servers'] as unknown[];
  assert.equal(
    totalServers,
    servers.length,
    `totalServers (${totalServers}) must equal servers.length (${servers.length})`,
  );
});

test('GBX-2: status.connectedServers === servers[].filter(s => s.connected).length (aggregate matches live array)', async () => {
  const agg = makeAgg();
  const snap = await getStatus(agg);
  const connectedServers = snap['connectedServers'] as number;
  const servers = snap['servers'] as Array<Record<string, unknown>>;
  const derivedConnected = servers.filter((s) => s['connected'] === true).length;
  assert.equal(
    connectedServers,
    derivedConnected,
    `connectedServers (${connectedServers}) must equal servers[].filter(connected).length (${derivedConnected})`,
  );
});

test('GBX-3: status.totalTools === servers[].reduce(sum + toolCount, 0) (aggregate matches per-server tool counts)', async () => {
  const agg = makeAgg();
  const snap = await getStatus(agg);
  const totalTools = snap['totalTools'] as number;
  const servers = snap['servers'] as Array<Record<string, unknown>>;
  const derivedTotal = servers.reduce((sum, s) => sum + (s['toolCount'] as number), 0);
  assert.equal(
    totalTools,
    derivedTotal,
    `totalTools (${totalTools}) must equal sum of servers[].toolCount (${derivedTotal})`,
  );
});

test('GBX-4: status.connectedServers <= status.totalServers (connected count cannot exceed total)', async () => {
  const agg = makeAgg();
  const snap = await getStatus(agg);
  const connectedServers = snap['connectedServers'] as number;
  const totalServers = snap['totalServers'] as number;
  assert.ok(
    connectedServers <= totalServers,
    `connectedServers (${connectedServers}) must be <= totalServers (${totalServers})`,
  );
});

test('GBX-5: status.servers.length equals enabled-config count (disabled configs excluded; no silent drop or duplicate)', async () => {
  const agg = makeAgg();
  const snap = await getStatus(agg);
  const servers = snap['servers'] as Array<Record<string, unknown>>;
  // ACTIVE_CONFIGS has 2 entries; DISABLED_CONFIG must not appear in servers[]
  const expectedCount = ACTIVE_CONFIGS.length;
  assert.equal(
    servers.length,
    expectedCount,
    `servers.length (${servers.length}) must equal active config count (${expectedCount}); disabled config must be excluded`,
  );
  // Confirm disabled-server is not present
  const ids = servers.map((s) => s['id']);
  assert.ok(
    !ids.includes('disabled-server'),
    `disabled-server must not appear in servers[]; got ids: ${JSON.stringify(ids)}`,
  );
});
