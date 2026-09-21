/**
 * FE: Drift guard — /api/v1/health response body exact key sets.
 *
 * Prior health tests (EEEEE, OOOOO, VVVV) verify that individual conditional
 * fields are present or absent under specific health states. None freeze the
 * COMPLETE key set for each scenario. A rename or accidental addition (e.g.
 * `service` → `name`, an extra `version` key) would pass silently.
 *
 * This guard freezes the exact sorted key set for every health state variant:
 *
 *   FE-1  ok  + ledgerStatus:ok  → {ledgerOk, service, status, systemHealth}
 *   FE-2  warn + brainDegraded + ledgerStatus:ok
 *                               → {brainCircuitOpen, service, status, systemHealth}
 *   FE-3  warn + !brainDegraded + ledgerStatus:warn
 *                               → {ledgerWarn, service, status, systemHealth}
 *   FE-4  warn + brainDegraded + ledgerStatus:warn
 *                               → {brainCircuitOpen, ledgerWarn, service, status, systemHealth}
 *   FE-5  degraded (503)        → {ledgerDlq, service, status, systemHealth}
 *   FE-6  internal error (503)  → {error, service, status}
 *
 * Additionally freezes sub-object shapes:
 *   FE-7  systemHealth keys: {brainDegraded, ledgerStatus, status}
 *   FE-8  ledgerDlq keys:    {entryCount}
 *   FE-9  value types: status string, service 'ch1tty', systemHealth object
 *   FE-10 ledgerOk/brainCircuitOpen/ledgerWarn are exactly boolean true
 *   FE-11 ledgerDlq.entryCount is a non-negative integer
 *   FE-12 error field (internal failure) is a non-empty string
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';

// ── Canonical key sets (sorted alphabetically) ────────────────────────────────

const BASE_KEYS = ['service', 'status', 'systemHealth'] as const;
const OK_KEYS = [...BASE_KEYS, 'ledgerOk'].sort();
const WARN_BRAIN_KEYS = [...BASE_KEYS, 'brainCircuitOpen'].sort();
const WARN_LEDGER_KEYS = [...BASE_KEYS, 'ledgerWarn'].sort();
const WARN_BOTH_KEYS = [...BASE_KEYS, 'brainCircuitOpen', 'ledgerWarn'].sort();
const DEGRADED_KEYS = [...BASE_KEYS, 'ledgerDlq'].sort();
const INTERNAL_ERROR_KEYS = ['error', 'service', 'status'].sort();
const SYSTEM_HEALTH_KEYS = ['brainDegraded', 'ledgerStatus', 'status'].sort();
const LEDGER_DLQ_KEYS = ['entryCount'];

// ── Test infrastructure ───────────────────────────────────────────────────────

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
  dlqPath: string;
}

async function startServer(): Promise<Started> {
  const dlqPath = join(tmpdir(), `ch1tty-fe-${process.pid}-${Date.now()}.dlq.jsonl`);
  const aggregator = new Aggregator([], { ledgerDlqPath: dlqPath, embedEnabled: false });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  return { server, aggregator, baseUrl: `http://127.0.0.1:${server.getPort()}`, dlqPath };
}

async function stop(s: Started): Promise<void> {
  await s.server.stop();
  await s.aggregator.shutdown();
  rmSync(s.dlqPath, { force: true });
}

type HealthState = { status: 'ok' | 'warn' | 'degraded'; brainDegraded: boolean; ledgerStatus: 'ok' | 'warn' | 'degraded' };

function patchSnapshot(s: Started, overrides: HealthState): void {
  const orig = s.aggregator.getStatusSnapshot.bind(s.aggregator);
  s.aggregator.getStatusSnapshot = () => ({ ...orig(), systemHealth: overrides });
}

async function fetchHealth(s: Started): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${s.baseUrl}/api/v1/health`);
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

// ── Exact key set freeze ──────────────────────────────────────────────────────

describe('FE: /api/v1/health exact response body key sets', () => {
  test('FE-1: ok + ledgerStatus:ok → exact 4 keys (adds ledgerOk)', async () => {
    const s = await startServer();
    try {
      patchSnapshot(s, { status: 'ok', brainDegraded: false, ledgerStatus: 'ok' });
      const { status, body } = await fetchHealth(s);
      assert.equal(status, 200, 'ok should return HTTP 200');
      assert.deepEqual(Object.keys(body).sort(), OK_KEYS, `ok body keys mismatch: got ${JSON.stringify(Object.keys(body).sort())}`);
    } finally { await stop(s); }
  });

  test('FE-2: warn + brainDegraded + ledgerStatus:ok → exact 4 keys (adds brainCircuitOpen)', async () => {
    const s = await startServer();
    try {
      patchSnapshot(s, { status: 'warn', brainDegraded: true, ledgerStatus: 'ok' });
      const { status, body } = await fetchHealth(s);
      assert.equal(status, 200, 'warn should return HTTP 200');
      assert.deepEqual(Object.keys(body).sort(), WARN_BRAIN_KEYS, `warn-brain body keys mismatch: got ${JSON.stringify(Object.keys(body).sort())}`);
    } finally { await stop(s); }
  });

  test('FE-3: warn + !brainDegraded + ledgerStatus:warn → exact 4 keys (adds ledgerWarn)', async () => {
    const s = await startServer();
    try {
      patchSnapshot(s, { status: 'warn', brainDegraded: false, ledgerStatus: 'warn' });
      const { status, body } = await fetchHealth(s);
      assert.equal(status, 200, 'warn should return HTTP 200');
      assert.deepEqual(Object.keys(body).sort(), WARN_LEDGER_KEYS, `warn-ledger body keys mismatch: got ${JSON.stringify(Object.keys(body).sort())}`);
    } finally { await stop(s); }
  });

  test('FE-4: warn + brainDegraded + ledgerStatus:warn → exact 5 keys (adds both brainCircuitOpen + ledgerWarn)', async () => {
    const s = await startServer();
    try {
      patchSnapshot(s, { status: 'warn', brainDegraded: true, ledgerStatus: 'warn' });
      const { status, body } = await fetchHealth(s);
      assert.equal(status, 200, 'warn should return HTTP 200');
      assert.deepEqual(Object.keys(body).sort(), WARN_BOTH_KEYS, `warn-both body keys mismatch: got ${JSON.stringify(Object.keys(body).sort())}`);
    } finally { await stop(s); }
  });

  test('FE-5: degraded → HTTP 503 + exact 4 keys (adds ledgerDlq)', async () => {
    const s = await startServer();
    try {
      patchSnapshot(s, { status: 'degraded', brainDegraded: false, ledgerStatus: 'degraded' });
      const { status, body } = await fetchHealth(s);
      assert.equal(status, 503, 'degraded should return HTTP 503');
      assert.deepEqual(Object.keys(body).sort(), DEGRADED_KEYS, `degraded body keys mismatch: got ${JSON.stringify(Object.keys(body).sort())}`);
    } finally { await stop(s); }
  });

  test('FE-6: internal error → HTTP 503 + exact 3 keys (error, service, status; no systemHealth)', async () => {
    const s = await startServer();
    try {
      s.aggregator.getStatusSnapshot = () => { throw new Error('snapshot failed'); };
      const { status, body } = await fetchHealth(s);
      assert.equal(status, 503, 'internal error should return HTTP 503');
      assert.deepEqual(Object.keys(body).sort(), INTERNAL_ERROR_KEYS, `internal-error body keys mismatch: got ${JSON.stringify(Object.keys(body).sort())}`);
    } finally { await stop(s); }
  });
});

// ── Sub-object key set freeze ─────────────────────────────────────────────────

describe('FE: systemHealth and ledgerDlq sub-object key sets', () => {
  test('FE-7: systemHealth has exactly 3 keys: {brainDegraded, ledgerStatus, status}', async () => {
    const s = await startServer();
    try {
      patchSnapshot(s, { status: 'ok', brainDegraded: false, ledgerStatus: 'ok' });
      const { body } = await fetchHealth(s);
      const sh = body.systemHealth as Record<string, unknown>;
      assert.ok(sh && typeof sh === 'object', 'systemHealth must be an object');
      assert.deepEqual(Object.keys(sh).sort(), SYSTEM_HEALTH_KEYS, `systemHealth keys mismatch: got ${JSON.stringify(Object.keys(sh).sort())}`);
    } finally { await stop(s); }
  });

  test('FE-8: ledgerDlq has exactly 1 key: {entryCount}', async () => {
    const s = await startServer();
    try {
      patchSnapshot(s, { status: 'degraded', brainDegraded: false, ledgerStatus: 'degraded' });
      const { body } = await fetchHealth(s);
      const dlq = body.ledgerDlq as Record<string, unknown>;
      assert.ok(dlq && typeof dlq === 'object', 'ledgerDlq must be an object');
      assert.deepEqual(Object.keys(dlq).sort(), LEDGER_DLQ_KEYS, `ledgerDlq keys mismatch: got ${JSON.stringify(Object.keys(dlq).sort())}`);
    } finally { await stop(s); }
  });
});

// ── Value types ───────────────────────────────────────────────────────────────

describe('FE: /api/v1/health response field value types', () => {
  test('FE-9: status is one of ok|warn|degraded (string); service is "ch1tty" (string); systemHealth is object', async () => {
    const s = await startServer();
    try {
      patchSnapshot(s, { status: 'ok', brainDegraded: false, ledgerStatus: 'ok' });
      const { body } = await fetchHealth(s);
      assert.ok(['ok', 'warn', 'degraded'].includes(body.status as string), `status must be ok|warn|degraded, got ${body.status}`);
      assert.equal(body.service, 'ch1tty', 'service must be exactly "ch1tty"');
      assert.ok(body.systemHealth && typeof body.systemHealth === 'object', 'systemHealth must be an object');
    } finally { await stop(s); }
  });

  test('FE-10: ledgerOk / brainCircuitOpen / ledgerWarn are exactly boolean true (not just truthy)', async () => {
    const s1 = await startServer();
    const s2 = await startServer();
    const s3 = await startServer();
    try {
      patchSnapshot(s1, { status: 'ok', brainDegraded: false, ledgerStatus: 'ok' });
      patchSnapshot(s2, { status: 'warn', brainDegraded: true, ledgerStatus: 'ok' });
      patchSnapshot(s3, { status: 'warn', brainDegraded: false, ledgerStatus: 'warn' });
      const [r1, r2, r3] = await Promise.all([fetchHealth(s1), fetchHealth(s2), fetchHealth(s3)]);
      assert.equal(r1.body.ledgerOk, true, 'ledgerOk must be exactly boolean true');
      assert.equal(r2.body.brainCircuitOpen, true, 'brainCircuitOpen must be exactly boolean true');
      assert.equal(r3.body.ledgerWarn, true, 'ledgerWarn must be exactly boolean true');
    } finally { await Promise.all([stop(s1), stop(s2), stop(s3)]); }
  });

  test('FE-11: ledgerDlq.entryCount is a non-negative integer', async () => {
    const s = await startServer();
    try {
      patchSnapshot(s, { status: 'degraded', brainDegraded: false, ledgerStatus: 'degraded' });
      const { body } = await fetchHealth(s);
      const dlq = body.ledgerDlq as Record<string, unknown>;
      assert.ok(typeof dlq.entryCount === 'number', 'ledgerDlq.entryCount must be a number');
      assert.ok(Number.isInteger(dlq.entryCount), 'ledgerDlq.entryCount must be an integer');
      assert.ok((dlq.entryCount as number) >= 0, 'ledgerDlq.entryCount must be non-negative');
    } finally { await stop(s); }
  });

  test('FE-12: error field on internal failure is a non-empty string', async () => {
    const s = await startServer();
    try {
      s.aggregator.getStatusSnapshot = () => { throw new Error('simulated internal error'); };
      const { body } = await fetchHealth(s);
      assert.ok(typeof body.error === 'string' && body.error.length > 0, `error must be a non-empty string, got ${JSON.stringify(body.error)}`);
    } finally { await stop(s); }
  });
});
