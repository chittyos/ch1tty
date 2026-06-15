/**
 * DDDDD: /api/v1/health 200 warn body includes brainCircuitOpen: true
 *
 * When systemHealth.status === 'warn' AND systemHealth.brainDegraded === true
 * (i.e. the Ollama or embedding brain circuit is open), the 200 response body
 * includes brainCircuitOpen: true so load-balancers can log/alert on it without
 * a separate /api/v1/status call.
 *
 * The field is ABSENT when:
 *   - status === 'ok' (no circuit open)
 *   - status === 'warn' but brainDegraded === false (ledger-only warn)
 *   - status === 'degraded' (503; ledgerDlq is the signal there)
 *   - internal snapshot failure (503; error: internal)
 *
 * Covered:
 *   DDDDD-1: warn + brainDegraded:true → brainCircuitOpen: true in 200 body
 *   DDDDD-2: ok status → brainCircuitOpen absent
 *   DDDDD-3: degraded status (503) → brainCircuitOpen absent
 *   DDDDD-4: warn + brainDegraded:false (ledger-only) → brainCircuitOpen absent
 *   DDDDD-5: internal snapshot error (503) → brainCircuitOpen absent
 *   DDDDD-6: brainCircuitOpen value is exactly boolean true (not just truthy)
 *   DDDDD-7: existing fields (status, service, systemHealth) still present in warn body
 *   DDDDD-8: HTTP status is still 200 when brainCircuitOpen: true (warn ≠ degraded)
 */

import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
  dlqPath: string;
}

async function startServer(): Promise<Started> {
  const dlqPath = join(tmpdir(), `ch1tty-ddddd-${process.pid}-${Date.now()}.dlq.jsonl`);
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

function patchSnapshot(
  s: Started,
  overrides: { status: 'ok' | 'warn' | 'degraded'; brainDegraded: boolean; ledgerStatus: 'ok' | 'warn' | 'degraded' },
): void {
  const orig = s.aggregator.getStatusSnapshot.bind(s.aggregator);
  s.aggregator.getStatusSnapshot = () => ({ ...orig(), systemHealth: overrides });
}

test('DDDDD-1: warn + brainDegraded:true → brainCircuitOpen: true in 200 body', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'warn', brainDegraded: true, ledgerStatus: 'ok' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 200, 'warn must return 200');
    const body = await res.json() as Record<string, unknown>;
    assert.ok('brainCircuitOpen' in body, 'brainCircuitOpen must be present in warn+brainDegraded body');
    assert.equal(body.brainCircuitOpen, true, 'brainCircuitOpen must be true');
  } finally {
    await stop(s);
  }
});

test('DDDDD-2: ok status → brainCircuitOpen absent', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'ok', brainDegraded: false, ledgerStatus: 'ok' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 200, 'ok must return 200');
    const body = await res.json() as Record<string, unknown>;
    assert.ok(!('brainCircuitOpen' in body), 'brainCircuitOpen must be absent when status is ok');
  } finally {
    await stop(s);
  }
});

test('DDDDD-3: degraded status (503) → brainCircuitOpen absent', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'degraded', brainDegraded: false, ledgerStatus: 'degraded' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 503, 'degraded must return 503');
    const body = await res.json() as Record<string, unknown>;
    assert.ok(!('brainCircuitOpen' in body), 'brainCircuitOpen must be absent on 503 degraded');
    assert.ok('ledgerDlq' in body, 'ledgerDlq should be present on 503 — unrelated to brainCircuitOpen');
  } finally {
    await stop(s);
  }
});

test('DDDDD-4: warn + brainDegraded:false (ledger-only warn) → brainCircuitOpen absent', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'warn', brainDegraded: false, ledgerStatus: 'warn' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 200, 'ledger-only warn must return 200');
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.status, 'warn', 'status must be warn');
    assert.ok(
      !('brainCircuitOpen' in body),
      'brainCircuitOpen must be absent when warn is due to ledger (not brain)',
    );
  } finally {
    await stop(s);
  }
});

test('DDDDD-5: internal snapshot error (503) → brainCircuitOpen absent', async () => {
  const s = await startServer();
  try {
    s.aggregator.getStatusSnapshot = () => { throw new Error('snapshot-fail'); };
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 503, 'internal error must return 503');
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.error, 'internal', 'error field must be "internal"');
    assert.ok(!('brainCircuitOpen' in body), 'brainCircuitOpen must be absent on internal error 503');
  } finally {
    await stop(s);
  }
});

test('DDDDD-6: brainCircuitOpen value is exactly boolean true (not just truthy)', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'warn', brainDegraded: true, ledgerStatus: 'ok' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    const body = await res.json() as { brainCircuitOpen: unknown };
    assert.strictEqual(body.brainCircuitOpen, true, 'brainCircuitOpen must be exactly boolean true');
    assert.equal(typeof body.brainCircuitOpen, 'boolean', 'brainCircuitOpen must be a boolean');
  } finally {
    await stop(s);
  }
});

test('DDDDD-7: existing fields (status, service, systemHealth) still present in warn+brain body', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'warn', brainDegraded: true, ledgerStatus: 'ok' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.status, 'warn', 'status must be warn');
    assert.equal(body.service, 'ch1tty', 'service must be ch1tty');
    assert.ok(body.systemHealth && typeof body.systemHealth === 'object', 'systemHealth must be present');
    assert.ok('brainCircuitOpen' in body, 'brainCircuitOpen must also be present');
  } finally {
    await stop(s);
  }
});

test('DDDDD-8: HTTP status is still 200 when brainCircuitOpen: true (warn ≠ degraded)', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'warn', brainDegraded: true, ledgerStatus: 'ok' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(
      res.status,
      200,
      'brain circuit open must NOT cause a 503 — keyword fallback is always available, warn is not degraded',
    );
  } finally {
    await stop(s);
  }
});
