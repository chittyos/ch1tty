/**
 * OOOOO: /api/v1/health 200 ok body includes ledgerOk: true
 *
 * When systemHealth.status === 'ok' AND systemHealth.ledgerStatus === 'ok'
 * (ledger fully clean — no drops, buffered entries, flushErrors, or DLQ backlog),
 * the 200 response body includes ledgerOk: true. Symmetric to ledgerWarn: true
 * (which appears on warn status + ledgerStatus:warn).
 *
 * The field is ABSENT when:
 *   - status === 'warn' (even if ledgerStatus happens to be 'ok')
 *   - status === 'degraded' (503)
 *   - internal snapshot failure (503; error: internal)
 *
 * ledgerOk and ledgerWarn can never coexist: ledgerOk requires status:ok,
 * ledgerWarn requires status:warn.
 *
 * Covered:
 *   OOOOO-1: ok + ledgerStatus:ok → ledgerOk: true in 200 body
 *   OOOOO-2: warn + ledgerStatus:warn → ledgerOk absent (not ok status)
 *   OOOOO-3: degraded status (503) → ledgerOk absent
 *   OOOOO-4: warn + brainDegraded + ledgerStatus:ok → ledgerOk absent (not ok status)
 *   OOOOO-5: internal snapshot error (503) → ledgerOk absent
 *   OOOOO-6: ledgerOk value is exactly boolean true (not just truthy)
 *   OOOOO-7: existing fields (status, service, systemHealth) still present alongside ledgerOk
 *   OOOOO-8: ledgerWarn and ledgerOk never coexist in the same response
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
  const dlqPath = join(tmpdir(), `ch1tty-ooooo-${process.pid}-${Date.now()}.dlq.jsonl`);
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

test('OOOOO-1: ok + ledgerStatus:ok → ledgerOk: true in 200 body', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'ok', brainDegraded: false, ledgerStatus: 'ok' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 200, 'ok must return 200');
    const body = await res.json() as Record<string, unknown>;
    assert.ok('ledgerOk' in body, 'ledgerOk must be present when status=ok + ledgerStatus=ok');
    assert.equal(body.ledgerOk, true, 'ledgerOk must be true');
  } finally {
    await stop(s);
  }
});

test('OOOOO-2: warn + ledgerStatus:warn → ledgerOk absent (not ok status)', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'warn', brainDegraded: false, ledgerStatus: 'warn' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 200, 'warn must return 200');
    const body = await res.json() as Record<string, unknown>;
    assert.ok(!('ledgerOk' in body), 'ledgerOk must be absent when status is warn');
  } finally {
    await stop(s);
  }
});

test('OOOOO-3: degraded status (503) → ledgerOk absent', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'degraded', brainDegraded: false, ledgerStatus: 'degraded' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 503, 'degraded must return 503');
    const body = await res.json() as Record<string, unknown>;
    assert.ok(!('ledgerOk' in body), 'ledgerOk must be absent on 503 degraded');
  } finally {
    await stop(s);
  }
});

test('OOOOO-4: warn + brainDegraded + ledgerStatus:ok → ledgerOk absent (not ok status)', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'warn', brainDegraded: true, ledgerStatus: 'ok' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 200, 'brain-only warn must return 200');
    const body = await res.json() as Record<string, unknown>;
    assert.ok(!('ledgerOk' in body), 'ledgerOk must be absent when status is warn (even with ledgerStatus:ok)');
    assert.ok('brainCircuitOpen' in body, 'brainCircuitOpen should be present in brain-warn body');
  } finally {
    await stop(s);
  }
});

test('OOOOO-5: internal snapshot error (503) → ledgerOk absent', async () => {
  const s = await startServer();
  try {
    s.aggregator.getStatusSnapshot = () => { throw new Error('snapshot failed'); };
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 503, 'internal error must return 503');
    const body = await res.json() as Record<string, unknown>;
    assert.ok(!('ledgerOk' in body), 'ledgerOk must be absent on internal error');
    assert.equal(body.error, 'internal', 'error body must include error: internal');
  } finally {
    await stop(s);
  }
});

test('OOOOO-6: ledgerOk value is exactly boolean true (not just truthy)', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'ok', brainDegraded: false, ledgerStatus: 'ok' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.strictEqual(body.ledgerOk, true, 'ledgerOk must be exactly boolean true');
  } finally {
    await stop(s);
  }
});

test('OOOOO-7: existing fields present alongside ledgerOk', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'ok', brainDegraded: false, ledgerStatus: 'ok' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.ok('status' in body, 'status field must be present');
    assert.ok('service' in body, 'service field must be present');
    assert.ok('systemHealth' in body, 'systemHealth field must be present');
    assert.equal(body.status, 'ok', 'status must be ok');
    assert.equal(body.service, 'ch1tty', 'service must be ch1tty');
    assert.ok('ledgerOk' in body, 'ledgerOk must also be present');
  } finally {
    await stop(s);
  }
});

test('OOOOO-8: ledgerWarn and ledgerOk never coexist', async () => {
  // ledgerOk requires status:ok; ledgerWarn requires status:warn.
  // Test both: ok body has ledgerOk but not ledgerWarn; warn body has ledgerWarn but not ledgerOk.
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'ok', brainDegraded: false, ledgerStatus: 'ok' });
    const okRes = await fetch(`${s.baseUrl}/api/v1/health`);
    const okBody = await okRes.json() as Record<string, unknown>;
    assert.ok('ledgerOk' in okBody, 'ok body must have ledgerOk');
    assert.ok(!('ledgerWarn' in okBody), 'ok body must not have ledgerWarn');

    patchSnapshot(s, { status: 'warn', brainDegraded: false, ledgerStatus: 'warn' });
    const warnRes = await fetch(`${s.baseUrl}/api/v1/health`);
    const warnBody = await warnRes.json() as Record<string, unknown>;
    assert.ok('ledgerWarn' in warnBody, 'warn body must have ledgerWarn');
    assert.ok(!('ledgerOk' in warnBody), 'warn body must not have ledgerOk');
  } finally {
    await stop(s);
  }
});
