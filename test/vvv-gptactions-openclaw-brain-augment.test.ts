/**
 * VVV batch — 4 previously untested branches:
 *
 *   1. gpt-actions.ts:87 — `actionPath === '/'` (trailing slash): path `/gpt-actions/`
 *      strips to `/` which hits the middle condition of the three-way OR guard that
 *      serves the OpenAPI spec. Prior tests only cover `''` (/gpt-actions) and
 *      `/openapi.yaml`.
 *
 *   2. openclaw-facade.ts:146 — `route === '/'` (trailing slash): path `/openclaw/`
 *      strips to `/` which hits the middle condition of the three-way OR guard that
 *      serves the skill manifest. Prior tests only cover `''` (/openclaw) and
 *      `/skills.json`.
 *
 *   3. openclaw-facade.ts:122-123 — `action === 'persist'` branch in `ch1tty-session
 *      mapArgs`: existing test only exercises `action: 'recall'`. The persist branch
 *      routes to `chittyos/chitty_memory_persist` instead of `chitty_memory_recall`.
 *
 *   4. aggregator.ts:782-793 — brain route + focus active + scoreIntent returns empty:
 *      when brain succeeds and focus is active, the augmentation loop runs
 *      `for (const t of this.scoreIntent(...))`. If that returns `[]` (intent words
 *      don't keyword-match any tool), the loop body never executes, keywordAugmented
 *      stays empty, and resolvedBy stays 'brain'. Prior tests only cover the path
 *      where augmentation DOES add a keyword-in-focus tool.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { RoutedTool, ToolCandidate } from '../src/ollama-brain.js';
import type { ServerConfig } from '../src/types.js';

// ── Shared server helpers ────────────────────────────────────────────────────

interface Started {
  server: HttpMcpServer;
  aggregator: Aggregator;
  baseUrl: string;
  dlqPath: string;
}

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-vvv-${process.pid}-${++_seq}.dlq.jsonl`);
}

async function startServer(configs: ServerConfig[] = [], fb?: FixtureBackend): Promise<Started> {
  const dlqPath = dlq();
  const aggregator = new Aggregator(configs, {
    ledgerDlqPath: dlqPath,
    embedEnabled: false,
    ...(fb ? { backendFactory: () => fb } : {}),
  });
  const server = new HttpMcpServer(aggregator, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  return { server, aggregator, baseUrl: `http://127.0.0.1:${server.getPort()}`, dlqPath };
}

async function stop(s: Started): Promise<void> {
  await s.server.stop();
  await s.aggregator.shutdown();
  rmSync(s.dlqPath, { force: true });
}

// ── 1. gpt-actions trailing slash serves OpenAPI spec ───────────────────────

test('gpt-actions: GET /gpt-actions/ (trailing slash) → actionPath "/" → 200 + OpenAPI spec', async () => {
  const s = await startServer();
  try {
    // /gpt-actions/ strips to "/" → hits the `actionPath === '/'` branch
    const res = await fetch(`${s.baseUrl}/gpt-actions/`);
    assert.equal(res.status, 200, 'trailing-slash path must return 200');
    assert.ok(
      res.headers.get('content-type')?.includes('text/yaml'),
      `expected text/yaml, got: ${res.headers.get('content-type')}`,
    );
    const body = await res.text();
    assert.ok(body.includes('openapi: 3.1.0'), 'spec must contain openapi version');
    assert.ok(body.includes('ChittyMCP GPT Actions'), 'spec must contain API title');
  } finally {
    await stop(s);
  }
});

// ── 2. openclaw trailing slash serves skill manifest ────────────────────────

test('openclaw: GET /openclaw/ (trailing slash) → route "/" → 200 + skill manifest', async () => {
  const s = await startServer();
  try {
    // /openclaw/ strips to "/" → hits the `route === '/'` branch
    const res = await fetch(`${s.baseUrl}/openclaw/`);
    assert.equal(res.status, 200, 'trailing-slash path must return 200');
    assert.ok(
      res.headers.get('content-type')?.includes('application/json'),
      `expected application/json, got: ${res.headers.get('content-type')}`,
    );
    const body = await res.json() as { skills: Array<{ key: string }> };
    assert.ok(Array.isArray(body.skills), 'manifest must have skills array');
    const keys = new Set(body.skills.map((s) => s.key));
    assert.ok(keys.has('ch1tty-search'), 'ch1tty-search in manifest');
    assert.ok(keys.has('ch1tty-session'), 'ch1tty-session in manifest');
  } finally {
    await stop(s);
  }
});

// ── 3. openclaw ch1tty-session persist branch ───────────────────────────────

test('openclaw: ch1tty-session persist → mapArgs takes persist branch → chitty_memory_persist called', async () => {
  const fb = new FixtureBackend();
  fb.defineServer('chittyos', {
    tools: [{
      name: 'chitty_memory_persist',
      description: 'Persist session memory to ContextConsciousness',
      inputSchema: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' }, scope: { type: 'string' } } },
      response: {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, stored: true }) }],
      },
    }],
  });
  const configs: ServerConfig[] = [
    { id: 'chittyos', name: 'ChittyOS', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'noop', args: [] },
  ];
  const s = await startServer(configs, fb);
  try {
    const res = await fetch(`${s.baseUrl}/openclaw/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skill: 'ch1tty-session',
        args: { action: 'persist', query: 'session-key', value: 'some session state' },
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { ok: boolean; skill: string };
    assert.equal(body.ok, true);
    assert.equal(body.skill, 'ch1tty-session');

    // Verify the persist branch was taken: fixture must have been called with persist tool
    const calls = fb.getCallLog();
    assert.ok(calls.length > 0, 'fixture backend must have been invoked');
    assert.equal(calls[0].tool, 'chitty_memory_persist', 'persist action must route to chitty_memory_persist, not recall');
    assert.equal(calls[0].serverId, 'chittyos');
  } finally {
    await stop(s);
  }
});

// ── 4. Cast brain route + focus active + empty keyword augmentation ──────────

// Stub coordinator that returns pre-determined brain results without a live Ollama.
class StubCoordinator extends SessionCoordinator {
  private readonly results: RoutedTool[];
  constructor(results: RoutedTool[]) {
    super({}, { enabled: false });
    this.results = results;
  }
  override async routeIntent(_q: string, _c: ToolCandidate[]): Promise<RoutedTool[]> {
    return this.results;
  }
}

const FOCUS_PROFILES = {
  profiles: {
    finance: {
      description: 'Billing and payments',
      categories: ['ecosystem' as const],
      servers: ['stripe'],
      boost: 0.5,
    },
  },
};

const FIXTURE_CONFIGS: ServerConfig[] = [
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'read', category: 'ecosystem', endpoint: 'https://fixture.stripe' },
];

test('cast: brain route + focus active + scoreIntent returns empty → augmentation loop fires but adds 0 tools → resolvedBy:brain', async () => {
  const fixture = new FixtureBackend();
  for (const [id, def] of Object.entries(FIXTURE_SERVERS)) {
    fixture.defineServer(id, def);
  }

  // Brain returns neon/run_sql with high confidence
  const brainResults: RoutedTool[] = [{
    tool: { namespacedName: 'neon/run_sql', description: 'Execute SQL on Neon database', category: 'code' },
    confidence: 0.95,
    reason: 'stub',
  }];

  const dlqPath = dlq();
  const coordinator = new StubCoordinator(brainResults);
  const aggregator = new Aggregator(FIXTURE_CONFIGS, {
    focusProfiles: FOCUS_PROFILES,
    focus: 'finance',           // finance focus is active → augmentation loop runs
    embedEnabled: false,
    coordinator,
    ledgerDlqPath: dlqPath,
    backendFactory: (config) => { fixture.registerServer(config); return fixture; },
  });

  try {
    // Intent uses gibberish words that don't appear in any tool name/description/serverId.
    // scoreIntent("frobnicate garblexyz quuxmort") returns [] because no keyword matches.
    // Augmentation loop fires (focus is active) but iterates over an empty array → adds nothing.
    // Brain's neon/run_sql wins → resolvedBy must be 'brain' not 'keyword'.
    const result = await aggregator.callTool('ch1tty/cast', {
      intent: 'frobnicate garblexyz quuxmort',
      confirm: true,
    });

    assert.equal(result.isError, undefined, 'cast must not error');
    const cast = JSON.parse(result.content[0]?.text ?? '{}') as {
      cast: string;
      resolvedBy?: string;
      resolved?: { tool: string };
    };

    assert.equal(cast.cast, 'plan', `expected plan, got: ${cast.cast}`);
    // Brain route + no keyword augmentation → resolvedBy must be 'brain'
    assert.equal(cast.resolvedBy, 'brain', 'brain route with no keyword augmentation must report resolvedBy:brain');
    // The winning tool must be the brain's pick, not a keyword-found tool
    assert.equal(cast.resolved?.tool, 'neon/run_sql', `brain's neon tool must win: ${cast.resolved?.tool}`);
  } finally {
    await aggregator.shutdown();
    rmSync(dlqPath, { force: true });
  }
});
