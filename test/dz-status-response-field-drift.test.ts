/**
 * DZ — ch1tty/status response top-level field drift guard.
 *
 * Freezes the exact set of top-level keys returned by the ch1tty/status
 * meta-tool and its sub-objects (systemHealth, brainHealth, ledgerHealth,
 * ledgerDlq, catalog). No test previously locked these field names — only
 * individual values were asserted. If a field is renamed, removed, or added
 * without intention, this test fails at unit speed.
 *
 * Two call paths covered:
 *   1. Full status (short: false / default) — 18 top-level keys
 *   2. Short status (short: true) — 16 keys (servers omitted; coordinator loses sessions)
 *
 * Sub-object field sets frozen:
 *   - systemHealth:  status, brainDegraded, ledgerStatus  (3 fields)
 *   - brainHealth:   status, embeddingCircuitOpen, ollamaCircuitOpen  (3 fields)
 *   - ledgerHealth:  status, dropped, buffered, flushErrors, dlqEntries, dlqPath  (6 fields)
 *   - ledgerDlq:     path, entryCount, entries  (3 fields)
 *   - catalog:       loaded, totalCombos, byFocus, activeFocusSuggestions  (4 fields)
 *
 * Measured on 2026-09-19. Update ONLY when intentionally changing the status
 * response contract — concurrent changes to CLAUDE.md spec are expected.
 */

import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, before, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';

const DLQ = join(tmpdir(), `ch1tty-dz-drift-${process.pid}-${Date.now()}.jsonl`);

// Canonical field sets — sorted alphabetically.
const FULL_TOP_LEVEL_FIELDS = [
  'activeSessions',
  'availableFocusProfiles',
  'brainHealth',
  'catalog',
  'connectedServers',
  'coordinator',
  'focus',
  'gateway',
  'latencyMs',
  'ledgerDlq',
  'ledgerHealth',
  'registryCached',
  'servers',
  'systemHealth',
  'totalServers',
  'totalTools',
  'uptime',
  'version',
];

const SHORT_TOP_LEVEL_FIELDS = [
  'activeSessions',
  'availableFocusProfiles',
  'brainHealth',
  'catalog',
  'connectedServers',
  'coordinator',
  'focus',
  'gateway',
  'latencyMs',
  'ledgerDlq',
  'ledgerHealth',
  'registryCached',
  'systemHealth',
  'totalServers',
  'totalTools',
  'uptime',
  'version',
];

const SYSTEM_HEALTH_FIELDS = ['brainDegraded', 'ledgerStatus', 'status'];
const BRAIN_HEALTH_FIELDS = ['embeddingCircuitOpen', 'ollamaCircuitOpen', 'status'];
const LEDGER_HEALTH_FIELDS = ['buffered', 'dlqEntries', 'dlqPath', 'dropped', 'flushErrors', 'status'];
const LEDGER_DLQ_FIELDS = ['entries', 'entryCount', 'path'];
const CATALOG_FIELDS = ['activeFocusSuggestions', 'byFocus', 'loaded', 'totalCombos'];

type StatusBody = Record<string, unknown>;

describe('DZ — ch1tty/status full response field drift guard', () => {
  let body: StatusBody;

  before(async () => {
    const agg = new Aggregator([], {
      embedEnabled: false,
      ledgerDlqPath: DLQ,
      focusProfiles: { profiles: {} },
      suggestionsCatalog: {},
    });
    try {
      const result = await agg.callTool('ch1tty/status', {});
      assert.ok(!result.isError, `ch1tty/status returned isError: ${JSON.stringify(result.content)}`);
      const text = (result.content[0] as { text: string }).text;
      body = JSON.parse(text) as StatusBody;
    } finally {
      await agg.shutdown();
    }
  });

  test('DZ-01 full status has exactly 18 top-level fields', () => {
    const actual = Object.keys(body).sort();
    assert.deepEqual(
      actual,
      FULL_TOP_LEVEL_FIELDS,
      `ch1tty/status full response top-level fields have drifted.\n` +
      `Added: ${actual.filter((k) => !FULL_TOP_LEVEL_FIELDS.includes(k)).join(', ') || 'none'}\n` +
      `Removed: ${FULL_TOP_LEVEL_FIELDS.filter((k) => !actual.includes(k)).join(', ') || 'none'}`,
    );
  });

  test('DZ-02 gateway is exactly "ch1tty"', () => {
    assert.equal(body.gateway, 'ch1tty', 'gateway field must be "ch1tty"');
  });

  test('DZ-03 version is a non-empty string', () => {
    assert.ok(typeof body.version === 'string' && body.version.length > 0, 'version must be a non-empty string');
  });

  test('DZ-04 latencyMs is a non-negative number', () => {
    assert.ok(typeof body.latencyMs === 'number' && body.latencyMs >= 0, 'latencyMs must be a non-negative number');
  });

  test('DZ-05 servers is an array', () => {
    assert.ok(Array.isArray(body.servers), 'servers must be an array');
  });

  test('DZ-06 systemHealth has exactly 3 fields', () => {
    const sh = body.systemHealth as Record<string, unknown>;
    assert.ok(sh && typeof sh === 'object' && !Array.isArray(sh), 'systemHealth must be an object');
    const actual = Object.keys(sh).sort();
    assert.deepEqual(actual, SYSTEM_HEALTH_FIELDS, `systemHealth fields have drifted: got ${actual.join(', ')}`);
  });

  test('DZ-07 systemHealth.status is ok|warn|degraded', () => {
    const sh = body.systemHealth as { status: string };
    assert.ok(['ok', 'warn', 'degraded'].includes(sh.status), `systemHealth.status must be ok|warn|degraded, got ${sh.status}`);
  });

  test('DZ-08 systemHealth.brainDegraded is boolean', () => {
    const sh = body.systemHealth as { brainDegraded: unknown };
    assert.ok(typeof sh.brainDegraded === 'boolean', 'systemHealth.brainDegraded must be boolean');
  });

  test('DZ-09 systemHealth.ledgerStatus is ok|warn|degraded', () => {
    const sh = body.systemHealth as { ledgerStatus: string };
    assert.ok(['ok', 'warn', 'degraded'].includes(sh.ledgerStatus), `systemHealth.ledgerStatus must be ok|warn|degraded, got ${sh.ledgerStatus}`);
  });

  test('DZ-10 brainHealth has exactly 3 fields', () => {
    const bh = body.brainHealth as Record<string, unknown>;
    assert.ok(bh && typeof bh === 'object' && !Array.isArray(bh), 'brainHealth must be an object');
    const actual = Object.keys(bh).sort();
    assert.deepEqual(actual, BRAIN_HEALTH_FIELDS, `brainHealth fields have drifted: got ${actual.join(', ')}`);
  });

  test('DZ-11 ledgerHealth has exactly 6 fields', () => {
    const lh = body.ledgerHealth as Record<string, unknown>;
    assert.ok(lh && typeof lh === 'object' && !Array.isArray(lh), 'ledgerHealth must be an object');
    const actual = Object.keys(lh).sort();
    assert.deepEqual(actual, LEDGER_HEALTH_FIELDS, `ledgerHealth fields have drifted: got ${actual.join(', ')}`);
  });

  test('DZ-12 ledgerDlq has exactly 3 fields', () => {
    const ld = body.ledgerDlq as Record<string, unknown>;
    assert.ok(ld && typeof ld === 'object' && !Array.isArray(ld), 'ledgerDlq must be an object');
    const actual = Object.keys(ld).sort();
    assert.deepEqual(actual, LEDGER_DLQ_FIELDS, `ledgerDlq fields have drifted: got ${actual.join(', ')}`);
  });

  test('DZ-13 catalog has exactly 4 fields', () => {
    const cat = body.catalog as Record<string, unknown>;
    assert.ok(cat && typeof cat === 'object' && !Array.isArray(cat), 'catalog must be an object');
    const actual = Object.keys(cat).sort();
    assert.deepEqual(actual, CATALOG_FIELDS, `catalog fields have drifted: got ${actual.join(', ')}`);
  });

  test('DZ-14 availableFocusProfiles is an array', () => {
    assert.ok(Array.isArray(body.availableFocusProfiles), 'availableFocusProfiles must be an array');
  });

  test('DZ-15 registryCached is boolean', () => {
    assert.ok(typeof body.registryCached === 'boolean', 'registryCached must be boolean');
  });

  test('DZ-16 activeSessions is a non-negative integer', () => {
    assert.ok(typeof body.activeSessions === 'number' && Number.isInteger(body.activeSessions) && (body.activeSessions as number) >= 0, 'activeSessions must be a non-negative integer');
  });

  test('DZ-17 totalServers is a non-negative integer', () => {
    assert.ok(typeof body.totalServers === 'number' && Number.isInteger(body.totalServers) && (body.totalServers as number) >= 0, 'totalServers must be a non-negative integer');
  });

  test('DZ-18 totalTools is a non-negative integer', () => {
    assert.ok(typeof body.totalTools === 'number' && Number.isInteger(body.totalTools) && (body.totalTools as number) >= 0, 'totalTools must be a non-negative integer');
  });
});

describe('DZ — ch1tty/status short=true response field drift guard', () => {
  let body: StatusBody;

  before(async () => {
    const agg = new Aggregator([], {
      embedEnabled: false,
      ledgerDlqPath: join(tmpdir(), `ch1tty-dz-short-${process.pid}-${Date.now()}.jsonl`),
      focusProfiles: { profiles: {} },
      suggestionsCatalog: {},
    });
    try {
      const result = await agg.callTool('ch1tty/status', { short: true });
      assert.ok(!result.isError, `ch1tty/status short returned isError: ${JSON.stringify(result.content)}`);
      const text = (result.content[0] as { text: string }).text;
      body = JSON.parse(text) as StatusBody;
    } finally {
      await agg.shutdown();
    }
  });

  test('DZ-19 short status has exactly 17 top-level fields (no servers)', () => {
    const actual = Object.keys(body).sort();
    assert.deepEqual(
      actual,
      SHORT_TOP_LEVEL_FIELDS,
      `ch1tty/status short response top-level fields have drifted.\n` +
      `Added: ${actual.filter((k) => !SHORT_TOP_LEVEL_FIELDS.includes(k)).join(', ') || 'none'}\n` +
      `Removed: ${SHORT_TOP_LEVEL_FIELDS.filter((k) => !actual.includes(k)).join(', ') || 'none'}`,
    );
  });

  test('DZ-20 short status omits servers', () => {
    assert.ok(!Object.prototype.hasOwnProperty.call(body, 'servers'), 'short status must not include servers');
  });

  test('DZ-21 short status coordinator omits sessions', () => {
    const coord = body.coordinator as Record<string, unknown> | null;
    assert.ok(coord && typeof coord === 'object', 'coordinator must be present in short status');
    assert.ok(!Object.prototype.hasOwnProperty.call(coord, 'sessions'), 'short status coordinator must not include sessions');
  });

  test('DZ-22 short status still includes systemHealth', () => {
    assert.ok(body.systemHealth !== undefined, 'systemHealth must be present in short status');
  });

  test('DZ-23 short status still includes latencyMs', () => {
    assert.ok(typeof body.latencyMs === 'number', 'latencyMs must be present in short status');
  });
});
