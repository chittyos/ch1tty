/**
 * Workstream QQQQ: latencyMs in ch1tty/execute responses.
 *
 * ch1tty/cast has carried latencyMs on all 6 response shapes since LLLL. This
 * workstream adds the same observability to the direct-invocation path:
 *
 *   - Normal execute (sessionId active, success): content[1] JSON now includes
 *     latencyMs alongside sessionContext: { latencyMs, sessionContext: { ... } }
 *   - dryRun execute (any session state, success): the dry_run JSON gains a
 *     latencyMs field: { status:'dry_run', server, tool, args, latencyMs, sessionContext? }
 *   - Normal execute (no sessionId, success): NO extra content item — backward-
 *     compatible; callers that don't use sessions see exactly content[0] (raw output).
 *   - Error paths: no latencyMs (unchanged).
 *
 * Covered:
 *   1. Session, success → content[1] contains latencyMs ≥ 0
 *   2. Session, success → latencyMs and sessionContext co-exist in content[1]
 *   3. dryRun, no session → dry_run JSON contains latencyMs ≥ 0
 *   4. dryRun, with session → dry_run JSON contains latencyMs AND sessionContext
 *   5. No session, non-dryRun → content.length === 1 (backward compat, no latencyMs)
 *   6. Error path (unknown tool) → latencyMs absent
 *   7. Session, success → content[0] (raw output) is untouched; latencyMs only in content[1]
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-qqqq-${label}-${Date.now()}.jsonl`);
}

const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon Database', type: 'remote', access: 'readwrite', category: 'code',
  endpoint: 'https://neon.test/mcp',
};

const NEON_TOOLS: ToolEntry[] = [
  { name: 'list_projects', description: 'List all Neon database projects', inputSchema: { type: 'object', properties: {} } },
  { name: 'run_sql', description: 'Execute SQL queries on Neon database', inputSchema: { type: 'object', properties: {} } },
];

const RAW_OUTPUT = 'neon-raw-output';

function makeNeonBackend(): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: NEON_TOOLS.length, toolCacheAge: 0 }),
    listTools: async () => NEON_TOOLS,
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: RAW_OUTPUT }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makeAgg(label: string): Aggregator {
  return new Aggregator([NEON_CFG], {
    backendFactory: () => makeNeonBackend(),
    embedEnabled: false,
    ledgerDlqPath: dlqPath(label),
  });
}

function parseMetadata(result: ToolCallResult): Record<string, unknown> | undefined {
  for (const item of result.content) {
    if (item.type !== 'text') continue;
    try {
      const parsed = JSON.parse(item.text) as Record<string, unknown>;
      if ('latencyMs' in parsed || 'sessionContext' in parsed) return parsed;
    } catch { /* not JSON */ }
  }
  return undefined;
}

function parseDryRun(result: ToolCallResult): Record<string, unknown> {
  assert.equal(result.isError, false);
  const first = result.content[0];
  assert.equal(first?.type, 'text');
  const parsed = JSON.parse(first.text) as Record<string, unknown>;
  assert.equal(parsed.status, 'dry_run');
  return parsed;
}

// ── 1. Session, success → content[1] has latencyMs ≥ 0 ──────────────────────

test('execute: session + success → latencyMs ≥ 0 in content[1]', async () => {
  const agg = makeAgg('1-latency-session');
  try {
    const SESSION = 'qqqq-1';
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', sessionId: SESSION });
    assert.ok(!result.isError, 'execute must not be an error');
    const meta = parseMetadata(result);
    assert.ok(meta, 'metadata item must be present when session is active');
    assert.equal(typeof meta.latencyMs, 'number', 'latencyMs must be a number');
    assert.ok((meta.latencyMs as number) >= 0, 'latencyMs must be non-negative');
  } finally {
    await agg.shutdown();
  }
});

// ── 2. Session, success → latencyMs and sessionContext co-exist in content[1] ─

test('execute: session + success → latencyMs and sessionContext in same content item', async () => {
  const agg = makeAgg('2-latency-with-sc');
  try {
    const SESSION = 'qqqq-2';
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', sessionId: SESSION });
    assert.ok(!result.isError, 'execute must not be an error');
    const meta = parseMetadata(result);
    assert.ok(meta, 'metadata item must be present');
    assert.ok('latencyMs' in meta, 'latencyMs must be in metadata');
    assert.ok('sessionContext' in meta, 'sessionContext must be in same item as latencyMs');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. dryRun, no session → dry_run JSON has latencyMs ≥ 0 ──────────────────

test('execute: dryRun + no session → latencyMs ≥ 0 in dry_run JSON', async () => {
  const agg = makeAgg('3-dryrrun-no-session');
  try {
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', dryRun: true });
    const dr = parseDryRun(result);
    assert.equal(typeof dr.latencyMs, 'number', 'latencyMs must be a number in dry_run JSON');
    assert.ok((dr.latencyMs as number) >= 0, 'latencyMs must be non-negative');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. dryRun, with session → dry_run JSON has latencyMs AND sessionContext ───

test('execute: dryRun + session → dry_run JSON has latencyMs and sessionContext', async () => {
  const agg = makeAgg('4-dryrun-session');
  try {
    const SESSION = 'qqqq-4';
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects', dryRun: true, sessionId: SESSION });
    const dr = parseDryRun(result);
    assert.ok('latencyMs' in dr, 'latencyMs must be in dry_run JSON');
    assert.equal(typeof dr.latencyMs, 'number', 'latencyMs must be a number');
    assert.ok('sessionContext' in dr, 'sessionContext must also be present');
  } finally {
    await agg.shutdown();
  }
});

// ── 5. No session, non-dryRun → content.length === 1 (backward compat) ───────

test('execute: no session + success → content.length === 1 (no latencyMs item added)', async () => {
  const agg = makeAgg('5-no-session-compat');
  try {
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/list_projects' });
    assert.ok(!result.isError, 'execute must not be an error');
    assert.equal(result.content.length, 1, 'no extra content item without session — backward compatible');
    const meta = parseMetadata(result);
    assert.equal(meta, undefined, 'no latencyMs item without session');
  } finally {
    await agg.shutdown();
  }
});

// ── 6. Error path (unknown server) → latencyMs absent ───────────────────────

test('execute: error (unknown server) → latencyMs absent', async () => {
  const agg = makeAgg('6-error-no-latency');
  try {
    const SESSION = 'qqqq-6';
    const result = await agg.callTool('ch1tty/execute', { tool: 'unknown/some_tool', sessionId: SESSION });
    assert.equal(result.isError, true);
    const meta = parseMetadata(result);
    assert.equal(meta, undefined, 'latencyMs must be absent on error paths');
  } finally {
    await agg.shutdown();
  }
});

// ── 7. Session, success → content[0] (raw output) is untouched ───────────────

test('execute: session + success → content[0] is raw backend output, latencyMs only in content[1]', async () => {
  const agg = makeAgg('7-raw-output-untouched');
  try {
    const SESSION = 'qqqq-7';
    const result = await agg.callTool('ch1tty/execute', { tool: 'neon/run_sql', sessionId: SESSION });
    assert.ok(!result.isError, 'execute must not be an error');
    assert.ok(result.content.length >= 2, 'must have at least 2 content items when session is active');
    const first = result.content[0];
    assert.equal(first?.type, 'text');
    assert.equal(first.text, RAW_OUTPUT, 'content[0] must be the raw backend output, unmodified');
    // latencyMs must NOT appear in content[0]
    try {
      const parsed = JSON.parse(first.text) as Record<string, unknown>;
      assert.equal('latencyMs' in parsed, false, 'latencyMs must not be injected into raw output');
    } catch { /* content[0] is not JSON — that's fine, it's the raw string */ }
    // latencyMs IS in content[1]
    const second = result.content[1];
    assert.ok(second, 'content[1] must exist');
    assert.equal(second?.type, 'text');
    const meta = JSON.parse(second.text) as Record<string, unknown>;
    assert.ok('latencyMs' in meta, 'latencyMs must be in content[1]');
  } finally {
    await agg.shutdown();
  }
});
