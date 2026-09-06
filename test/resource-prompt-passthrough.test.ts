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
    suggestionsCatalog: {},
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
    { backendFactory: () => fixture, embedEnabled: false, suggestionsCatalog: {} },
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
    { backendFactory: flakyFactory, embedEnabled: false, suggestionsCatalog: {} },
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

// ── First-party ch1tty suggestion resources ──────────────────────────────────

const minimalCatalog = {
  finance: {
    description: 'Finance tools',
    combos: [{ name: 'invoice-tracker', chain: ['stripe/list_invoices', 'notion/API-post-page'], accomplishes: 'Track invoices', verified: false }],
    prompts: [{ text: 'List unpaid invoices', resolves_to: 'stripe/list_invoices' }],
  },
  code: {
    description: 'Code tools',
    combos: [{ name: 'pr-review', chain: ['github/list_pull_requests'], accomplishes: 'Review PRs', verified: true }],
    prompts: [{ text: 'Show open PRs', resolves_to: 'github/list_pull_requests' }],
  },
};

test('listAllResources: suggestion resources appear before backend resources when catalog loaded', async () => {
  const fixture = new ResourceFixture([{ uri: 'docs', name: 'Docs' }]);
  const agg = new Aggregator([cfg('notion', 'Notion')], {
    backendFactory: () => fixture,
    embedEnabled: false,
    suggestionsCatalog: minimalCatalog,
  });
  try {
    const { resources } = await agg.listAllResources();
    // 1 catalog index + 2 profiles + 1 backend = 4 total
    assert.equal(resources.length, 4);
    assert.equal(resources[0].uri, 'ch1tty://suggestions/catalog');
    assert.equal(resources[0].mimeType, 'application/json');
    assert.match(resources[1].uri, /^ch1tty:\/\/suggestions\//);
    assert.match(resources[2].uri, /^ch1tty:\/\/suggestions\//);
    assert.equal(resources[3].uri, 'notion://docs');
  } finally {
    await agg.shutdown();
  }
});

test('listAllResources: no suggestion resources when catalog is empty', async () => {
  const fixture = new ResourceFixture([{ uri: 'x', name: 'X' }]);
  const agg = new Aggregator([cfg('svc', 'Service')], {
    backendFactory: () => fixture,
    embedEnabled: false,
    suggestionsCatalog: {},
  });
  try {
    const { resources } = await agg.listAllResources();
    assert.equal(resources.length, 1);
    assert.equal(resources[0].uri, 'svc://x');
  } finally {
    await agg.shutdown();
  }
});

test('readResource: ch1tty://suggestions/catalog returns index JSON', async () => {
  const agg = new Aggregator([], {
    embedEnabled: false,
    suggestionsCatalog: minimalCatalog,
  });
  try {
    const result = await agg.readResource('ch1tty://suggestions/catalog');
    assert.equal(result.contents.length, 1);
    const content = result.contents[0];
    assert.equal(content.uri, 'ch1tty://suggestions/catalog');
    assert.equal(content.mimeType, 'application/json');
    const parsed = JSON.parse(content.text ?? '');
    assert.ok('profiles' in parsed);
    assert.ok('finance' in parsed.profiles);
    assert.ok('code' in parsed.profiles);
    assert.equal(parsed.profiles.finance.combos, 1);
    assert.equal(parsed.profiles.code.prompts, 1);
  } finally {
    await agg.shutdown();
  }
});

test('readResource: ch1tty://suggestions/{profile} returns full profile JSON', async () => {
  const agg = new Aggregator([], {
    embedEnabled: false,
    suggestionsCatalog: minimalCatalog,
  });
  try {
    const result = await agg.readResource('ch1tty://suggestions/finance');
    assert.equal(result.contents.length, 1);
    const content = result.contents[0];
    assert.equal(content.mimeType, 'application/json');
    const parsed = JSON.parse(content.text ?? '');
    assert.ok('combos' in parsed && Array.isArray(parsed.combos));
    assert.equal(parsed.combos[0].name, 'invoice-tracker');
    assert.ok('prompts' in parsed && Array.isArray(parsed.prompts));
  } finally {
    await agg.shutdown();
  }
});

test('readResource: ch1tty://suggestions/{unknown} throws on missing profile', async () => {
  const agg = new Aggregator([], {
    embedEnabled: false,
    suggestionsCatalog: minimalCatalog,
  });
  try {
    await assert.rejects(
      () => agg.readResource('ch1tty://suggestions/nonexistent'),
      /No suggestions profile "nonexistent"/,
    );
  } finally {
    await agg.shutdown();
  }
});

test('readResource: ch1tty:// with unknown path throws', async () => {
  const agg = new Aggregator([], {
    embedEnabled: false,
    suggestionsCatalog: minimalCatalog,
  });
  try {
    await assert.rejects(
      () => agg.readResource('ch1tty://unknown/path/here'),
      /Unknown ch1tty resource path/,
    );
  } finally {
    await agg.shutdown();
  }
});

test('readResource: ch1tty:// does not dispatch to backend even when a ch1tty-named server exists', async () => {
  // Confirms that the ch1tty:// prefix is intercepted before backend lookup.
  // A server with id "ch1tty" is registered; its readResource returns text/plain.
  // The local suggestions handler must win, returning application/json.
  const fixture = new ResourceFixture([{ uri: 'suggestions/catalog', name: 'Backend catalog' }]);
  const agg = new Aggregator([cfg('ch1tty', 'Conflicting backend')], {
    backendFactory: () => fixture,
    embedEnabled: false,
    suggestionsCatalog: minimalCatalog,
  });
  try {
    const result = await agg.readResource('ch1tty://suggestions/catalog');
    assert.equal(result.contents[0].mimeType, 'application/json');
  } finally {
    await agg.shutdown();
  }
});
