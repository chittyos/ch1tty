import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';

function createAggregator(): Aggregator {
  const config: ServerConfig[] = [
    { id: 'local', name: 'Local', type: 'local', access: 'read', category: 'code', command: 'node' },
    { id: 'remote', name: 'Remote', type: 'remote', access: 'read', category: 'ecosystem', endpoint: 'https://example.com/mcp' },
  ];
  return new Aggregator(config);
}

test('callTool rejects malformed tool names', async () => {
  const aggregator = createAggregator();
  const result = await aggregator.callTool('malformed-name');

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Invalid tool name/);
  assert.match(result.content[0].text, /ch1tty\/search/);
});

test('callTool rejects non-ch1tty namespaced calls (slim-mcp enforces search+execute)', async () => {
  const aggregator = createAggregator();
  const result = await aggregator.callTool('unknown/tool');

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Use ch1tty\/search to discover tools/);
});

test('ch1tty/execute returns error for unknown server', async () => {
  const aggregator = createAggregator();
  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'unknown/tool',
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Unknown server "unknown"/);
});


test('ch1tty/execute requires tool argument', async () => {
  const aggregator = createAggregator();
  const result = await aggregator.callTool('ch1tty/execute', {});

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Missing required "tool" argument/);
});
