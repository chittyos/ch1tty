import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';

function createAggregator(): Aggregator {
  const config: ServerConfig[] = [
    { id: 'local', name: 'Local', type: 'local', command: 'node' },
    { id: 'remote', name: 'Remote', type: 'remote', endpoint: 'https://example.com/mcp' },
  ];
  return new Aggregator(config);
}

test('callTool rejects malformed namespaced tool names with known server ids', async () => {
  const aggregator = createAggregator();
  const result = await aggregator.callTool('malformed-name');

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Expected format: serverId\/toolName/);
  assert.match(result.content[0].text, /Known servers: local, remote/);
});

test('callTool reports unknown server with known server ids', async () => {
  const aggregator = createAggregator();
  const result = await aggregator.callTool('unknown/tool');

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Unknown server "unknown"/);
  assert.match(result.content[0].text, /Known servers: local, remote/);
});

test('callTool normalizes local backend exceptions into MCP error shape', async () => {
  const aggregator = createAggregator() as unknown as {
    callTool: Aggregator['callTool'];
    childManager: {
      isRegistered: (serverId: string) => boolean;
      callTool: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<never>;
    };
    remoteProxy: {
      isRegistered: (serverId: string) => boolean;
      callTool: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<unknown>;
    };
  };

  aggregator.childManager = {
    isRegistered: (serverId) => serverId === 'local',
    callTool: async () => {
      throw new Error('child boom');
    },
  };
  aggregator.remoteProxy = {
    isRegistered: () => false,
    callTool: async () => ({ content: [] }),
  };

  const result = await aggregator.callTool('local/run', { foo: 'bar' });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Tool call failed for local\/run/);
  assert.match(result.content[0].text, /child boom/);
});

test('callTool normalizes remote backend exceptions into MCP error shape', async () => {
  const aggregator = createAggregator() as unknown as {
    callTool: Aggregator['callTool'];
    childManager: {
      isRegistered: (serverId: string) => boolean;
      callTool: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<unknown>;
    };
    remoteProxy: {
      isRegistered: (serverId: string) => boolean;
      callTool: (serverId: string, toolName: string, args: Record<string, unknown>) => Promise<never>;
    };
  };

  aggregator.childManager = {
    isRegistered: () => false,
    callTool: async () => ({ content: [] }),
  };
  aggregator.remoteProxy = {
    isRegistered: (serverId) => serverId === 'remote',
    callTool: async () => {
      throw new Error('remote boom');
    },
  };

  const result = await aggregator.callTool('remote/run', { foo: 'bar' });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Tool call failed for remote\/run/);
  assert.match(result.content[0].text, /remote boom/);
});
