/**
 * EEEEE: /api/v1/health 200 warn body includes ledgerWarn: true
 *
 * When systemHealth.status === 'warn' AND systemHealth.ledgerStatus === 'warn'
 * (drops, buffered entries, or flushErrors present but no DLQ backlog), the
 * 200 response body includes ledgerWarn: true so callers can distinguish a
 * ledger-warn from a brain-circuit-open warn without a separate /api/v1/status call.
 *
 * The field is ABSENT when:
 *   - status === 'ok' (all systems clean)
 *   - status === 'warn' but ledgerStatus === 'ok' (brain-only warn)
 *   - status === 'degraded' (503; ledgerDlq.entryCount is the signal there)
 *   - internal snapshot failure (503; error: internal)
 *
 * Both ledgerWarn and brainCircuitOpen may appear together in the same warn body
 * when both conditions hold simultaneously.
 *
 * Covered:
 *   EEEEE-1: warn + ledgerStatus:warn → ledgerWarn: true in 200 body
 *   EEEEE-2: ok status → ledgerWarn absent
 *   EEEEE-3: degraded status (503) → ledgerWarn absent
 *   EEEEE-4: warn + brainDegraded + ledgerStatus:ok → ledgerWarn absent (brain-only warn)
 *   EEEEE-5: internal snapshot error (503) → ledgerWarn absent
 *   EEEEE-6: ledgerWarn value is exactly boolean true (not just truthy)
 *   EEEEE-7: existing fields (status, service, systemHealth) still present alongside ledgerWarn
 *   EEEEE-8: both ledgerWarn and brainCircuitOpen present when both conditions hold
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
  const dlqPath = join(tmpdir(), `ch1tty-eeeee-${process.pid}-${Date.now()}.dlq.jsonl`);
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

test('EEEEE-1: warn + ledgerStatus:warn → ledgerWarn: true in 200 body', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'warn', brainDegraded: false, ledgerStatus: 'warn' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 200, 'ledger-only warn must return 200');
    const body = await res.json() as Record<string, unknown>;
    assert.ok('ledgerWarn' in body, 'ledgerWarn must be present when status=warn + ledgerStatus=warn');
    assert.equal(body.ledgerWarn, true, 'ledgerWarn must be true');
  } finally {
    await stop(s);
  }
});

test('EEEEE-2: ok status → ledgerWarn absent', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'ok', brainDegraded: false, ledgerStatus: 'ok' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 200, 'ok must return 200');
    const body = await res.json() as Record<string, unknown>;
    assert.ok(!('ledgerWarn' in body), 'ledgerWarn must be absent when status is ok');
  } finally {
    await stop(s);
  }
});

test('EEEEE-3: degraded status (503) → ledgerWarn absent', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'degraded', brainDegraded: false, ledgerStatus: 'degraded' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 503, 'degraded must return 503');
    const body = await res.json() as Record<string, unknown>;
    assert.ok(!('ledgerWarn' in body), 'ledgerWarn must be absent on 503 degraded');
    assert.ok('ledgerDlq' in body, 'ledgerDlq should be present on 503 — unrelated to ledgerWarn');
  } finally {
    await stop(s);
  }
});

test('EEEEE-4: warn + brainDegraded + ledgerStatus:ok → ledgerWarn absent (brain-only warn)', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'warn', brainDegraded: true, ledgerStatus: 'ok' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 200, 'brain-only warn must return 200');
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.status, 'warn', 'status must be warn');
    assert.ok(!('ledgerWarn' in body), 'ledgerWarn must be absent when warn is brain-only');
    assert.ok('brainCircuitOpen' in body, 'brainCircuitOpen should be present (brain-only warn)');
  } finally {
    await stop(s);
  }
});

test('EEEEE-5: internal snapshot error (503) → ledgerWarn absent', async () => {
  const s = await startServer();
  try {
    s.aggregator.getStatusSnapshot = () => { throw new Error('snapshot-fail'); };
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 503, 'internal error must return 503');
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.error, 'internal', 'error field must be "internal"');
    assert.ok(!('ledgerWarn' in body), 'ledgerWarn must be absent on internal error 503');
  } finally {
    await stop(s);
  }
});

test('EEEEE-6: ledgerWarn value is exactly boolean true (not just truthy)', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'warn', brainDegraded: false, ledgerStatus: 'warn' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    const body = await res.json() as { ledgerWarn: unknown };
    assert.strictEqual(body.ledgerWarn, true, 'ledgerWarn must be exactly boolean true');
    assert.equal(typeof body.ledgerWarn, 'boolean', 'ledgerWarn must be a boolean');
  } finally {
    await stop(s);
  }
});

test('EEEEE-7: existing fields (status, service, systemHealth) still present alongside ledgerWarn', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'warn', brainDegraded: false, ledgerStatus: 'warn' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.status, 'warn', 'status must be warn');
    assert.equal(body.service, 'ch1tty', 'service must be ch1tty');
    assert.ok(body.systemHealth && typeof body.systemHealth === 'object', 'systemHealth must be present');
    assert.ok('ledgerWarn' in body, 'ledgerWarn must also be present');
  } finally {
    await stop(s);
  }
});

test('EEEEE-8: both ledgerWarn and brainCircuitOpen present when both conditions hold', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'warn', brainDegraded: true, ledgerStatus: 'warn' });
    const res = await fetch(`${s.baseUrl}/api/v1/health`);
    assert.equal(res.status, 200, 'dual-warn must still return 200');
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.status, 'warn', 'status must be warn');
    assert.ok('brainCircuitOpen' in body, 'brainCircuitOpen must be present');
    assert.equal(body.brainCircuitOpen, true);
    assert.ok('ledgerWarn' in body, 'ledgerWarn must be present');
    assert.equal(body.ledgerWarn, true);
  } finally {
    await stop(s);
  }
});
