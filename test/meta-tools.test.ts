import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';

function createAggregator(): Aggregator {
  const config: ServerConfig[] = [
    { id: 'local', name: 'Local', type: 'local', access: 'readwrite', category: 'code', command: 'ch1tty-test-no-such-server' },
    { id: 'remote', name: 'Remote', type: 'remote', access: 'read', category: 'search', endpoint: 'https://example.com/mcp' },
  ];
  return new Aggregator(config);
}

test('ch1tty/status returns gateway status JSON', async () => {
  const aggregator = createAggregator();
  const result = await aggregator.callTool('ch1tty/status');

  assert.equal(result.isError, undefined);
  const status = JSON.parse(result.content[0].text);
  assert.equal(status.gateway, 'ch1tty');
  assert.equal(typeof status.uptime, 'number');
  assert.equal(status.totalServers, 2);
  assert.equal(status.connectedServers, 0);
  assert.equal(status.servers.length, 2);
  assert.equal(status.servers[0].id, 'local');
  assert.equal(status.servers[1].id, 'remote');
});

test('ch1tty/status includes embeddingBrain circuit stats in coordinator snapshot', async () => {
  const aggregator = createAggregator();
  const result = await aggregator.callTool('ch1tty/status');

  const status = JSON.parse(result.content[0].text);
  const { coordinator } = status;
  assert.ok(coordinator, 'coordinator key present');
  assert.ok('embeddingBrain' in coordinator, 'embeddingBrain stats present in coordinator snapshot');
  assert.equal(typeof coordinator.embeddingBrain.circuitOpen, 'boolean');
  assert.equal(typeof coordinator.embeddingBrain.circuitCooldownRemainingMs, 'number');
  assert.equal(typeof coordinator.embeddingBrain.calls, 'number');
  // OllamaBrain stats also present (brain key) — circuit breaker parity with embeddingBrain
  assert.ok('brain' in coordinator, 'OllamaBrain stats present in coordinator snapshot');
  assert.equal(typeof coordinator.brain.calls, 'number');
  assert.equal(typeof coordinator.brain.circuitOpen, 'boolean');
  assert.equal(typeof coordinator.brain.circuitCooldownRemainingMs, 'number');
});

test('ch1tty/status includes top-level brainHealth summary', async () => {
  const aggregator = createAggregator();
  const result = await aggregator.callTool('ch1tty/status');

  const status = JSON.parse(result.content[0].text);
  assert.ok('brainHealth' in status, 'brainHealth key present at top level');
  const { brainHealth } = status;
  assert.ok(
    brainHealth.status === 'ok' || brainHealth.status === 'degraded',
    `brainHealth.status must be 'ok' or 'degraded', got: ${brainHealth.status}`,
  );
  assert.equal(typeof brainHealth.embeddingCircuitOpen, 'boolean');
  assert.equal(typeof brainHealth.ollamaCircuitOpen, 'boolean');
  // Neither brain circuit is open at startup — no backends contacted
  assert.equal(brainHealth.status, 'ok');
  assert.equal(brainHealth.embeddingCircuitOpen, false);
  assert.equal(brainHealth.ollamaCircuitOpen, false);
});

test('ch1tty/status includes top-level ledgerHealth summary', async () => {
  const aggregator = createAggregator();
  const result = await aggregator.callTool('ch1tty/status');

  const status = JSON.parse(result.content[0].text);
  assert.ok('ledgerHealth' in status, 'ledgerHealth key present at top level');
  const { ledgerHealth } = status;
  assert.ok(
    ledgerHealth.status === 'ok' || ledgerHealth.status === 'warn' || ledgerHealth.status === 'degraded',
    `ledgerHealth.status must be ok|warn|degraded, got: ${ledgerHealth.status}`,
  );
  assert.equal(typeof ledgerHealth.dropped, 'number');
  assert.equal(typeof ledgerHealth.buffered, 'number');
  assert.equal(typeof ledgerHealth.flushErrors, 'number');
  assert.equal(typeof ledgerHealth.dlqEntries, 'number');
  assert.equal(typeof ledgerHealth.dlqPath, 'string');
  // Clean startup: no entries dropped, no DLQ backlog
  assert.equal(ledgerHealth.status, 'ok');
  assert.equal(ledgerHealth.dropped, 0);
  assert.equal(ledgerHealth.dlqEntries, 0);
});

test('ch1tty/reload fails without configPath', async () => {
  const aggregator = createAggregator();
  const result = await aggregator.callTool('ch1tty/reload');

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /No config path/);
});

test('unknown meta-tool returns error', async () => {
  const aggregator = createAggregator();
  const result = await aggregator.callTool('ch1tty/nonexistent');

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Unknown tool: ch1tty\/nonexistent/);
});

test('listAllTools returns only the 5 slim-MCP meta-tools', async () => {
  const aggregator = createAggregator();
  const { tools } = await aggregator.listAllTools();
  const names = tools.map((t) => t.name);

  assert.deepEqual(names, [
    'ch1tty/search',
    'ch1tty/execute',
    'ch1tty/status',
    'ch1tty/reload',
    'ch1tty/cast',
  ]);
});

test('ch1tty/search with no filters returns server summary', async () => {
  const aggregator = createAggregator();
  const result = await aggregator.callTool('ch1tty/search', {});

  assert.equal(result.isError, undefined);
  const data = JSON.parse(result.content[0].text);
  assert.ok(data.servers);
  assert.ok(data.hint);
  assert.equal(data.servers.length, 2);
});
