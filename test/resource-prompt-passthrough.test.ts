/**
 * AA. Resource + Prompt passthrough tests
 *
 * Covers: listAllResources, listAllResourceTemplates, readResource,
 * listAllPrompts, getPrompt — the namespace-prefixing + routing layer
 * in Aggregator (aggregator.ts:1027–1148). Zero prior dedicated coverage.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type {
  Backend,
  BackendStatus,
  ContentItem,
  PromptEntry,
  ResourceEntry,
  ResourceTemplateEntry,
  ServerConfig,
  ToolCallResult,
  ToolEntry,
} from '../src/types.js';

/** Minimal backend with configurable resources, templates, and prompts. */
class ResourceFixture implements Backend {
  constructor(
    private readonly _resources: ResourceEntry[] = [],
    private readonly _templates: ResourceTemplateEntry[] = [],
    private readonly _prompts: PromptEntry[] = [],
  ) {}

  registerServer(_c: ServerConfig): void {}
  isRegistered(_id: string): boolean { return true; }
  getStatus(_id: string): BackendStatus { return { connected: true, toolCount: 0, toolCacheAge: null }; }
  async listTools(): Promise<ToolEntry[]> { return []; }
  async callTool(): Promise<ToolCallResult> { return { content: [{ type: 'text', text: 'ok' }] }; }

  async listResources(): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> {
    return { resources: this._resources, templates: this._templates };
  }

  async readResource(
    _serverId: string,
    uri: string,
  ): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string }> }> {
    return { contents: [{ uri, mimeType: 'text/plain', text: `content for ${uri}` }] };
  }

  async listPrompts(): Promise<PromptEntry[]> { return this._prompts; }

  async getPrompt(
    _serverId: string,
    name: string,
  ): Promise<{ description?: string; messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> {
    return {
      description: `Fixture: ${name}`,
      messages: [{ role: 'user', content: { type: 'text', text: name } }],
    };
  }

  async shutdown(): Promise<void> {}
}

function cfg(id: string, name: string): ServerConfig {
  return {
    id,
    name,
    type: 'remote' as const,
    access: 'read' as const,
    category: 'search' as const,
    endpoint: `https://${id}.invalid/mcp`,
  };
}

// ── listAllResources ─────────────────────────────────────────────────────────

test('listAllResources: URI prefixed with serverId:// and name with [ServerName]', async () => {
  const fixture = new ResourceFixture([
    { uri: 'workspace/docs', name: 'Docs', description: 'All docs', mimeType: 'text/plain' },
  ]);
  const agg = new Aggregator([cfg('notion', 'Notion')], {
    backendFactory: () => fixture,
    embedEnabled: false,
  });
  try {
    const { resources } = await agg.listAllResources();
    assert.equal(resources.length, 1);
    assert.equal(resources[0].uri, 'notion://workspace/docs');
    assert.equal(resources[0].name, '[Notion] Docs');
    assert.equal(resources[0].description, 'All docs');
    assert.equal(resources[0].mimeType, 'text/plain');
  } finally {
    await agg.shutdown();
  }
});

test('listAllResources: multiple servers are aggregated, each prefixed with its own id', async () => {
  const fixture = new ResourceFixture([{ uri: 'data', name: 'Data' }]);
  const agg = new Aggregator(
    [cfg('svrA', 'Server A'), cfg('svrB', 'Server B')],
    { backendFactory: () => fixture, embedEnabled: false },
  );
  try {
    const { resources } = await agg.listAllResources();
    assert.equal(resources.length, 2);
    const uris = resources.map((r) => r.uri);
    assert.ok(uris.includes('svrA://data'), `expected svrA://data in ${JSON.stringify(uris)}`);
    assert.ok(uris.includes('svrB://data'), `expected svrB://data in ${JSON.stringify(uris)}`);
  } finally {
    await agg.shutdown();
  }
});

test('listAllResources: per-backend error is swallowed; remaining servers still returned', async () => {
  const flakyFactory = (config: ServerConfig): Backend => {
    if (config.id === 'failing') {
      return {
        registerServer() {},
        isRegistered: () => true,
        getStatus: () => ({ connected: false, toolCount: 0, toolCacheAge: null }),
        listTools: async () => [],
        callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: '' }] }),
        listResources: async () => { throw new Error('network error'); },
        readResource: async () => ({ contents: [] }),
        listPrompts: async () => [],
        getPrompt: async (): Promise<{ messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> => ({ messages: [] }),
        shutdown: async () => {},
      };
    }
    return new ResourceFixture([{ uri: 'ok', name: 'OK Resource' }]);
  };
  const agg = new Aggregator(
    [cfg('failing', 'Failing'), cfg('good', 'Good')],
    { backendFactory: flakyFactory, embedEnabled: false },
  );
  try {
    const { resources } = await agg.listAllResources();
    assert.equal(resources.length, 1, 'failing server returns empty; good server contributes 1');
    assert.equal(resources[0].uri, 'good://ok');
  } finally {
    await agg.shutdown();
  }
});

// ── listAllResourceTemplates ─────────────────────────────────────────────────

test('listAllResourceTemplates: uriTemplates prefixed with serverId://', async () => {
  const fixture = new ResourceFixture(
    [],
    [{ uriTemplate: 'files/{path}', name: 'File Template', description: 'Any file', mimeType: 'text/plain' }],
  );
  const agg = new Aggregator([cfg('fs', 'FileSystem')], {
    backendFactory: () => fixture,
    embedEnabled: false,
  });
  try {
    const { resourceTemplates } = await agg.listAllResourceTemplates();
    assert.equal(resourceTemplates.length, 1);
    assert.equal(resourceTemplates[0].uriTemplate, 'fs://files/{path}');
    assert.equal(resourceTemplates[0].name, '[FileSystem] File Template');
    assert.equal(resourceTemplates[0].description, 'Any file');
  } finally {
    await agg.shutdown();
  }
});

// ── readResource ─────────────────────────────────────────────────────────────

test('readResource: strips serverId:// prefix and routes bare URI to backend', async () => {
  const fixture = new ResourceFixture([{ uri: 'workspace', name: 'WS' }]);
  const agg = new Aggregator([cfg('notion', 'Notion')], {
    backendFactory: () => fixture,
    embedEnabled: false,
  });
  try {
    const result = await agg.readResource('notion://workspace');
    assert.equal(result.contents.length, 1);
    // Backend receives the URI WITHOUT the serverId:// prefix
    assert.equal(result.contents[0].uri, 'workspace');
    assert.match(result.contents[0].text ?? '', /workspace/);
  } finally {
    await agg.shutdown();
  }
});

test('readResource: throws on URI without :// separator', async () => {
  const agg = new Aggregator([], { embedEnabled: false });
  try {
    await assert.rejects(
      () => agg.readResource('invalid-no-separator'),
      /Invalid namespaced resource URI/,
    );
  } finally {
    await agg.shutdown();
  }
});

test('readResource: throws when serverId from URI is not a registered server', async () => {
  const agg = new Aggregator([], { embedEnabled: false });
  try {
    await assert.rejects(
      () => agg.readResource('unknown://some/path'),
      /Unknown server/,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── listAllPrompts ───────────────────────────────────────────────────────────

test('listAllPrompts: names prefixed with serverId/ and descriptions with [ServerName]', async () => {
  const fixture = new ResourceFixture([], [], [
    { name: 'query-helper', description: 'SQL query guide' },
  ]);
  const agg = new Aggregator([cfg('neon', 'Neon PSQL')], {
    backendFactory: () => fixture,
    embedEnabled: false,
  });
  try {
    const { prompts } = await agg.listAllPrompts();
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].name, 'neon/query-helper');
    assert.equal(prompts[0].description, '[Neon PSQL] SQL query guide');
  } finally {
    await agg.shutdown();
  }
});

test('listAllPrompts: falls back to prompt name when description is absent', async () => {
  const fixture = new ResourceFixture([], [], [{ name: 'my-prompt' }]);
  const agg = new Aggregator([cfg('alpha', 'Alpha')], {
    backendFactory: () => fixture,
    embedEnabled: false,
  });
  try {
    const { prompts } = await agg.listAllPrompts();
    assert.equal(prompts[0].description, '[Alpha] my-prompt');
  } finally {
    await agg.shutdown();
  }
});

// ── getPrompt ────────────────────────────────────────────────────────────────

test('getPrompt: routes by serverId/ prefix, passes bare name to backend', async () => {
  const fixture = new ResourceFixture([], [], [{ name: 'query-helper', description: 'guide' }]);
  const agg = new Aggregator([cfg('neon', 'Neon PSQL')], {
    backendFactory: () => fixture,
    embedEnabled: false,
  });
  try {
    const result = await agg.getPrompt('neon/query-helper');
    assert.ok(result.messages.length > 0);
    // Fixture echoes the bare prompt name (without serverId/) in the message text
    assert.equal((result.messages[0].content as { type: string; text: string }).text, 'query-helper');
  } finally {
    await agg.shutdown();
  }
});

test('getPrompt: prompt name with slashes splits only on first / (serverId is prefix up to first /)', async () => {
  const fixture = new ResourceFixture([], [], [{ name: 'path/to/prompt', description: 'nested' }]);
  const agg = new Aggregator([cfg('svc', 'Service')], {
    backendFactory: () => fixture,
    embedEnabled: false,
  });
  try {
    const result = await agg.getPrompt('svc/path/to/prompt');
    // Fixture echoes back what it received as promptName
    assert.equal((result.messages[0].content as { type: string; text: string }).text, 'path/to/prompt');
  } finally {
    await agg.shutdown();
  }
});

test('getPrompt: throws on name without / separator', async () => {
  const agg = new Aggregator([], { embedEnabled: false });
  try {
    await assert.rejects(
      () => agg.getPrompt('invalidname'),
      /Invalid prompt name/,
    );
  } finally {
    await agg.shutdown();
  }
});

test('getPrompt: throws when serverId from name is not a registered server', async () => {
  const agg = new Aggregator([], { embedEnabled: false });
  try {
    await assert.rejects(
      () => agg.getPrompt('unknown/prompt'),
      /Unknown server/,
    );
  } finally {
    await agg.shutdown();
  }
});
