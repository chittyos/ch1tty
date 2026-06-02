/**
 * GGG: six previously untested branches across ledger.ts, coordinator.ts,
 *      aggregator.ts, and embedding-brain.ts.
 *
 * 1. ledger.ts flush() concurrent guard (line 180): when this.flushing is
 *    already true, flush() returns 0 immediately without calling the backend.
 *
 * 2. ledger.ts record() batch dedup (lines 132–137): when a tool_call arrives
 *    for a tool already in the current tool_call_batch within the coalesce
 *    window, the duplicate entry is silently dropped and the tools list stays
 *    deduplicated.
 *
 * 3. coordinator.ts parseResult non-text content (lines 364–366): when
 *    content[0].type is not 'text' (e.g. 'image'), parseResult returns null →
 *    stageSession treats the context_resolve response as unresolved, leaving
 *    entity undefined.
 *
 * 4. aggregator.ts handleSearch entity context in no-filter path (lines
 *    434–435): when no query, server, or category filter is supplied but the
 *    session has a resolved entity (chittyId truthy), the server-summary
 *    response includes entity + identityClass fields.
 *
 * 5. ledger.ts shutdown() DLQ path with backend bound (lines 280–285): when
 *    the backend consistently fails, flushAll() exits on count=0 (entry
 *    requeued with retries < MAX_RETRIES), leaving entries in the buffer;
 *    shutdown then writes them to the DLQ.
 *
 * 6. embedding-brain.ts embed() individual malformed vector (lines 335–338):
 *    when a per-candidate embedding in the returned array is not an array
 *    (a scalar, null, etc.), embed() increments errors and returns null,
 *    which propagates to route() → null.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
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
import { LedgerClient, type LedgerEntry } from '../src/ledger.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { Aggregator } from '../src/aggregator.js';
import { EmbeddingBrain } from '../src/embedding-brain.js';
import type { ToolCandidate } from '../src/ollama-brain.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

let _ctr = 0;
function tempDlq(): { dlqPath: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `ch1tty-ggg-${process.pid}-${++_ctr}-`));
  const dlqPath = join(dir, 'ledger.dlq.jsonl');
  return { dlqPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function makeBackend(
  callToolFn: (svcId: string, tool: string, args: Record<string, unknown>) => Promise<ToolCallResult>,
): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: 0, toolCacheAge: null }),
    listTools: async (): Promise<ToolEntry[]> => [],
    callTool: callToolFn,
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

// Minimal ecosystem stub for coordinator staging tests
class StubEcosystem implements Backend {
  private handlers = new Map<string, (args: Record<string, unknown>) => unknown>();

  setHandler(tool: string, handler: (args: Record<string, unknown>) => unknown): void {
    this.handlers.set(tool, handler);
  }

  async callTool(_svcId: string, toolName: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
    const h = this.handlers.get(toolName);
    if (!h) return { content: [{ type: 'text', text: 'null' }] };
    const result = await h(args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }

  registerServer(_c: ServerConfig): void {}
  isRegistered(): boolean { return true; }
  getStatus(): BackendStatus { return { connected: true, toolCount: 0, toolCacheAge: null }; }
  async listTools(): Promise<ToolEntry[]> { return []; }
  async listResources(): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> {
    return { resources: [], templates: [] };
  }
  async readResource(): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }> {
    return { contents: [] };
  }
  async listPrompts(): Promise<PromptEntry[]> { return []; }
  async getPrompt(): Promise<{ description?: string; messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> {
    return { messages: [] };
  }
  async shutdown(): Promise<void> {}
}

async function waitForStaging(
  coord: { isStagingComplete(id: string): boolean },
  sessionId: string,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!coord.isStagingComplete(sessionId)) {
    if (Date.now() > deadline) throw new Error(`Staging did not complete within ${timeoutMs}ms for ${sessionId}`);
    await new Promise<void>((r) => setImmediate(r));
  }
}

// ── 1. flush() concurrent guard ───────────────────────────────────────────────

test('flush: this.flushing already true → returns 0 immediately without calling backend', async () => {
  const { dlqPath, cleanup } = tempDlq();
  try {
    const calls: string[] = [];
    const backend = makeBackend(async (_svcId, tool) => {
      calls.push(tool);
      return { content: [{ type: 'text', text: 'ok' }] as ContentItem[], isError: false };
    });

    const client = new LedgerClient(dlqPath);
    client.record('sess', 'session_start', {});
    client.bind(backend, 'ledger-svc');

    // Force flushing=true to simulate a concurrent flush already in progress
    (client as unknown as { flushing: boolean }).flushing = true;

    const result = await client.flush();

    assert.equal(result, 0, 'flush() must return 0 when already flushing');
    assert.equal(calls.length, 0, 'no backend calls when concurrent guard is active');

    // Reset so shutdown can proceed cleanly
    (client as unknown as { flushing: boolean }).flushing = false;
    await client.shutdown();
  } finally {
    cleanup();
  }
});

// ── 2. record() batch dedup ───────────────────────────────────────────────────

test('record: duplicate tool in tool_call_batch is silently dropped — tools list stays deduplicated', () => {
  const { dlqPath, cleanup } = tempDlq();
  try {
    const client = new LedgerClient(dlqPath);

    // Two different rapid tool_calls → upgrades first entry to tool_call_batch of 2
    client.record('sess', 'tool_call', { tool: 'neon/run_sql' });
    client.record('sess', 'tool_call', { tool: 'github/search_code' });

    // Third call with a tool already in the batch → must be a no-op (duplicate guard)
    client.record('sess', 'tool_call', { tool: 'neon/run_sql' });

    const buf = (client as unknown as { buffer: LedgerEntry[] }).buffer;
    assert.equal(buf.length, 1, 'buffer still has exactly 1 entry after duplicate tool_call');
    assert.equal(buf[0]!.event_type, 'tool_call_batch', 'entry was upgraded to tool_call_batch');
    const tools = buf[0]!.metadata.tools as string[];
    assert.equal(tools.length, 2, 'tools array has 2 unique entries despite 3 calls');
    assert.ok(tools.includes('neon/run_sql'), 'neon/run_sql is present');
    assert.ok(tools.includes('github/search_code'), 'github/search_code is present');
  } finally {
    cleanup();
  }
});

// ── 3. coordinator.ts parseResult non-text content ────────────────────────────

test('parseResult: context_resolve returns image content → entity remains unresolved (null parse path)', async () => {
  const { dlqPath, cleanup } = tempDlq();
  try {
    const coord = new SessionCoordinator({}, { enabled: false }, dlqPath);

    // Backend that returns image content for context_resolve — hits text.type !== 'text' branch
    const rawEco = makeBackend(async (_svcId, toolName) => {
      if (toolName === 'context_resolve') {
        return {
          content: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }] as unknown as ContentItem[],
          isError: false,
        };
      }
      return { content: [{ type: 'text', text: 'null' }] };
    });

    coord.bindEcosystem(rawEco, 'eco-svc');

    const sid = 'ggg-parseresult-nontext';
    await coord.onSessionStart(sid, 'http');
    await waitForStaging(coord, sid);

    assert.equal(
      coord.getEntityContext(sid),
      undefined,
      'entity must be undefined when context_resolve returns non-text content (parseResult → null)',
    );
    assert.ok(coord.isStagingComplete(sid), 'staging must complete despite non-text response');
  } finally {
    cleanup();
  }
});

// ── 4. handleSearch entity context in no-filter path ─────────────────────────

test('handleSearch no-filter: entity.chittyId truthy → entity + identityClass in server-summary response', async () => {
  const { dlqPath, cleanup } = tempDlq();
  try {
    // Pre-wired coordinator — staging resolves entity before aggregator search
    const coord = new SessionCoordinator({}, { enabled: false }, dlqPath);

    const eco = new StubEcosystem();
    eco.setHandler('context_resolve', () => ({
      chitty_id: 'nick@chitty.cc',
      identity_class: 'founder',
    }));
    eco.setHandler('chitty_memory_recall', () => ({ results: [] }));

    // A fixture backend used for the aggregator's registered server (no ecosystem category
    // → rebuildBackends will not call bindEcosystem, so our manual bind below is authoritative)
    const fixtureBackend: Backend = {
      ...makeBackend(async () => ({ content: [{ type: 'text', text: '{}' }] })),
      listTools: async (): Promise<ToolEntry[]> => [
        { name: 'run_sql', description: 'Execute SQL on Neon', inputSchema: { type: 'object' } },
      ],
    };

    const serverCfg: ServerConfig = {
      id: 'neon',
      name: 'Neon DB',
      type: 'remote',
      access: 'readwrite',
      category: 'code',
      endpoint: 'https://neon.test/mcp',
    };

    const agg = new Aggregator([serverCfg], {
      coordinator: coord,
      backendFactory: () => fixtureBackend,
      ledgerDlqPath: dlqPath,
      focusProfiles: { profiles: {} },
    });

    // Bind ecosystem AFTER aggregator construction (no ecosystem-category server → no auto-bind)
    coord.bindEcosystem(eco, 'eco-svc');

    const sid = 'ggg-entity-search';
    agg.sessions.getOrCreate(sid, 'http');
    await coord.onSessionStart(sid, 'http');
    await waitForStaging(coord, sid);

    const entity = coord.getEntityContext(sid);
    assert.equal(entity?.chittyId, 'nick@chitty.cc', 'entity must be resolved before calling search');

    // Call with no query/server/category → server-summary path in handleSearch
    const result = await agg.callTool('ch1tty/search', {}, sid);
    assert.equal(result.isError, undefined, 'search must not return isError');
    const data = JSON.parse((result.content[0] as { text: string }).text) as {
      entity?: string;
      identityClass?: string;
      hint?: string;
      servers?: unknown[];
    };
    assert.equal(data.entity, 'nick@chitty.cc', 'entity field must appear in no-filter server-summary response');
    assert.equal(data.identityClass, 'founder', 'identityClass field must appear in no-filter server-summary response');
    assert.ok(Array.isArray(data.servers), 'servers array still present alongside entity context');
  } finally {
    cleanup();
  }
});

// ── 5. ledger shutdown() DLQ path with backend bound ─────────────────────────

test('shutdown: backend bound but all flush attempts fail → buffer written to DLQ by shutdown drain', async () => {
  const { dlqPath, cleanup } = tempDlq();
  try {
    // Backend always throws — flush() always returns 0 (entry requeued with retries < MAX_RETRIES)
    // → flushAll breaks on count=0 → shutdown sees buffer.length > 0 → DLQ write (lines 280–285)
    const alwaysFailBackend = makeBackend(async () => {
      throw new Error('backend always fails');
    });

    const client = new LedgerClient(dlqPath);
    client.record('sess', 'session_start', {});
    client.bind(alwaysFailBackend, 'ledger-svc');

    await client.shutdown();

    const stats = client.getStats();
    assert.equal(stats.buffered, 0, 'buffer must be cleared after shutdown DLQ drain');
    assert.ok(existsSync(dlqPath), 'DLQ file must be created by shutdown drain path');
    assert.ok(stats.dropped >= 1, 'dropped counter must be incremented by shutdown drain');
  } finally {
    cleanup();
  }
});

// ── 6. embedding-brain embed() individual malformed vector ────────────────────

test('embed: per-candidate embedding is not an array (scalar) → errors incremented, route returns null', async () => {
  // Fake Ollama that serves:
  //   - 1-input requests (embedSingle for query): valid [[...]] response
  //   - 2-input requests (ensureCandidateVectors): malformed [[...], 42] response
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString('utf8'); });
    req.on('end', () => {
      const parsed = JSON.parse(raw) as { input: string[] };
      const count = parsed.input.length;
      let body: string;
      if (count === 1) {
        // Query embed — valid single vector
        body = JSON.stringify({ embeddings: [[1.0, 0.5, 0.3]] });
      } else {
        // Candidate batch — second element is a scalar (not an array) → malformed
        body = JSON.stringify({ embeddings: [[1.0, 0.5, 0.3], 42] });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  try {
    const brain = new EmbeddingBrain({
      enabled: true,
      url: `http://127.0.0.1:${port}`,
      timeoutMs: 2000,
      circuitBreakerThreshold: 10,
      circuitBreakerCooldownMs: 60_000,
    });

    const candidates: ToolCandidate[] = [
      { namespacedName: 'neon/run_sql', description: 'Execute SQL', category: 'code' },
      { namespacedName: 'github/search_code', description: 'Search code on GitHub', category: 'code' },
    ];

    const result = await brain.route('find sql query tool', candidates);

    assert.equal(result, null, 'route must return null when a candidate embedding is not an array');
    const stats = brain.getStats();
    assert.ok(stats.errors >= 1, `errors counter must be incremented for malformed vector; got ${stats.errors}`);
  } finally {
    await new Promise<void>((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  }
});
