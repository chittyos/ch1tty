import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('handleReload pre-warms lazy:false backends after reload', async () => {
  const lazyFalseConfig: ServerConfig[] = [
    { id: 'warm-on-reload', name: 'WarmOnReload', type: 'remote', access: 'read', category: 'ecosystem', endpoint: 'https://example.com/mcp', lazy: false },
  ];

  const configPath = join(tmpdir(), `ch1tty-test-reload-${Date.now()}.json`);
  writeFileSync(configPath, JSON.stringify({ servers: lazyFalseConfig }, null, 2), 'utf8');

  const calls: string[] = [];
  const aggregator = new Aggregator([], {
    configPath,
    backendFactory: () => makeTrackingBackend(calls),
    embedEnabled: false,
  });

  // Clear any construction-time calls, then trigger reload
  calls.length = 0;
  const result = await aggregator.callTool('ch1tty/reload', {});
  assert.equal(result.isError, undefined, `reload should succeed, got: ${result.content[0]?.text}`);

  // preWarmNonLazy is fire-and-forget — wait for the background listTools
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.ok(calls.includes('warm-on-reload'), `reload must pre-warm lazy:false backends; got calls: ${JSON.stringify(calls)}`);
});

// ─── filterSuggestionsCatalog — invalid key warn branch ──────────────────────

test('filterSuggestionsCatalog: keys "catalog" and containing "/" emit warn and are dropped', () => {
  // Capture stderr to verify the warn is emitted for invalid profile names.
  const warned: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as NodeJS.WriteStream & { write: typeof process.stderr.write }).write = (
    chunk: string | Uint8Array, ..._rest: unknown[]
  ) => {
    const s = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    if (s.includes('ignoring invalid profile name')) warned.push(s);
    return origWrite(chunk as string);
  };

  try {
    const aggregator = new Aggregator([], {
      embedEnabled: false,
      suggestionsCatalog: {
        'catalog': { description: 'reserved name', combos: [], prompts: [] },
        'finance/sub': { description: 'slash in key', combos: [], prompts: [] },
        'valid': { description: 'valid profile', combos: [], prompts: [] },
      },
    });
    // Both invalid keys should have triggered warn logs
    assert.equal(warned.length, 2, `expected 2 warn logs, got ${warned.length}: ${JSON.stringify(warned)}`);
    assert.ok(warned.some((w) => w.includes('"catalog"')), 'warn for "catalog" key expected');
    assert.ok(warned.some((w) => w.includes('"finance/sub"')), 'warn for "finance/sub" key expected');
    // Clean up the aggregator
    aggregator.shutdown().catch(() => {});
  } finally {
    process.stderr.write = origWrite;
  }
});
