/**
 * GE drift guard: freeze systemHealth sub-field VALUE TYPES in /api/v1/health.
 *
 * FE (fe-health-response-key-set-drift-guard.test.ts) froze the exact key set
 * for every health response variant (FE-7: {brainDegraded, ledgerStatus, status})
 * and verified top-level value types (FE-9: status is a string, service is
 * 'ch1tty', systemHealth is an object). DDDDD and EEEEE verified that conditional
 * top-level fields appear/absent under specific health states. None of these tests
 * freeze the VALUE TYPES and ENUM CONSTRAINTS of the systemHealth sub-fields.
 *
 * Specifically:
 *   - systemHealth.brainDegraded could change from boolean to 0/1 without
 *     failing FE-7 (key set) or FE-9 (top-level type check).
 *   - systemHealth.ledgerStatus could accept an unrecognised enum value
 *     (e.g. 'error', 'unknown') without any guard catching it.
 *   - systemHealth.status (nested field) could diverge from the canonical
 *     enum without detection, since FE-9 only validates the top-level status.
 *   - top-level status and systemHealth.status are never cross-checked for
 *     consistency — a refactor that copies one into the other independently
 *     could introduce subtle divergence.
 *
 * GE closes those gaps:
 *
 *   GE-1  systemHealth.brainDegraded is exactly boolean true when brain
 *          circuit open (not 1, not "true", not a truthy object)
 *   GE-2  systemHealth.brainDegraded is exactly boolean false when brain OK
 *   GE-3  systemHealth.ledgerStatus is exactly one of {'ok','warn','degraded'}
 *          — validated across all three ledger states
 *   GE-4  systemHealth.status (nested field) is exactly one of
 *          {'ok','warn','degraded'} — validated across all three health states
 *   GE-5  top-level body.status === systemHealth.status for all health states
 *          (consistency invariant — both derive from the same source value)
 *   GE-6  when systemHealth.status === 'ok', brainDegraded is exactly false
 *          AND ledgerStatus is exactly 'ok' (ok state invariant)
 *
 * Frozen 2026-09-20.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (health, not cast)
 */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';

// ── Test infrastructure (mirrors fe-health-response-key-set-drift-guard.test.ts) ──

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
  dlqPath: string;
}

type HealthState = {
  status: 'ok' | 'warn' | 'degraded';
  brainDegraded: boolean;
  ledgerStatus: 'ok' | 'warn' | 'degraded';
};

async function startServer(): Promise<Started> {
  const dlqPath = join(tmpdir(), `ch1tty-ge-${process.pid}-${Date.now()}.dlq.jsonl`);
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

function patchSnapshot(s: Started, overrides: HealthState): void {
  const orig = s.aggregator.getStatusSnapshot.bind(s.aggregator);
  s.aggregator.getStatusSnapshot = () => ({ ...orig(), systemHealth: overrides });
}

async function fetchHealth(s: Started): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const res = await fetch(`${s.baseUrl}/api/v1/health`);
  const body = (await res.json()) as Record<string, unknown>;
  return { statusCode: res.status, body };
}

const VALID_HEALTH_STATUSES = new Set<string>(['ok', 'warn', 'degraded']);

// ── GE-1: brainDegraded is exactly boolean true ───────────────────────────────

test('GE-1: systemHealth.brainDegraded is exactly boolean true when brain circuit open', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'warn', brainDegraded: true, ledgerStatus: 'ok' });
    const { body } = await fetchHealth(s);
    const sh = body.systemHealth as Record<string, unknown>;
    assert.equal(typeof sh.brainDegraded, 'boolean',
      `systemHealth.brainDegraded must be boolean, got ${typeof sh.brainDegraded}`);
    assert.equal(sh.brainDegraded, true,
      `systemHealth.brainDegraded must be exactly true, got ${JSON.stringify(sh.brainDegraded)}`);
  } finally {
    await stop(s);
  }
});

// ── GE-2: brainDegraded is exactly boolean false ──────────────────────────────

test('GE-2: systemHealth.brainDegraded is exactly boolean false when brain OK', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'ok', brainDegraded: false, ledgerStatus: 'ok' });
    const { body } = await fetchHealth(s);
    const sh = body.systemHealth as Record<string, unknown>;
    assert.equal(typeof sh.brainDegraded, 'boolean',
      `systemHealth.brainDegraded must be boolean, got ${typeof sh.brainDegraded}`);
    assert.equal(sh.brainDegraded, false,
      `systemHealth.brainDegraded must be exactly false, got ${JSON.stringify(sh.brainDegraded)}`);
  } finally {
    await stop(s);
  }
});

// ── GE-3: ledgerStatus is one of the canonical enum values ────────────────────

test('GE-3: systemHealth.ledgerStatus is exactly one of {"ok","warn","degraded"} across all ledger states', async () => {
  const cases: Array<{ state: HealthState; expectedLedger: string }> = [
    { state: { status: 'ok',       brainDegraded: false, ledgerStatus: 'ok' },       expectedLedger: 'ok' },
    { state: { status: 'warn',     brainDegraded: false, ledgerStatus: 'warn' },      expectedLedger: 'warn' },
    { state: { status: 'degraded', brainDegraded: false, ledgerStatus: 'degraded' },  expectedLedger: 'degraded' },
  ];
  await Promise.all(cases.map(async ({ state, expectedLedger }) => {
    const s = await startServer();
    try {
      patchSnapshot(s, state);
      const { body } = await fetchHealth(s);
      const sh = body.systemHealth as Record<string, unknown>;
      assert.equal(typeof sh.ledgerStatus, 'string',
        `systemHealth.ledgerStatus must be a string for ledgerStatus=${state.ledgerStatus}`);
      assert.ok(VALID_HEALTH_STATUSES.has(sh.ledgerStatus as string),
        `systemHealth.ledgerStatus must be one of {ok,warn,degraded}, got ${JSON.stringify(sh.ledgerStatus)}`);
      assert.equal(sh.ledgerStatus, expectedLedger,
        `systemHealth.ledgerStatus must equal the patched value '${expectedLedger}'`);
    } finally {
      await stop(s);
    }
  }));
});

// ── GE-4: systemHealth.status (nested) is one of the canonical enum values ────

test('GE-4: systemHealth.status (nested field) is exactly one of {"ok","warn","degraded"} across all health states', async () => {
  const cases: Array<{ state: HealthState }> = [
    { state: { status: 'ok',       brainDegraded: false, ledgerStatus: 'ok' } },
    { state: { status: 'warn',     brainDegraded: true,  ledgerStatus: 'ok' } },
    { state: { status: 'warn',     brainDegraded: false, ledgerStatus: 'warn' } },
    { state: { status: 'degraded', brainDegraded: false, ledgerStatus: 'degraded' } },
  ];
  await Promise.all(cases.map(async ({ state }) => {
    const s = await startServer();
    try {
      patchSnapshot(s, state);
      const { body } = await fetchHealth(s);
      const sh = body.systemHealth as Record<string, unknown>;
      assert.equal(typeof sh.status, 'string',
        `systemHealth.status must be a string for health state '${state.status}'`);
      assert.ok(VALID_HEALTH_STATUSES.has(sh.status as string),
        `systemHealth.status must be one of {ok,warn,degraded}, got ${JSON.stringify(sh.status)}`);
      assert.equal(sh.status, state.status,
        `systemHealth.status must equal the patched value '${state.status}'`);
    } finally {
      await stop(s);
    }
  }));
});

// ── GE-5: top-level status equals systemHealth.status ────────────────────────

test('GE-5: top-level body.status equals systemHealth.status for all health states', async () => {
  const states: HealthState[] = [
    { status: 'ok',   brainDegraded: false, ledgerStatus: 'ok' },
    { status: 'warn', brainDegraded: true,  ledgerStatus: 'ok' },
    { status: 'warn', brainDegraded: false, ledgerStatus: 'warn' },
  ];
  await Promise.all(states.map(async (state) => {
    const s = await startServer();
    try {
      patchSnapshot(s, state);
      const { body } = await fetchHealth(s);
      const sh = body.systemHealth as Record<string, unknown>;
      assert.equal(body.status, sh.status,
        `top-level status (${JSON.stringify(body.status)}) must equal systemHealth.status (${JSON.stringify(sh.status)})`);
    } finally {
      await stop(s);
    }
  }));
});

// ── GE-6: ok state invariant ──────────────────────────────────────────────────

test('GE-6: when systemHealth.status is "ok", brainDegraded is false and ledgerStatus is "ok"', async () => {
  const s = await startServer();
  try {
    patchSnapshot(s, { status: 'ok', brainDegraded: false, ledgerStatus: 'ok' });
    const { body } = await fetchHealth(s);
    const sh = body.systemHealth as Record<string, unknown>;
    assert.equal(sh.status, 'ok',
      `systemHealth.status must be 'ok' in the ok state`);
    assert.equal(sh.brainDegraded, false,
      `systemHealth.brainDegraded must be false when status is 'ok', got ${JSON.stringify(sh.brainDegraded)}`);
    assert.equal(sh.ledgerStatus, 'ok',
      `systemHealth.ledgerStatus must be 'ok' when status is 'ok', got ${JSON.stringify(sh.ledgerStatus)}`);
  } finally {
    await stop(s);
  }
});
