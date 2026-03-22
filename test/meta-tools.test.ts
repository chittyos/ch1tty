import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';

function createAggregator(): Aggregator {
  const config: ServerConfig[] = [
    { id: 'local', name: 'Local', type: 'local', access: 'readwrite', category: 'code', command: 'node' },
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
  assert.match(result.content[0].text, /Unknown meta-tool/);
});

test('listAllTools includes meta-tools', async () => {
  const aggregator = createAggregator();

  // Mock the managers to avoid real spawning
  const agg = aggregator as unknown as {
    childManager: { listTools: () => Promise<Array<{ name: string; description: string; inputSchema: object }>> };
    remoteProxy: { listTools: () => Promise<Array<{ name: string; description: string; inputSchema: object }>> };
  };
  agg.childManager = { listTools: async () => [] };
  agg.remoteProxy = { listTools: async () => [] };

  const { tools } = await aggregator.listAllTools();
  const metaNames = tools.filter((t) => t.name.startsWith('ch1tty/')).map((t) => t.name);

  assert.ok(metaNames.includes('ch1tty/status'));
  assert.ok(metaNames.includes('ch1tty/reload'));
});
