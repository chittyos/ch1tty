/**
 * Tests for the registry-reset invariant of rebuildBackends().
 *
 * Every successful reload calls rebuildBackends(), which sets registryExpiresAt=0
 * and clears the cached registry. The next search MUST re-fetch tools from the
 * updated backend set — not serve a stale snapshot. Five invariants under test:
 *   1. registryExpiresAt is 0 immediately after a successful reload.
 *   2. First search after reload triggers a new listTools call (cache miss enforced).
 *   3. New server's tools are immediately visible after reload.
 *   4. Removed server's tools are not visible after reload.
 *   5. Failed reload leaves registryExpiresAt intact (cache stays valid on error).
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import type {
  Backend,
  BackendStatus,
  ContentItem,
  PromptEntry,
  ResourceEntry,
  ResourceTemplateEntry,
  ServerConfig,
  ServersConfig,
  ToolCallResult,
  ToolEntry,
} from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Test-isolation helpers ────────────────────────────────────────────────────

const testDirs: string[] = [];
after(() => {
  for (const dir of testDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempFiles(): { configPath: string; dlqPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-reload-reg-'));
  testDirs.push(dir);
  return { configPath: join(dir, 'servers.json'), dlqPath: join(dir, 'ledger.dlq.jsonl') };
}

function writeConfig(path: string, servers: ServerConfig[]): void {
  const cfg: ServersConfig = { servers };
  writeFileSync(path, JSON.stringify(cfg), 'utf8');
}

function makeServerConfig(id: string): ServerConfig {
  return { id, name: id, type: 'remote', access: 'readwrite', category: 'code', endpoint: `https://fixture.test/${id}` };
}

function makeTool(name: string, description: string) {
  return { name, description, inputSchema: {}, response: { content: [{ type: 'text' as const, text: 'ok' }] } };
}

// ── CountingBackend ───────────────────────────────────────────────────────────

/** Wraps a FixtureBackend and counts every listTools() invocation. */
class CountingBackend implements Backend {
  listToolsCalls = 0;
  constructor(private readonly inner: FixtureBackend) {}
  registerServer(c: ServerConfig): void { this.inner.registerServer(c); }
  isRegistered(id: string): boolean { return this.inner.isRegistered(id); }
  getStatus(id: string): BackendStatus { return this.inner.getStatus(id); }
  async listTools(id: string): Promise<ToolEntry[]> {
    this.listToolsCalls++;
    return this.inner.listTools(id);
  }
  async callTool(id: string, name: string, args?: Record<string, unknown>): Promise<ToolCallResult> {
    return this.inner.callTool(id, name, args);
  }
  async listResources(id: string): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> {
    return this.inner.listResources(id);
  }
  async readResource(id: string, uri: string): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }> {
    return this.inner.readResource(id, uri);
  }
  async listPrompts(id: string): Promise<PromptEntry[]> { return this.inner.listPrompts(id); }
  async getPrompt(id: string, name: string, args?: Record<string, string>): Promise<{ description?: string; messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> {
    return this.inner.getPrompt(id, name, args);
  }
  async shutdown(): Promise<void> { return this.inner.shutdown(); }
}

// ── Private-field accessors ───────────────────────────────────────────────────

function expiresAt(agg: Aggregator): number {
  return (agg as unknown as { registryExpiresAt: number }).registryExpiresAt;
}

async function searchTools(agg: Aggregator, query: string): Promise<string[]> {
  const r = await agg.callTool('ch1tty/search', { query });
  const body = JSON.parse((r.content[0] as { text: string }).text) as {
    tools?: Array<{ tool: string }>;
  };
  return (body.tools ?? []).map((t) => t.tool);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('registryExpiresAt is 0 immediately after successful reload', async () => {
  const { configPath, dlqPath } = tempFiles();
  const servers = [makeServerConfig('alpha')];
  writeConfig(configPath, servers);

  const fb = new FixtureBackend();
  fb.defineServer('alpha', { tools: [makeTool('alpha_tool', 'An alpha tool')] });
  const cb = new CountingBackend(fb);

  const agg = new Aggregator(servers, {
    configPath,
    ledgerDlqPath: dlqPath,
    backendFactory: () => cb,
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    embedEnabled: false,
  });

  try {
    // Prime the registry — expiresAt should be well in the future
    await searchTools(agg, 'alpha');
    assert.ok(expiresAt(agg) > Date.now(), 'registry cached after first search');

    // Reload resets it to 0
    await agg.callTool('ch1tty/reload');
    assert.equal(expiresAt(agg), 0, 'reload must zero registryExpiresAt');
  } finally {
    await agg.shutdown();
  }
});

test('first search after reload triggers a new listTools call', async () => {
  const { configPath, dlqPath } = tempFiles();
  const servers = [makeServerConfig('alpha')];
  writeConfig(configPath, servers);

  const fb = new FixtureBackend();
  fb.defineServer('alpha', { tools: [makeTool('alpha_tool', 'An alpha tool')] });
  const cb = new CountingBackend(fb);

  const agg = new Aggregator(servers, {
    configPath,
    ledgerDlqPath: dlqPath,
    backendFactory: () => cb,
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    embedEnabled: false,
  });

  try {
    // Prime the cache
    await searchTools(agg, 'alpha');
    assert.equal(cb.listToolsCalls, 1, 'one fetch for priming');

    // Second search should be cached — no new fetch
    await searchTools(agg, 'alpha');
    assert.equal(cb.listToolsCalls, 1, 'no fetch within TTL');

    // Reload invalidates registry
    await agg.callTool('ch1tty/reload');

    // Next search MUST trigger a re-fetch
    await searchTools(agg, 'alpha');
    assert.equal(cb.listToolsCalls, 2, 'reload must force re-fetch on next search');
  } finally {
    await agg.shutdown();
  }
});

test('new server tools immediately visible after reload', async () => {
  const { configPath, dlqPath } = tempFiles();
  const initial = [makeServerConfig('alpha')];
  writeConfig(configPath, initial);

  const fb = new FixtureBackend();
  fb.defineServer('alpha', { tools: [makeTool('alpha_tool', 'An alpha tool')] });
  const cb = new CountingBackend(fb);

  const agg = new Aggregator(initial, {
    configPath,
    ledgerDlqPath: dlqPath,
    backendFactory: () => cb,
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    embedEnabled: false,
  });

  try {
    // Prime the registry — beta_tool must NOT be visible before reload
    const before = await searchTools(agg, 'beta_tool');
    assert.ok(!before.some((t) => t.includes('beta_tool')), 'beta_tool not visible before server added');

    // Add server 'beta' to both the config file and the fixture backend
    fb.defineServer('beta', { tools: [makeTool('beta_tool', 'A beta tool')] });
    writeConfig(configPath, [makeServerConfig('alpha'), makeServerConfig('beta')]);

    await agg.callTool('ch1tty/reload');

    // Immediately after reload, beta_tool must be visible (registry was cleared)
    const after = await searchTools(agg, 'beta_tool');
    assert.ok(after.some((t) => t.includes('beta_tool')), 'beta_tool must be visible immediately after reload');
  } finally {
    await agg.shutdown();
  }
});

test('removed server tools not visible after reload', async () => {
  const { configPath, dlqPath } = tempFiles();
  const initial = [makeServerConfig('alpha'), makeServerConfig('beta')];
  writeConfig(configPath, initial);

  const fb = new FixtureBackend();
  fb.defineServer('alpha', { tools: [makeTool('alpha_tool', 'An alpha tool')] });
  fb.defineServer('beta', { tools: [makeTool('beta_tool', 'A beta tool')] });
  const cb = new CountingBackend(fb);

  const agg = new Aggregator(initial, {
    configPath,
    ledgerDlqPath: dlqPath,
    backendFactory: () => cb,
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    embedEnabled: false,
  });

  try {
    // Prime registry — both tools visible
    const before = await searchTools(agg, 'beta_tool');
    assert.ok(before.some((t) => t.includes('beta_tool')), 'beta_tool visible before removal');

    // Remove server 'beta' from config
    writeConfig(configPath, [makeServerConfig('alpha')]);
    await agg.callTool('ch1tty/reload');

    // beta_tool must NOT be visible after reload removes the server
    const after = await searchTools(agg, 'beta_tool');
    assert.ok(!after.some((t) => t.includes('beta_tool')), 'beta_tool must not be visible after server removed');
  } finally {
    await agg.shutdown();
  }
});

test('failed reload leaves registryExpiresAt intact', async () => {
  const { configPath, dlqPath } = tempFiles();
  const servers = [makeServerConfig('alpha')];
  writeConfig(configPath, servers);

  const fb = new FixtureBackend();
  fb.defineServer('alpha', { tools: [makeTool('alpha_tool', 'An alpha tool')] });
  const cb = new CountingBackend(fb);

  const agg = new Aggregator(servers, {
    configPath,
    ledgerDlqPath: dlqPath,
    backendFactory: () => cb,
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    embedEnabled: false,
  });

  try {
    // Prime the registry
    await searchTools(agg, 'alpha');
    const cachedAt = expiresAt(agg);
    assert.ok(cachedAt > Date.now(), 'registry is cached before failed reload');

    // Write bad JSON — reload must fail
    writeFileSync(configPath, '{ not valid json }', 'utf8');
    const result = await agg.callTool('ch1tty/reload');
    assert.equal(result.isError, true, 'reload must return isError on bad config');

    // registryExpiresAt must remain unchanged (failed reload does NOT call rebuildBackends)
    assert.equal(expiresAt(agg), cachedAt, 'failed reload must not alter registryExpiresAt');

    // Registry still usable — no additional listTools call should be needed
    const countBefore = cb.listToolsCalls;
    const tools = await searchTools(agg, 'alpha');
    assert.equal(cb.listToolsCalls, countBefore, 'cached registry still usable after failed reload');
    assert.ok(tools.some((t) => t.includes('alpha_tool')), 'alpha_tool still visible after failed reload');
  } finally {
    await agg.shutdown();
  }
});
