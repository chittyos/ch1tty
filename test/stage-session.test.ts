/**
 * stageSession integration tests.
 *
 * stageSession() fires in the background (fire-and-forget from onSessionStart).
 * These tests call onSessionStart, then poll isStagingComplete(), and assert
 * entity/memory state via getEntityContext() and getSnapshot().
 *
 * All tool calls are served by an in-process StubEcosystem — no network required.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Backend, BackendStatus, ContentItem, PromptEntry, ResourceEntry, ResourceTemplateEntry, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── Stub ecosystem backend ──────────────────────────────────────

type ToolHandler = (args: Record<string, unknown>) => unknown;

class StubEcosystem implements Backend {
  private handlers = new Map<string, ToolHandler>();

  setHandler(tool: string, handler: ToolHandler): void {
    this.handlers.set(tool, handler);
  }

  async callTool(_serverId: string, toolName: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    const h = this.handlers.get(toolName);
    if (!h) return { content: [{ type: 'text', text: 'null' }] };
    const result = await h(args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  registerServer(_config: ServerConfig): void {}
  isRegistered(_serverId: string): boolean { return true; }
  getStatus(_serverId: string): BackendStatus { return { connected: true, toolCount: 0, toolCacheAge: null }; }
  async listTools(_serverId: string): Promise<ToolEntry[]> { return []; }
  async listResources(_serverId: string): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> { return { resources: [], templates: [] }; }
  async readResource(_serverId: string, _uri: string): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }> { return { contents: [] }; }
  async listPrompts(_serverId: string): Promise<PromptEntry[]> { return []; }
  async getPrompt(_serverId: string, _name: string): Promise<{ description?: string; messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> { return { messages: [] }; }
  async shutdown(): Promise<void> {}
}

// ── Helpers ─────────────────────────────────────────────────────

async function waitForStaging(
  coord: { isStagingComplete(id: string): boolean },
  sessionId: string,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!coord.isStagingComplete(sessionId)) {
    if (Date.now() > deadline) throw new Error(`Staging did not complete within ${timeoutMs}ms`);
    await new Promise<void>((r) => setImmediate(r));
  }
}

// ── Tests ────────────────────────────────────────────────────────

describe('stageSession integration', () => {
  let SessionCoordinator: typeof import('../src/coordinator.js').SessionCoordinator;

  before(async () => {
    ({ SessionCoordinator } = await import('../src/coordinator.js'));
  });

  it('no ecosystem backend → stagingComplete=true immediately, no entity', async () => {
    const coord = new SessionCoordinator();
    await coord.onSessionStart('sess-no-ecosystem', 'http');
    await waitForStaging(coord, 'sess-no-ecosystem');

    assert.ok(coord.isStagingComplete('sess-no-ecosystem'), 'staging must be complete');
    assert.equal(coord.getEntityContext('sess-no-ecosystem'), undefined, 'no entity without ecosystem');
  });

  it('context_resolve returns chitty_id → entity populated on ctx', async () => {
    const coord = new SessionCoordinator();
    const stub = new StubEcosystem();

    stub.setHandler('context_resolve', () => ({
      chitty_id: 'user-abc',
      identity_class: 'developer',
      trust_level: 7,
      domain_trust: { code: 0.9 },
    }));
    stub.setHandler('chitty_memory_recall', () => ({ results: [] }));

    coord.bindEcosystem(stub, 'chittyos');
    await coord.onSessionStart('sess-resolved', 'http');
    await waitForStaging(coord, 'sess-resolved');

    const entity = coord.getEntityContext('sess-resolved');
    assert.ok(entity, 'entity should be populated');
    assert.equal(entity.chittyId, 'user-abc');
    assert.equal(entity.identityClass, 'developer');
    assert.equal(entity.trustLevel, 7);
    assert.deepEqual(entity.domainTrust, { code: 0.9 });
  });

  it('context_resolve returns no chitty_id → stagingComplete=true but no entity', async () => {
    const coord = new SessionCoordinator();
    const stub = new StubEcosystem();

    stub.setHandler('context_resolve', () => ({ status: 'unknown' }));

    coord.bindEcosystem(stub, 'chittyos');
    await coord.onSessionStart('sess-no-id', 'http');
    await waitForStaging(coord, 'sess-no-id');

    assert.ok(coord.isStagingComplete('sess-no-id'));
    assert.equal(coord.getEntityContext('sess-no-id'), undefined, 'no entity when chitty_id absent');
  });

  it('context_resolve + memory_recall → entity.recentMemories populated', async () => {
    const coord = new SessionCoordinator();
    const stub = new StubEcosystem();

    stub.setHandler('context_resolve', () => ({
      chitty_id: 'user-mem',
      identity_class: 'agent',
    }));

    let recallCall = 0;
    stub.setHandler('chitty_memory_recall', (args) => {
      recallCall++;
      if ((args as { query?: string }).query === 'recent session context') {
        return {
          results: [
            { content: 'Last session ended 2026-05-31' },
            { content: 'Worked on ch1tty cast tests' },
          ],
        };
      }
      return { results: [] };
    });

    coord.bindEcosystem(stub, 'chittyos');
    await coord.onSessionStart('sess-memories', 'http');
    await waitForStaging(coord, 'sess-memories');

    const entity = coord.getEntityContext('sess-memories');
    assert.ok(entity, 'entity should be set');
    assert.equal(entity.chittyId, 'user-mem');
    assert.ok(Array.isArray(entity.recentMemories), 'recentMemories should be array');
    assert.equal(entity.recentMemories?.length, 2);
    assert.equal(entity.recentMemories?.[0], 'Last session ended 2026-05-31');
    assert.equal(entity.recentMemories?.[1], 'Worked on ch1tty cast tests');
    assert.ok(recallCall >= 1, 'chitty_memory_recall should have been called');
  });

  it('context_resolve throws → graceful fallback, stagingComplete=true, no entity', async () => {
    const coord = new SessionCoordinator();
    const stub = new StubEcosystem();

    stub.setHandler('context_resolve', () => {
      throw new Error('ecosystem unavailable');
    });

    coord.bindEcosystem(stub, 'chittyos');
    await coord.onSessionStart('sess-throw', 'http');
    await waitForStaging(coord, 'sess-throw');

    assert.ok(coord.isStagingComplete('sess-throw'), 'staging must complete even on ecosystem error');
    assert.equal(coord.getEntityContext('sess-throw'), undefined, 'no entity on resolution failure');
  });

  it('full staging: context_resolve + both memory_recalls populate memories and workstreams', async () => {
    const coord = new SessionCoordinator();
    const stub = new StubEcosystem();

    stub.setHandler('context_resolve', () => ({
      chitty_id: 'user-full',
      identity_class: 'engineer',
      trust_level: 9,
    }));

    stub.setHandler('chitty_memory_recall', (args) => {
      const query = (args as { query?: string }).query;
      if (query === 'recent session context') {
        return { results: [{ content: 'memory-A' }, { content: 'memory-B' }] };
      }
      if (query === 'active workstreams') {
        return { results: [{ content: 'ws-1: complete Y tests' }, { content: 'ws-2: ship v4.2' }] };
      }
      return { results: [] };
    });

    coord.bindEcosystem(stub, 'chittyos');
    await coord.onSessionStart('sess-full', 'http');
    await waitForStaging(coord, 'sess-full');

    const entity = coord.getEntityContext('sess-full');
    assert.ok(entity, 'entity should be populated');
    assert.equal(entity.chittyId, 'user-full');
    assert.equal(entity.identityClass, 'engineer');
    assert.equal(entity.trustLevel, 9);

    assert.deepEqual(entity.recentMemories, ['memory-A', 'memory-B']);
    assert.deepEqual(entity.activeWorkstreams, ['ws-1: complete Y tests', 'ws-2: ship v4.2']);
  });

  it('getSnapshot() reflects staged entity and stagingComplete=true', async () => {
    const coord = new SessionCoordinator();
    const stub = new StubEcosystem();

    stub.setHandler('context_resolve', () => ({ chitty_id: 'snap-entity' }));
    stub.setHandler('chitty_memory_recall', () => ({ results: [] }));

    coord.bindEcosystem(stub, 'chittyos');
    await coord.onSessionStart('sess-snap', 'http');
    await waitForStaging(coord, 'sess-snap');

    const snap = coord.getSnapshot();
    assert.equal(snap.activeSessions, 1);
    assert.ok(snap.boundEntity, 'snapshot should show entity bound');
    const sessionSnap = snap.sessions.find((s) => s.sessionId === 'sess-snap');
    assert.ok(sessionSnap, 'session must appear in snapshot');
    assert.ok(sessionSnap.stagingComplete, 'stagingComplete must be true in snapshot');
    assert.equal(sessionSnap.entity, 'snap-entity');
  });

  it('getEntityContext for unknown sessionId returns undefined (safe no-op)', async () => {
    const coord = new SessionCoordinator();
    assert.equal(coord.getEntityContext('nonexistent-session'), undefined);
    assert.equal(coord.isStagingComplete('nonexistent-session'), false);
  });
});
