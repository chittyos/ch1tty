import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig } from '../src/types.js';

function makeTrackingBackend(
  listToolsCalls: string[],
  opts?: { shouldError?: boolean },
): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: false, toolCount: 0, toolCacheAge: null }),
    listTools: async (serverId) => {
      listToolsCalls.push(serverId);
      if (opts?.shouldError) throw new Error('connection refused');
      return [];
    },
    callTool: async () => ({ content: [] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

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

test('preWarmNonLazy calls listTools only for lazy:false backends', async () => {
  const calls: string[] = [];
  const configs: ServerConfig[] = [
    { id: 'eager', name: 'Eager', type: 'remote', access: 'read', category: 'ecosystem', endpoint: 'https://example.com/mcp', lazy: false },
    { id: 'default-lazy', name: 'DefaultLazy', type: 'remote', access: 'read', category: 'code', endpoint: 'https://example.com/mcp' },
    { id: 'explicit-lazy', name: 'ExplicitLazy', type: 'remote', access: 'read', category: 'code', endpoint: 'https://example.com/mcp', lazy: true },
  ];

  const aggregator = new Aggregator(configs, {
    backendFactory: () => makeTrackingBackend(calls),
    embedEnabled: false,
  });

  aggregator.preWarmNonLazy();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.deepEqual(calls, ['eager'], 'only the lazy:false backend should be pre-warmed');
});

test('preWarmNonLazy swallows listTools errors without crashing', async () => {
  let callCount = 0;
  const configs: ServerConfig[] = [
    { id: 'failing', name: 'Failing', type: 'remote', access: 'read', category: 'ecosystem', endpoint: 'https://example.com/mcp', lazy: false },
  ];

  const aggregator = new Aggregator(configs, {
    backendFactory: () => makeTrackingBackend([], { shouldError: true }),
    embedEnabled: false,
  });

  // Must not throw
  aggregator.preWarmNonLazy();
  await new Promise((resolve) => setTimeout(resolve, 20));
  callCount++;

  assert.equal(callCount, 1, 'preWarmNonLazy must not throw even when backends error');
});
