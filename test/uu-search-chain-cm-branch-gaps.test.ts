/**
 * UU — branch coverage gaps: aggregator.ts:560 plural branch + child-manager.ts:237
 *
 * Two structural gaps remained after run 131 (TT):
 *
 * 1. aggregator.ts:560 — ternary `inFocusCount === 1 ? '' : 's'` in the server-summary
 *    explain path (line 560). Only the singular `''` branch was covered (TT-5 has a
 *    single in-focus server). This adds 2- and 3-server cases to hit the plural `'s'`
 *    branch.
 *
 * 2. child-manager.ts:237 — `options?.timeoutMs ?? CALL_TIMEOUT_MS` right-side branch.
 *    All existing callTool tests either hit the circuit-open early-return (no line 237)
 *    or go through the aggregator with FixtureBackend (not ChildManager). This directly
 *    calls ChildManager.callTool with 3 args (no options) via an injected fake connection,
 *    exercising the `?? CALL_TIMEOUT_MS` fallback.
 *
 * Three other reported gaps (aggregator.ts:630, 1304, 1310) are structurally unreachable
 * and are suppressed with `c8 ignore next` in the source. See inline comments there.
 *
 * Tests:
 *   1. explain:true + inFocusOnly + 2 in-focus servers → rationale uses plural "servers"
 *   2. explain:true + inFocusOnly + 1 in-focus server  → rationale uses singular "server"
 *   3. explain:true + inFocusOnly + 3 in-focus servers → rationale text includes count
 *   4. inFocusOnly + 2 in-focus servers → explanation.inFocusServers === 2
 *   5. child-manager callTool(3 args, no options) with injected conn → succeeds
 *   6. child-manager callTool(4 args, options.timeoutMs) with injected conn → succeeds
 *   7. child-manager callTool(3 args, no options) → result content matches fake output
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-uu-${label}-${Date.now()}.jsonl`);
}

// Focus that puts both 'alpha' and 'beta' in scope (by server id) but not 'gamma'.
const TWIN_PROFILES = {
  profiles: {
    twin: {
      description: 'Two servers',
      categories: [] as ('ecosystem' | 'code')[],
      servers: ['alpha', 'beta'],
      boost: 0.5,
    },
    triple: {
      description: 'Three servers',
      categories: [] as ('ecosystem' | 'code')[],
      servers: ['alpha', 'beta', 'gamma'],
      boost: 0.5,
    },
    solo: {
      description: 'One server',
      categories: [] as ('ecosystem' | 'code')[],
      servers: ['alpha'],
      boost: 0.5,
    },
  },
};

const ALPHA_CFG: ServerConfig = { id: 'alpha', name: 'Alpha', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://alpha.test/mcp' };
const BETA_CFG: ServerConfig = { id: 'beta', name: 'Beta', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://beta.test/mcp' };
const GAMMA_CFG: ServerConfig = { id: 'gamma', name: 'Gamma', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://gamma.test/mcp' };

const ALPHA_TOOLS: ToolEntry[] = [{ name: 'alpha_tool', description: 'Alpha tool', inputSchema: { type: 'object', properties: {} } }];
const BETA_TOOLS: ToolEntry[] = [{ name: 'beta_tool', description: 'Beta tool', inputSchema: { type: 'object', properties: {} } }];
const GAMMA_TOOLS: ToolEntry[] = [{ name: 'gamma_tool', description: 'Gamma tool', inputSchema: { type: 'object', properties: {} } }];

function makeBackend(tools: ToolEntry[]): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: tools.length, toolCacheAge: 0 }),
    listTools: async () => tools,
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: 'ok' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async () => ({ contents: [] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

function makeAgg(label: string, configs: ServerConfig[]) {
  const backendMap: Record<string, Backend> = {
    alpha: makeBackend(ALPHA_TOOLS),
    beta: makeBackend(BETA_TOOLS),
    gamma: makeBackend(GAMMA_TOOLS),
  };
  return new Aggregator(configs, {
    backendFactory: (cfg) => backendMap[cfg.id] ?? makeBackend([]),
    ledgerDlqPath: dlqPath(label),
    focusProfiles: TWIN_PROFILES as unknown as Parameters<typeof Aggregator>[1]['focusProfiles'],
    embedEnabled: false,
  });
}

function parse(result: ToolCallResult): Record<string, unknown> {
  return JSON.parse((result.content[0] as { type: 'text'; text: string }).text) as Record<string, unknown>;
}

// ── Tests 1–4: aggregator.ts:560 plural branch ───────────────────────────────

// UU-1: 2 in-focus servers with inFocusOnly + explain → plural "servers" (line 560 's' branch)
test('UU-1: inFocusOnly + 2 in-focus servers → rationale uses plural "servers"', async () => {
  const agg = makeAgg('u1', [ALPHA_CFG, BETA_CFG, GAMMA_CFG]);
  try {
    const r = parse(await agg.callTool('ch1tty/search', { explain: true, focus: 'twin', inFocusOnly: true }, 'uu-s1'));
    const exp = r.explanation as Record<string, unknown>;
    assert.ok(typeof exp.rationale === 'string', 'explanation.rationale is a string');
    assert.ok(
      (exp.rationale as string).includes('2 in-focus servers'),
      `rationale should say "2 in-focus servers" but got: ${exp.rationale}`,
    );
  } finally { await agg.shutdown(); }
});

// UU-2: 1 in-focus server with inFocusOnly + explain → singular "server" (no 's')
test('UU-2: inFocusOnly + 1 in-focus server → rationale uses singular "server"', async () => {
  const agg = makeAgg('u2', [ALPHA_CFG, BETA_CFG, GAMMA_CFG]);
  try {
    const r = parse(await agg.callTool('ch1tty/search', { explain: true, focus: 'solo', inFocusOnly: true }, 'uu-s2'));
    const exp = r.explanation as Record<string, unknown>;
    assert.ok(typeof exp.rationale === 'string', 'rationale is a string');
    assert.ok(
      (exp.rationale as string).includes('1 in-focus server'),
      `rationale should say "1 in-focus server" but got: ${exp.rationale}`,
    );
    // Should NOT include plural form
    assert.ok(
      !(exp.rationale as string).includes('1 in-focus servers'),
      'rationale should not say "1 in-focus servers"',
    );
  } finally { await agg.shutdown(); }
});

// UU-3: 3 in-focus servers with inFocusOnly + explain → plural "servers"
test('UU-3: inFocusOnly + 3 in-focus servers → rationale uses plural "servers"', async () => {
  const agg = makeAgg('u3', [ALPHA_CFG, BETA_CFG, GAMMA_CFG]);
  try {
    const r = parse(await agg.callTool('ch1tty/search', { explain: true, focus: 'triple', inFocusOnly: true }, 'uu-s3'));
    const exp = r.explanation as Record<string, unknown>;
    assert.ok(typeof exp.rationale === 'string', 'rationale is a string');
    assert.ok(
      (exp.rationale as string).includes('3 in-focus servers'),
      `rationale should say "3 in-focus servers" but got: ${exp.rationale}`,
    );
  } finally { await agg.shutdown(); }
});

// UU-4: inFocusOnly + twin focus + 2 servers → explanation.inFocusServers === 2
test('UU-4: inFocusOnly + twin focus → explanation.inFocusServers === 2', async () => {
  const agg = makeAgg('u4', [ALPHA_CFG, BETA_CFG, GAMMA_CFG]);
  try {
    const r = parse(await agg.callTool('ch1tty/search', { explain: true, focus: 'twin', inFocusOnly: true }, 'uu-s4'));
    const exp = r.explanation as Record<string, unknown>;
    assert.equal(exp.inFocusServers, 2, 'inFocusServers reflects only the 2 in-focus servers after filter');
    assert.equal(exp.inFocusOnly, true, 'inFocusOnly field present in explanation');
  } finally { await agg.shutdown(); }
});

// ── Tests 5–7: child-manager.ts:237 right branch (options?.timeoutMs ?? CALL_TIMEOUT_MS) ──

process.env.CH1TTY_SPAWN_TIMEOUT_MS = '500';
const { ChildManager } = await import('../src/child-manager.js');
type ChildManagerType = InstanceType<typeof ChildManager>;

const tempDir = mkdtempSync(join(tmpdir(), 'ch1tty-uu-cm-'));
test.after(() => rmSync(tempDir, { recursive: true, force: true }));

function localConfig(id: string) {
  return { id, name: id, type: 'local' as const, access: 'readwrite' as const, category: 'code' as const, command: join(tempDir, 'nonexistent'), args: [] };
}

function makeFakeConn(text = 'fake-result') {
  return {
    client: {
      callTool: async (_params: unknown) => ({ content: [{ type: 'text', text }] }),
      listTools: async () => ({ tools: [] }),
      close: async () => {},
    },
    transport: {},
    toolCache: null,
    resourceCache: null,
    promptCache: null,
  };
}

// UU-5: callTool with no options arg → ?? CALL_TIMEOUT_MS right branch fires (line 237)
test('UU-5: ChildManager.callTool without options → succeeds via CALL_TIMEOUT_MS fallback', async () => {
  const cm = new ChildManager() as ChildManagerType;
  cm.registerServer(localConfig('svc5'));
  (cm as unknown as Record<string, unknown>).children =
    new Map([['svc5', makeFakeConn('result-5')]]);

  // 3-arg call: options is undefined → options?.timeoutMs is undefined → ?? CALL_TIMEOUT_MS fires
  const result = await cm.callTool('svc5', 'do_thing', {});

  assert.equal(result.isError, false, 'should not be an error');
  await cm.shutdown();
});

// UU-6: callTool WITH options.timeoutMs → left branch fires (custom timeout used)
test('UU-6: ChildManager.callTool with options.timeoutMs → succeeds via custom timeout', async () => {
  const cm = new ChildManager() as ChildManagerType;
  cm.registerServer(localConfig('svc6'));
  (cm as unknown as Record<string, unknown>).children =
    new Map([['svc6', makeFakeConn('result-6')]]);

  // 4-arg call: options.timeoutMs = 5000 → left branch fires
  const result = await cm.callTool('svc6', 'do_thing', {}, { timeoutMs: 5000 });

  assert.equal(result.isError, false, 'should not be an error');
  await cm.shutdown();
});

// UU-7: callTool without options → result content text matches fake output
test('UU-7: ChildManager.callTool without options → result content matches fake conn output', async () => {
  const cm = new ChildManager() as ChildManagerType;
  cm.registerServer(localConfig('svc7'));
  (cm as unknown as Record<string, unknown>).children =
    new Map([['svc7', makeFakeConn('hello-from-fake')]]);

  const result = await cm.callTool('svc7', 'greet', { name: 'world' });

  assert.equal(result.isError, false, 'call should succeed');
  const item = result.content[0];
  assert.equal(item.type, 'text');
  assert.equal((item as { type: 'text'; text: string }).text, 'hello-from-fake',
    'result text should match fake conn output');
  await cm.shutdown();
});
