/**
 * Z: ch1tty/status short: true — condensed snapshot
 *
 * When short: true, the response omits the servers list and coordinator.sessions
 * while preserving all health fields, counts, focus, and catalog stats.
 */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';

const DLQ = join(tmpdir(), `ch1tty-test-short-status-${process.pid}.dlq.jsonl`);

after(() => { rmSync(DLQ, { force: true }); });

function makeAgg(): Aggregator {
  const servers: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.example.com/mcp' },
    { id: 'stripe', name: 'Stripe', type: 'remote', access: 'read', category: 'ecosystem', endpoint: 'https://stripe.example.com/mcp' },
  ];
  return new Aggregator(servers, { ledgerDlqPath: DLQ });
}

test('status short: true → servers field absent', async () => {
  const agg = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/status', { short: true });
    const snap = JSON.parse(result.content[0].text);
    assert.equal('servers' in snap, false, 'servers array must be omitted');
  } finally {
    await agg.shutdown();
  }
});

test('status short: true → coordinator.sessions absent', async () => {
  const agg = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/status', { short: true });
    const snap = JSON.parse(result.content[0].text);
    assert.ok('coordinator' in snap, 'coordinator block still present');
    assert.equal('sessions' in snap.coordinator, false, 'coordinator.sessions must be omitted');
  } finally {
    await agg.shutdown();
  }
});

test('status short omitted → servers field present', async () => {
  const agg = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/status', {});
    const snap = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(snap.servers), 'servers array present by default');
  } finally {
    await agg.shutdown();
  }
});

test('status short: false → servers field present', async () => {
  const agg = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/status', { short: false });
    const snap = JSON.parse(result.content[0].text);
    assert.ok(Array.isArray(snap.servers), 'servers array present when short: false');
    assert.ok(Array.isArray(snap.coordinator.sessions), 'coordinator.sessions present when short: false');
  } finally {
    await agg.shutdown();
  }
});

test('status short: true → health fields preserved', async () => {
  const agg = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/status', { short: true });
    const snap = JSON.parse(result.content[0].text);
    assert.ok('systemHealth' in snap, 'systemHealth present');
    assert.ok('brainHealth' in snap, 'brainHealth present');
    assert.ok('ledgerHealth' in snap, 'ledgerHealth present');
    assert.ok(['ok', 'warn', 'degraded'].includes(snap.systemHealth.status), 'systemHealth.status valid');
  } finally {
    await agg.shutdown();
  }
});

test('status short: true → coordinator.activeSessions count preserved', async () => {
  const agg = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/status', { short: true });
    const snap = JSON.parse(result.content[0].text);
    assert.equal(typeof snap.coordinator.activeSessions, 'number', 'activeSessions count present');
  } finally {
    await agg.shutdown();
  }
});

test('status short: true → top-level identity and count fields preserved', async () => {
  const agg = makeAgg();
  try {
    const result = await agg.callTool('ch1tty/status', { short: true });
    const snap = JSON.parse(result.content[0].text);
    assert.equal(snap.gateway, 'ch1tty');
    assert.equal(typeof snap.uptime, 'number');
    assert.equal(snap.totalServers, 2);
    assert.equal(typeof snap.connectedServers, 'number');
  } finally {
    await agg.shutdown();
  }
});
