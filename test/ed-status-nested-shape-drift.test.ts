/**
 * ED: Drift guard — ch1tty/status nested sub-object shapes.
 *
 * DZ (dz-status-response-field-drift.test.ts) froze the top-level and five
 * first-tier sub-object key sets for ch1tty/status. This file freezes the
 * remaining shapes DZ does not cover:
 *
 *   1. coordinator snapshot top-level fields
 *   2. coordinator.brain (OllamaBrainStats) fields
 *   3. coordinator.embeddingBrain (EmbeddingBrainStats) fields
 *   4. coordinator.ledger (LedgerStats) fields
 *   5. focus field — null when no focus active; shape when active
 *   6. catalog.activeFocusSuggestions — null when inactive; shape when active
 *   7. servers[] entry shape — required and permitted keys
 *
 * No test previously froze these nested shapes — a rename (e.g.
 * brain.circuitOpen → brain.open, ledger.flushed → ledger.sent) would
 * silently break API clients without DZ or this guard catching it.
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

const DLQ = join(tmpdir(), `ch1tty-ed-drift-${process.pid}-${Date.now()}.jsonl`);

// ── Canonical field sets (sorted alphabetically) ──────────────────────────────

const COORDINATOR_FIELDS = [
  'activeSessions',
  'boundEntity',
  'brain',
  'embeddingBrain',
  'evictedSessions',
  'ledger',
  'sessionTtlMs',
  'sessions',
  'toolsByServer',
  'topTools',
];

const BRAIN_FIELDS = [
  'avgLatencyMs',
  'calls',
  'circuitCooldownRemainingMs',
  'circuitOpen',
  'emptyResults',
  'errors',
  'successes',
  'timeouts',
];

const EMBEDDING_BRAIN_FIELDS = [
  'avgLatencyMs',
  'cacheHits',
  'cacheMisses',
  'cacheSize',
  'calls',
  'circuitCooldownRemainingMs',
  'circuitOpen',
  'emptyResults',
  'errors',
  'successes',
  'timeouts',
];

const LEDGER_STATS_FIELDS = [
  'buffered',
  'dlqEntries',
  'dlqPath',
  'dropped',
  'flushErrors',
  'flushIntervalMs',
  'flushed',
  'lastFlushAt',
];

const FOCUS_OBJECT_FIELDS = ['active', 'boost', 'categories', 'servers'];

const ACTIVE_FOCUS_SUGGESTIONS_FIELDS = ['combos', 'prompts'];

const SERVER_ENTRY_REQUIRED = ['connected', 'enabled', 'id', 'name', 'toolCacheAge', 'toolCount', 'type'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDlqPath(): string {
  return join(tmpdir(), `ch1tty-ed-${process.pid}-${Date.now()}.jsonl`);
}

function makeAggregator(opts?: { focusName?: string; withSuggestions?: boolean }): Aggregator {
  const suggestionsCatalog = opts?.withSuggestions
    ? {
        code: {
          description: 'Code-focused combos',
          combos: [
            {
              name: 'DB query',
              chain: ['neon/list_projects', 'neon/run_sql'],
              accomplishes: 'query a database',
              verified: true,
            },
          ],
          prompts: [{ text: 'run a query', resolves_to: 'neon/run_sql' }],
        },
      }
    : {};

  return new Aggregator([], {
    embedEnabled: false,
    ledgerDlqPath: makeDlqPath(),
    focusProfiles: {
      profiles: {
        code: { categories: ['code'], servers: [], boost: 0.5 },
      },
    },
    suggestionsCatalog,
    ...(opts?.focusName ? { focus: opts.focusName } : {}),
  });
}

function makeAggregatorWithServers(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  const configs: ServerConfig[] = [
    {
      id: 'neon',
      name: 'Neon',
      type: 'remote',
      access: 'readwrite',
      category: 'code',
      endpoint: 'https://neon.tech/mcp',
      lazy: true,
    },
    {
      id: 'stripe',
      name: 'Stripe',
      type: 'remote',
      access: 'readwrite',
      category: 'ecosystem',
      endpoint: 'https://stripe.com/mcp',
      lazy: true,
    },
  ];
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: makeDlqPath(),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
  });
}

async function getStatus(
  agg: Aggregator,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/status', args);
  assert.ok(!result.isError, `ch1tty/status returned isError: ${JSON.stringify(result.content)}`);
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── Suite 1: coordinator snapshot shape ───────────────────────────────────────

describe('ED — coordinator snapshot top-level fields', () => {
  test('coordinator has exactly the required top-level keys', async () => {
    const agg = makeAggregator();
    try {
      const body = await getStatus(agg);
      const coord = body['coordinator'] as Record<string, unknown>;
      assert.ok(coord && typeof coord === 'object' && !Array.isArray(coord), 'coordinator must be an object');
      const actual = Object.keys(coord).sort();
      assert.deepEqual(
        actual,
        COORDINATOR_FIELDS,
        `coordinator fields have drifted.\nAdded: ${actual.filter((k) => !COORDINATOR_FIELDS.includes(k)).join(', ') || 'none'}\nRemoved: ${COORDINATOR_FIELDS.filter((k) => !actual.includes(k)).join(', ') || 'none'}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('coordinator.brain has exactly the required fields (OllamaBrainStats)', async () => {
    const agg = makeAggregator();
    try {
      const body = await getStatus(agg);
      const coord = body['coordinator'] as Record<string, unknown>;
      const brain = coord['brain'] as Record<string, unknown>;
      assert.ok(brain && typeof brain === 'object' && !Array.isArray(brain), 'coordinator.brain must be an object');
      const actual = Object.keys(brain).sort();
      assert.deepEqual(
        actual,
        BRAIN_FIELDS,
        `coordinator.brain fields have drifted.\nAdded: ${actual.filter((k) => !BRAIN_FIELDS.includes(k)).join(', ') || 'none'}\nRemoved: ${BRAIN_FIELDS.filter((k) => !actual.includes(k)).join(', ') || 'none'}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('coordinator.embeddingBrain has exactly the required fields (EmbeddingBrainStats)', async () => {
    const agg = makeAggregator();
    try {
      const body = await getStatus(agg);
      const coord = body['coordinator'] as Record<string, unknown>;
      const eb = coord['embeddingBrain'] as Record<string, unknown>;
      assert.ok(eb && typeof eb === 'object' && !Array.isArray(eb), 'coordinator.embeddingBrain must be an object');
      const actual = Object.keys(eb).sort();
      assert.deepEqual(
        actual,
        EMBEDDING_BRAIN_FIELDS,
        `coordinator.embeddingBrain fields have drifted.\nAdded: ${actual.filter((k) => !EMBEDDING_BRAIN_FIELDS.includes(k)).join(', ') || 'none'}\nRemoved: ${EMBEDDING_BRAIN_FIELDS.filter((k) => !actual.includes(k)).join(', ') || 'none'}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('coordinator.ledger has exactly the required fields (LedgerStats)', async () => {
    const agg = makeAggregator();
    try {
      const body = await getStatus(agg);
      const coord = body['coordinator'] as Record<string, unknown>;
      const ledger = coord['ledger'] as Record<string, unknown>;
      assert.ok(ledger && typeof ledger === 'object' && !Array.isArray(ledger), 'coordinator.ledger must be an object');
      const actual = Object.keys(ledger).sort();
      assert.deepEqual(
        actual,
        LEDGER_STATS_FIELDS,
        `coordinator.ledger fields have drifted.\nAdded: ${actual.filter((k) => !LEDGER_STATS_FIELDS.includes(k)).join(', ') || 'none'}\nRemoved: ${LEDGER_STATS_FIELDS.filter((k) => !actual.includes(k)).join(', ') || 'none'}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('coordinator.brain numeric fields are non-negative numbers', async () => {
    const agg = makeAggregator();
    try {
      const body = await getStatus(agg);
      const brain = (body['coordinator'] as Record<string, unknown>)['brain'] as Record<string, unknown>;
      const numericFields = ['calls', 'successes', 'timeouts', 'errors', 'emptyResults', 'avgLatencyMs', 'circuitCooldownRemainingMs'] as const;
      for (const field of numericFields) {
        assert.ok(
          typeof brain[field] === 'number' && (brain[field] as number) >= 0,
          `coordinator.brain.${field} must be a non-negative number, got ${brain[field]}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('coordinator.brain.circuitOpen is a boolean', async () => {
    const agg = makeAggregator();
    try {
      const body = await getStatus(agg);
      const brain = (body['coordinator'] as Record<string, unknown>)['brain'] as Record<string, unknown>;
      assert.ok(typeof brain['circuitOpen'] === 'boolean', 'coordinator.brain.circuitOpen must be a boolean');
    } finally {
      await agg.shutdown();
    }
  });

  test('coordinator.ledger numeric fields are non-negative numbers', async () => {
    const agg = makeAggregator();
    try {
      const body = await getStatus(agg);
      const ledger = (body['coordinator'] as Record<string, unknown>)['ledger'] as Record<string, unknown>;
      const numericFields = ['buffered', 'flushed', 'dropped', 'flushErrors', 'flushIntervalMs', 'dlqEntries'] as const;
      for (const field of numericFields) {
        assert.ok(
          typeof ledger[field] === 'number' && (ledger[field] as number) >= 0,
          `coordinator.ledger.${field} must be a non-negative number, got ${ledger[field]}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('coordinator.sessions is an array', async () => {
    const agg = makeAggregator();
    try {
      const body = await getStatus(agg);
      const coord = body['coordinator'] as Record<string, unknown>;
      assert.ok(Array.isArray(coord['sessions']), 'coordinator.sessions must be an array');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: focus field shape ─────────────────────────────────────────────────

describe('ED — focus field shape', () => {
  test('focus is null when no focus profile is active', async () => {
    const agg = makeAggregator();
    try {
      const body = await getStatus(agg);
      assert.equal(body['focus'], null, 'focus must be null when no focus profile is active');
    } finally {
      await agg.shutdown();
    }
  });

  test('focus is an object with required keys when a focus profile is active', async () => {
    const agg = makeAggregator({ focusName: 'code' });
    try {
      const body = await getStatus(agg);
      const focus = body['focus'] as Record<string, unknown>;
      assert.ok(focus !== null && typeof focus === 'object' && !Array.isArray(focus), 'focus must be an object when a focus profile is active');
      const actual = Object.keys(focus).sort();
      assert.deepEqual(
        actual,
        FOCUS_OBJECT_FIELDS,
        `focus object fields have drifted.\nAdded: ${actual.filter((k) => !FOCUS_OBJECT_FIELDS.includes(k)).join(', ') || 'none'}\nRemoved: ${FOCUS_OBJECT_FIELDS.filter((k) => !actual.includes(k)).join(', ') || 'none'}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('focus.active matches the active profile name', async () => {
    const agg = makeAggregator({ focusName: 'code' });
    try {
      const body = await getStatus(agg);
      const focus = body['focus'] as Record<string, unknown>;
      assert.equal(focus['active'], 'code', 'focus.active must equal the active profile name');
    } finally {
      await agg.shutdown();
    }
  });

  test('focus.boost is a positive number when active', async () => {
    const agg = makeAggregator({ focusName: 'code' });
    try {
      const body = await getStatus(agg);
      const focus = body['focus'] as Record<string, unknown>;
      assert.ok(
        typeof focus['boost'] === 'number' && (focus['boost'] as number) > 0,
        `focus.boost must be a positive number, got ${focus['boost']}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('focus.categories and focus.servers are arrays when active', async () => {
    const agg = makeAggregator({ focusName: 'code' });
    try {
      const body = await getStatus(agg);
      const focus = body['focus'] as Record<string, unknown>;
      assert.ok(Array.isArray(focus['categories']), 'focus.categories must be an array');
      assert.ok(Array.isArray(focus['servers']), 'focus.servers must be an array');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 3: catalog.activeFocusSuggestions shape ─────────────────────────────

describe('ED — catalog.activeFocusSuggestions shape', () => {
  test('catalog.activeFocusSuggestions is null when no focus is active', async () => {
    const agg = makeAggregator();
    try {
      const body = await getStatus(agg);
      const catalog = body['catalog'] as Record<string, unknown>;
      assert.equal(catalog['activeFocusSuggestions'], null, 'activeFocusSuggestions must be null when no focus is active');
    } finally {
      await agg.shutdown();
    }
  });

  test('catalog.activeFocusSuggestions has combos and prompts arrays when focus is active and catalog has entries', async () => {
    const agg = makeAggregator({ focusName: 'code', withSuggestions: true });
    try {
      const body = await getStatus(agg);
      const catalog = body['catalog'] as Record<string, unknown>;
      const suggestions = catalog['activeFocusSuggestions'] as Record<string, unknown>;
      assert.ok(
        suggestions !== null && typeof suggestions === 'object' && !Array.isArray(suggestions),
        'activeFocusSuggestions must be an object when focus is active and catalog has entries',
      );
      const actual = Object.keys(suggestions).sort();
      assert.deepEqual(
        actual,
        ACTIVE_FOCUS_SUGGESTIONS_FIELDS,
        `activeFocusSuggestions fields have drifted: got ${actual.join(', ')}`,
      );
      assert.ok(Array.isArray(suggestions['combos']), 'activeFocusSuggestions.combos must be an array');
      assert.ok(Array.isArray(suggestions['prompts']), 'activeFocusSuggestions.prompts must be an array');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 4: servers[] entry shape ────────────────────────────────────────────

describe('ED — servers[] entry shape', () => {
  test('each server entry has all required keys', async () => {
    const agg = makeAggregatorWithServers();
    try {
      const body = await getStatus(agg);
      const servers = body['servers'] as Record<string, unknown>[];
      assert.ok(Array.isArray(servers) && servers.length > 0, 'servers must be a non-empty array for entry shape test');
      for (const entry of servers) {
        const missing = SERVER_ENTRY_REQUIRED.filter((k) => !(k in entry));
        assert.deepEqual(
          missing,
          [],
          `Server entry "${entry['id']}" is missing required keys: ${missing.join(', ')}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('server entry has no unexpected keys when no missing env vars', async () => {
    const agg = makeAggregatorWithServers();
    try {
      const body = await getStatus(agg);
      const servers = body['servers'] as Record<string, unknown>[];
      assert.ok(Array.isArray(servers) && servers.length > 0, 'servers must be non-empty');
      for (const entry of servers) {
        const unexpected = Object.keys(entry).filter((k) => !SERVER_ENTRY_REQUIRED.includes(k));
        assert.deepEqual(
          unexpected,
          [],
          `Server entry "${entry['id']}" has unexpected keys: ${unexpected.join(', ')}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('server entry id, name, type are non-empty strings', async () => {
    const agg = makeAggregatorWithServers();
    try {
      const body = await getStatus(agg);
      const servers = body['servers'] as Record<string, unknown>[];
      for (const entry of servers) {
        for (const field of ['id', 'name', 'type'] as const) {
          assert.ok(
            typeof entry[field] === 'string' && (entry[field] as string).length > 0,
            `Server entry ${entry['id']}: ${field} must be a non-empty string, got ${entry[field]}`,
          );
        }
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('server entry enabled is boolean, toolCount is non-negative integer, connected is boolean', async () => {
    const agg = makeAggregatorWithServers();
    try {
      const body = await getStatus(agg);
      const servers = body['servers'] as Record<string, unknown>[];
      for (const entry of servers) {
        assert.ok(typeof entry['enabled'] === 'boolean', `Server ${entry['id']}: enabled must be boolean`);
        assert.ok(typeof entry['connected'] === 'boolean', `Server ${entry['id']}: connected must be boolean`);
        assert.ok(
          typeof entry['toolCount'] === 'number' && Number.isInteger(entry['toolCount']) && (entry['toolCount'] as number) >= 0,
          `Server ${entry['id']}: toolCount must be a non-negative integer, got ${entry['toolCount']}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });
});
