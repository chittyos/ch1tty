/**
 * Scenario harness — multi-step integration tests driving the real Aggregator
 * routing + scoring pipeline against a FixtureBackend.
 *
 * Goals (workstream D):
 *  - Surface mis-resolutions (wrong tool picked by cast)
 *  - Surface latency anomalies
 *  - Surface resilience failures (bad backend doesn't kill the gateway)
 *  - Validate focus lens is a lens, not a gate
 *
 * No behavior mocks: FixtureBackend implements the full Backend interface with
 * realistic fixture data; the real Aggregator code paths are exercised end-to-end.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { RoutedTool, ToolCandidate } from '../src/ollama-brain.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

// Stub coordinator for testing brain-routing scenarios without a live Ollama endpoint.
class StubCoordinator extends SessionCoordinator {
  private stubbedResults: RoutedTool[] | null;
  constructor(results: RoutedTool[] | null) {
    super({}, { enabled: false });
    this.stubbedResults = results;
  }
  override async routeIntent(_query: string, _candidates: ToolCandidate[]): Promise<RoutedTool[] | null> {
    return this.stubbedResults;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const FOCUS_PROFILES = {
  profiles: {
    finance: {
      description: 'Billing, payments, and financial ecosystem tools',
      categories: ['ecosystem' as const],
      servers: ['stripe', 'tasks'],
      boost: 0.5,
    },
    governance: {
      description: 'ChittyOS ecosystem governance, identity, evidence, and persistent state',
      categories: ['ecosystem' as const, 'documents' as const],
      servers: ['chittyos', 'neon', 'notion'],
      boost: 0.5,
    },
    design: {
      description: 'Browser rendering, automation, and desktop/visual work',
      categories: ['desktop' as const],
      servers: ['playwright'],
      boost: 0.5,
    },
    code: {
      description: 'Software development — source control, library documentation, and database tools',
      categories: ['code' as const],
      servers: ['github', 'context7', 'neon'],
      boost: 0.5,
    },
    communication: {
      description: 'Cross-channel messaging, notes, and team communication',
      categories: ['communication' as const],
      servers: ['notion', 'chittymac', 'imessage', 'tasks'],
      boost: 0.5,
    },
    ops: {
      description: 'Deployment, infrastructure monitoring, and DevOps tooling',
      categories: ['ecosystem' as const, 'code' as const],
      servers: ['cloudflare', 'neon', 'github', 'orchestrator', 'fs'],
      boost: 0.5,
    },
  },
};

/** Configs matching the fixture servers. Aggregator needs configs to route. */
const FIXTURE_CONFIGS: ServerConfig[] = [
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'stripe', name: 'Stripe', type: 'remote', access: 'read', category: 'ecosystem', endpoint: 'https://fixture.stripe' },
  { id: 'tasks', name: 'Tasks', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.tasks' },
  { id: 'chittyos', name: 'ChittyOS', type: 'remote', access: 'read', category: 'ecosystem', endpoint: 'https://fixture.chittyos' },
  { id: 'playwright', name: 'Playwright', type: 'remote', access: 'readwrite', category: 'desktop', endpoint: 'https://fixture.playwright' },
  { id: 'notion', name: 'Notion', type: 'remote', access: 'readwrite', category: 'documents', endpoint: 'https://fixture.notion' },
  { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.github' },
  { id: 'context7', name: 'Library Docs', type: 'remote', access: 'read', category: 'code', endpoint: 'https://fixture.context7' },
  { id: 'imessage', name: 'iMessage', type: 'remote', access: 'readwrite', category: 'communication', endpoint: 'https://fixture.imessage' },
  { id: 'chittymac', name: 'Apple Notes', type: 'remote', access: 'readwrite', category: 'communication', endpoint: 'https://fixture.chittymac' },
  { id: 'cloudflare', name: 'Cloudflare Platform', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.cloudflare' },
  { id: 'orchestrator', name: 'Orchestrator', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.orchestrator' },
  { id: 'fs', name: 'Filesystem', type: 'remote', access: 'readwrite', category: 'desktop', endpoint: 'https://fixture.fs' },
];

function buildAggregator(
  configs = FIXTURE_CONFIGS,
  backend?: FixtureBackend,
  opts?: { focus?: string },
): { aggregator: Aggregator; fixture: FixtureBackend } {
  const fixture = backend ?? new FixtureBackend();
  if (!backend) {
    for (const [id, def] of Object.entries(FIXTURE_SERVERS)) {
      fixture.defineServer(id, def);
    }
  }

  const aggregator = new Aggregator(configs, {
    focusProfiles: FOCUS_PROFILES,
    focus: opts?.focus,
    embedEnabled: false,  // no Ollama in CI — skip warmup, fall back to keyword scoring
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });

  return { aggregator, fixture };
}

function parseCast(result: { content: Array<{ type: string; text?: string }> }) {
  const text = result.content[0]?.text ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

function parseSearch(result: { content: Array<{ type: string; text?: string }> }) {
  const text = result.content[0]?.text ?? '{}';
  return JSON.parse(text) as { tools?: Array<{ tool: string; score?: number; inFocus?: boolean }>; matches?: number; total?: number; focus?: string };
}

// ── Scenario 1: Finance focus — payment workflow ──────────────────────────────

test('scenario: finance focus — cast "list recent payments" resolves to stripe', async () => {
  const { aggregator } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'finance' });

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list recent payments',
    confirm: true,
  });

  assert.equal(result.isError, undefined);
  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan');
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.equal(resolved.tool, 'stripe/list_payments', `expected stripe/list_payments, got ${resolved.tool}`);
  assert.ok((resolved.score ?? 0) > 0.1, `score should be >0.1, got ${resolved.score}`);
  assert.equal(cast.focus, 'finance');
});

test('scenario: finance focus boosts stripe over other ecosystem tools', async () => {
  const { aggregator } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'finance' });

  // "list" matches stripe/list_payments (in-focus with finance) AND neon/list_projects (out-of-focus).
  // Using a query that crosses focus boundaries proves the boost actually changes ordering, not
  // that stripe tools are alphabetically or lexically first for every possible query.
  const resultWithFocus = await aggregator.callTool('ch1tty/search', {
    query: 'list',
    focus: 'finance',
  });
  const resultNoFocus = await aggregator.callTool('ch1tty/search', {
    query: 'list',
    focus: 'none',
  });

  assert.equal(resultWithFocus.isError, undefined);
  assert.equal(resultNoFocus.isError, undefined);

  const withFocus = parseSearch(resultWithFocus);
  const noFocus = parseSearch(resultNoFocus);

  // With focus, finance in-focus tools (stripe, tasks) must appear in the boosted in-focus
  // set. Other ecosystem servers (cloudflare, orchestrator) are also in-focus for finance
  // by category, so we verify presence in the in-focus set rather than exact position [0].
  const withTools = withFocus.tools ?? [];
  assert.ok(withTools.length > 0, 'should return tools with focus');
  const inFocusResults = withTools.filter((t) => t.inFocus);
  assert.ok(inFocusResults.length > 0, 'should have in-focus results with finance focus active');
  assert.ok(
    inFocusResults.some((t) => t.tool.startsWith('stripe/') || t.tool.startsWith('tasks/')),
    'finance in-focus results must include stripe or tasks tools for "list" query',
  );

  // Without focus, out-of-focus tools (neon) must appear — lens never hides them
  const noFocusTools = noFocus.tools ?? [];
  assert.ok(noFocusTools.some((t) => t.tool.startsWith('neon/')), 'neon must appear without focus');
  assert.ok(!noFocusTools.some((t) => t.inFocus), 'no inFocus markers when focus is "none"');

  // Verify the boost actually changed ordering: with focus, neon ranks below stripe/tasks
  const withNeonIdx = withTools.findIndex((t) => t.tool.startsWith('neon/'));
  const withStripeOrTasksIdx = withTools.findIndex((t) => t.tool.startsWith('stripe/') || t.tool.startsWith('tasks/'));
  if (withNeonIdx !== -1 && withStripeOrTasksIdx !== -1) {
    assert.ok(withStripeOrTasksIdx < withNeonIdx, 'finance focus must rank stripe/tasks before neon');
  }

  assert.equal(withFocus.focus, 'finance');
  assert.equal(noFocus.focus, undefined);
});

// ── Scenario 2: Governance focus — database inspection ───────────────────────

test('scenario: governance focus — search "schema table" ranks neon first', async () => {
  const { aggregator } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'governance' });

  const result = await aggregator.callTool('ch1tty/search', {
    query: 'schema table database',
    focus: 'governance',
  });

  assert.equal(result.isError, undefined);
  const data = parseSearch(result);
  assert.ok(data.tools && data.tools.length > 0, 'should have results');

  // neon is in governance profile → describe_table_schema should rank first
  const first = data.tools![0];
  assert.ok(first.tool.startsWith('neon/'), `first result with governance focus should be neon, got ${first.tool}`);
  assert.equal(first.inFocus, true, 'first result should be marked inFocus');
  assert.equal(data.focus, 'governance');
});

test('scenario: governance focus — execute neon/describe_table_schema returns schema', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'neon/describe_table_schema',
    args: { project_id: 'proj-abc123', table_name: 'sessions' },
  });

  assert.equal(result.isError, undefined);
  const schema = JSON.parse(result.content[0].text as string) as { table: string; columns: unknown[] };
  assert.equal(schema.table, 'sessions');
  assert.ok(Array.isArray(schema.columns) && schema.columns.length > 0);
});

// ── Scenario 3: Multi-step cross-backend workflow ─────────────────────────────

test('scenario: multi-step — neon project list → table schema → notion page', async () => {
  const { aggregator, fixture } = buildAggregator();
  const sessionId = 'scenario-session-001';

  // Step 1: discover neon tools
  const searchResult = await aggregator.callTool('ch1tty/search', { query: 'database projects', server: 'neon' }, sessionId);
  assert.equal(searchResult.isError, undefined);
  const found = parseSearch(searchResult);
  assert.ok(found.tools && found.tools.some((t) => t.tool === 'neon/list_projects'), 'should find neon/list_projects');

  // Step 2: list neon projects
  const listResult = await aggregator.callTool('ch1tty/execute', { tool: 'neon/list_projects' }, sessionId);
  assert.equal(listResult.isError, undefined);
  const projects = JSON.parse(listResult.content[0].text as string) as Array<{ id: string; name: string }>;
  assert.ok(projects.length > 0, 'should return projects');
  assert.equal(projects[0].name, 'ch1tty-prod');

  // Step 3: get schema for first project
  const schemaResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'neon/describe_table_schema',
    args: { project_id: projects[0].id, table_name: 'sessions' },
  }, sessionId);
  assert.equal(schemaResult.isError, undefined);

  // Step 4: create a notion page to document the schema
  const notionResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'notion/create_page',
    args: { title: 'sessions schema', content: schemaResult.content[0].text },
  }, sessionId);
  assert.equal(notionResult.isError, undefined);
  const page = JSON.parse(notionResult.content[0].text as string) as { id: string };
  assert.ok(page.id, 'notion page should have an id');

  // Verify call log shows all 3 execute calls
  const calls = fixture.getCallLog();
  const toolNames = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(toolNames.includes('neon/list_projects'));
  assert.ok(toolNames.includes('neon/describe_table_schema'));
  assert.ok(toolNames.includes('notion/create_page'));
});

// ── Scenario 4: Mis-resolution detection ─────────────────────────────────────

test('scenario: mis-resolution — ambiguous intent has low confidence', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'do the thing',
    confirm: true,
  });

  // Ambiguous intent should either no_match or produce a low-confidence plan
  assert.equal(result.isError, undefined);
  const cast = parseCast(result);
  if (cast.cast === 'plan') {
    const resolved = cast.resolved as { score: number };
    // Ambiguous intents should score low — flag if surprisingly high
    assert.ok(
      (resolved.score ?? 1) < 0.8,
      `Ambiguous intent "do the thing" resolved with unexpectedly high score ${resolved.score} — possible mis-resolution`,
    );
  } else {
    assert.equal(cast.cast, 'no_match', 'ambiguous intent should produce no_match or low-score plan');
  }
});

test('scenario: mis-resolution — "take screenshot" resolves to playwright', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'take screenshot of the page',
    confirm: true,
  });

  assert.equal(result.isError, undefined);
  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', 'should resolve a plan');
  const resolved = cast.resolved as { tool: string; score: number };
  assert.equal(resolved.tool, 'playwright/screenshot', `expected playwright/screenshot, got ${resolved.tool}`);
});

test('scenario: mis-resolution — "search documents" resolves to notion', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'search documents in workspace',
    confirm: true,
  });

  assert.equal(result.isError, undefined);
  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan');
  const resolved = cast.resolved as { tool: string };
  assert.equal(resolved.tool, 'notion/search', `expected notion/search, got ${resolved.tool}`);
});

// ── Scenario 5: Focus is a lens, not a gate ───────────────────────────────────

test('scenario: design focus — search "create" still returns non-desktop tools (lens, not gate)', async () => {
  const { aggregator } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'design' });

  // "create" matches neon/create_project, stripe/create_payment_intent, tasks/create_task,
  // notion/create_page — all out-of-focus for design. Verifies the design focus lens does NOT
  // filter out non-desktop tools when they match a keyword.
  const result = await aggregator.callTool('ch1tty/search', {
    query: 'create',
    focus: 'design',
    limit: 50,
  });

  assert.equal(result.isError, undefined);
  const data = parseSearch(result);

  // Non-desktop tools must appear — focus is a lens, not a gate
  const tools = data.tools ?? [];
  assert.ok(tools.length > 0, 'should return matching tools');
  assert.ok(
    tools.some((t) => t.tool.startsWith('neon/') || t.tool.startsWith('stripe/') || t.tool.startsWith('notion/')),
    'non-desktop tools (neon/stripe/notion) must appear even with design focus active',
  );
  // Non-desktop tools must NOT be marked inFocus
  assert.ok(
    !tools.some((t) => !t.tool.startsWith('playwright/') && t.inFocus),
    'only playwright tools should be marked inFocus with design profile',
  );

  // Ranking check: search "browser" — matches playwright tools — verify they rank first and
  // are marked inFocus when design focus is active.
  const rankResult = await aggregator.callTool('ch1tty/search', {
    query: 'browser',
    focus: 'design',
    limit: 50,
  });
  assert.equal(rankResult.isError, undefined);
  const rankData = parseSearch(rankResult);
  const rankTools = rankData.tools ?? [];
  assert.ok(rankTools.length > 0, 'browser query should match playwright tools');
  assert.ok(rankTools[0].tool.startsWith('playwright/'), `first result should be playwright, got ${rankTools[0].tool}`);
  assert.equal(rankTools[0].inFocus, true, 'playwright result should be marked inFocus');
  const inFocusTools = rankTools.filter((t) => t.inFocus);
  assert.ok(
    inFocusTools.every((t) => t.tool.startsWith('playwright/')),
    'only playwright tools should be inFocus with design profile',
  );
});

test('scenario: focus "none" clears an env-level default focus', async () => {
  const { aggregator } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'finance' });

  // With "none" override, should behave as unfocused
  const result = await aggregator.callTool('ch1tty/search', {
    query: 'payment',
    focus: 'none',
  });

  assert.equal(result.isError, undefined);
  const data = parseSearch(result);
  // No focus label in response
  assert.equal(data.focus, undefined, 'focus should be cleared by "none"');
  // No inFocus markers when focus is cleared
  const tools = data.tools ?? [];
  assert.ok(!tools.some((t) => t.inFocus), 'no inFocus markers expected when focus is "none"');
});

// ── Scenario 6: Backend failure resilience ────────────────────────────────────

test('scenario: resilience — erroring backend still lets other backends serve search', async () => {
  const fixture = new FixtureBackend();
  // Healthy backends
  fixture.defineServer('neon', FIXTURE_SERVERS.neon);
  fixture.defineServer('notion', FIXTURE_SERVERS.notion);
  // Broken backend — listTools throws
  fixture.defineServer('stripe', { ...FIXTURE_SERVERS.stripe, listToolsError: true });
  fixture.defineServer('tasks', FIXTURE_SERVERS.tasks);
  fixture.defineServer('chittyos', FIXTURE_SERVERS.chittyos);
  fixture.defineServer('playwright', FIXTURE_SERVERS.playwright);

  const { aggregator } = buildAggregator(FIXTURE_CONFIGS, fixture);

  // Search should succeed even though stripe's listTools is broken
  const result = await aggregator.callTool('ch1tty/search', { query: 'database' });
  assert.equal(result.isError, undefined);
  const data = parseSearch(result);
  assert.ok((data.total ?? 0) > 0, 'should return results from healthy backends');

  // Neon tools should be present
  const tools = data.tools ?? [];
  assert.ok(tools.some((t) => t.tool.startsWith('neon/')), 'neon tools should still appear');
  // Stripe tools should be absent (its listTools errored)
  assert.ok(!tools.some((t) => t.tool.startsWith('stripe/')), 'stripe tools should not appear when backend errors');
});

test('scenario: resilience — cast handles erroring backend gracefully', async () => {
  const fixture = new FixtureBackend();
  fixture.defineServer('neon', FIXTURE_SERVERS.neon);
  fixture.defineServer('stripe', { ...FIXTURE_SERVERS.stripe, listToolsError: true });
  fixture.defineServer('tasks', FIXTURE_SERVERS.tasks);
  fixture.defineServer('chittyos', FIXTURE_SERVERS.chittyos);
  fixture.defineServer('playwright', FIXTURE_SERVERS.playwright);
  fixture.defineServer('notion', FIXTURE_SERVERS.notion);

  const { aggregator } = buildAggregator(FIXTURE_CONFIGS, fixture);

  // cast should route to the healthy neon backend, not fail with no_match
  const result = await aggregator.callTool('ch1tty/cast', { intent: 'list database projects', confirm: true });
  assert.equal(result.isError, undefined);
  const cast = parseCast(result);
  // Accepting no_match would hide a regression where cast fails to route around the broken backend.
  // neon/list_projects is healthy and matches the intent, so cast must resolve to it.
  assert.equal(cast.cast, 'plan', `cast should resolve via healthy neon backend, got: ${cast.cast}`);
  const resolved = cast.resolved as { tool: string };
  assert.equal(resolved.tool, 'neon/list_projects', `should resolve to neon, got ${resolved.tool}`);
});

// ── Scenario 7: Cast confirm mode ────────────────────────────────────────────

test('scenario: cast confirm=true returns plan without executing', async () => {
  const { aggregator, fixture } = buildAggregator();
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list recent payments',
    confirm: true,
  });

  assert.equal(result.isError, undefined);
  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan');
  assert.ok(cast.resolved, 'should include resolved tool plan');

  // No backend calls should have been made (confirm=true means preview only)
  assert.equal(fixture.getCallLog().length, 0, 'confirm=true should not execute any backend tool');
});

test('scenario: cast without confirm executes and returns result', async () => {
  const { aggregator, fixture } = buildAggregator();
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list database projects',
  });

  assert.equal(result.isError, undefined);
  const cast = parseCast(result);
  assert.equal(cast.cast, 'executed');
  assert.ok(cast.resolved, 'should include resolved tool');

  // Assert the specific tool executed — "list database projects" must resolve to neon/list_projects.
  // Accepting "some tool ran" would hide mis-routing to another fixture tool.
  // Note: in "executed" mode, resolved is a bare string (the namespaced tool name);
  // in "plan" mode it's an object with a .tool property.
  assert.equal(cast.resolved, 'neon/list_projects', `cast should execute neon/list_projects, got ${cast.resolved}`);

  // Verify neon was actually called on the backend
  const callLog = fixture.getCallLog();
  assert.ok(callLog.length > 0, 'cast without confirm should execute a backend tool');
  assert.ok(callLog.some((r) => r.serverId === 'neon'), 'neon backend must have been invoked');
});

// ── Scenario 8: Latency reporting ────────────────────────────────────────────

test('scenario: latency — slow backend completes without timeout', async () => {
  const fixture = new FixtureBackend();
  // 50ms simulated latency (well within reason; just proves async path works)
  fixture.defineServer('neon', { ...FIXTURE_SERVERS.neon, latencyMs: 50 });
  fixture.defineServer('stripe', FIXTURE_SERVERS.stripe);
  fixture.defineServer('tasks', FIXTURE_SERVERS.tasks);
  fixture.defineServer('chittyos', FIXTURE_SERVERS.chittyos);
  fixture.defineServer('playwright', FIXTURE_SERVERS.playwright);
  fixture.defineServer('notion', FIXTURE_SERVERS.notion);

  const { aggregator } = buildAggregator(FIXTURE_CONFIGS, fixture);

  const start = Date.now();
  const result = await aggregator.callTool('ch1tty/execute', { tool: 'neon/list_projects' });
  const elapsed = Date.now() - start;

  assert.equal(result.isError, undefined);
  // Verify the call actually took the simulated latency
  assert.ok(elapsed >= 50, `expected ≥50ms latency, got ${elapsed}ms`);

  // Call log should show the duration
  const calls = fixture.getCallLog();
  assert.ok(calls.length > 0);
  assert.ok(calls[0].durationMs >= 50, `call log duration should reflect latency, got ${calls[0].durationMs}ms`);
});

test('scenario: latency — parallel registry refresh handles multiple slow backends', async () => {
  const fixture = new FixtureBackend();
  // All backends have 30ms latency — parallel refresh should take ~30ms, not 6×30ms
  for (const [id, def] of Object.entries(FIXTURE_SERVERS)) {
    fixture.defineServer(id, { ...def, latencyMs: 30 });
  }

  const { aggregator } = buildAggregator(FIXTURE_CONFIGS, fixture);

  const start = Date.now();
  await aggregator.callTool('ch1tty/search', { query: 'database' });
  const elapsed = Date.now() - start;

  // Should complete significantly faster than serial 6×30=180ms
  // Allow 3× headroom (90ms) for test environment variance
  assert.ok(elapsed < 180, `registry refresh should be parallel; got ${elapsed}ms (expected <180ms)`);
});

// ── Scenario 9: Status reports focus ─────────────────────────────────────────

test('scenario: status — reports active focus and available profiles', async () => {
  const { aggregator } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'finance' });

  const result = await aggregator.callTool('ch1tty/status');
  assert.equal(result.isError, undefined);
  const status = JSON.parse(result.content[0].text as string) as {
    focus: { active: string; categories: string[]; servers: string[] } | null;
    availableFocusProfiles: string[];
  };
  assert.ok(status.focus, 'focus should be reported in status');
  assert.equal(status.focus?.active, 'finance');
  assert.ok(status.availableFocusProfiles.includes('finance'));
  assert.ok(status.availableFocusProfiles.includes('governance'));
  assert.ok(status.availableFocusProfiles.includes('design'));
});

test('scenario: status — reports no focus when none set', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/status');
  assert.equal(result.isError, undefined);
  const status = JSON.parse(result.content[0].text as string) as { focus: null };
  assert.equal(status.focus, null, 'focus should be null when no default focus set');
});

// ── Scenario: resolvedBy observability ───────────────────────────────────────

test('resolvedBy: cast plan mode includes resolvedBy field', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list recent payments',
    confirm: true,
  });

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan');
  assert.ok(
    cast.resolvedBy === 'keyword' || cast.resolvedBy === 'brain',
    `plan response must include resolvedBy 'keyword' or 'brain', got: ${cast.resolvedBy}`,
  );
});

test('resolvedBy: cast executed mode includes resolvedBy field', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list database projects',
  });

  const cast = parseCast(result);
  assert.equal(cast.cast, 'executed');
  assert.ok(
    cast.resolvedBy === 'keyword' || cast.resolvedBy === 'brain',
    `executed response must include resolvedBy 'keyword' or 'brain', got: ${cast.resolvedBy}`,
  );
});

test('resolvedBy: cast no_match includes resolvedBy field', async () => {
  const { aggregator } = buildAggregator();

  // Use a nonsense intent that will not match any fixture tool
  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'xyzzy frobulate quux',
    confirm: true,
  });

  const cast = parseCast(result);
  assert.equal(cast.cast, 'no_match');
  assert.ok(
    cast.resolvedBy === 'keyword' || cast.resolvedBy === 'brain',
    `no_match response must include resolvedBy 'keyword' or 'brain', got: ${cast.resolvedBy}`,
  );
});

test('resolvedBy: keyword route produces resolvedBy=keyword (no brain in fixture env)', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'take screenshot of the page',
    confirm: true,
  });

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan');
  // In tests, brain is disabled (no real Ollama/embedding endpoint).
  // castRoute will always be 'fallback' → resolvedBy 'keyword'.
  assert.equal(cast.resolvedBy, 'keyword', 'fixture env has no brain: resolvedBy must be keyword');
});

// ── Scenario 10: Code focus ───────────────────────────────────────────────────

test('scenario: code focus — cast "create pull request" resolves to github', async () => {
  const { aggregator } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'code' });

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'create a pull request to merge the feature branch',
    confirm: true,
  });

  assert.equal(result.isError, undefined);
  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan');
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.equal(resolved.tool, 'github/create_pull_request', `expected github/create_pull_request, got ${resolved.tool}`);
  assert.ok((resolved.score ?? 0) > 0.1, `score should be >0.1, got ${resolved.score}`);
  assert.equal(cast.focus, 'code');
});

test('scenario: code focus boosts github over out-of-focus tools', async () => {
  const { aggregator } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'code' });

  const resultWithFocus = await aggregator.callTool('ch1tty/search', {
    query: 'pull request',
    focus: 'code',
  });
  const resultNoFocus = await aggregator.callTool('ch1tty/search', {
    query: 'pull request',
    focus: 'none',
  });

  assert.equal(resultWithFocus.isError, undefined);
  assert.equal(resultNoFocus.isError, undefined);

  const withFocus = parseSearch(resultWithFocus);
  const noFocus = parseSearch(resultNoFocus);

  // With code focus, github tools (in-focus) must rank first and be marked inFocus
  const withTools = withFocus.tools ?? [];
  assert.ok(withTools.length > 0, 'should return tools with code focus');
  assert.ok(
    withTools[0].tool.startsWith('github/'),
    `first result with code focus should be github, got ${withTools[0].tool}`,
  );
  assert.equal(withTools[0].inFocus, true, 'top github result should be marked inFocus');

  // Without focus, no inFocus markers
  const noFocusTools = noFocus.tools ?? [];
  assert.ok(!noFocusTools.some((t) => t.inFocus), 'no inFocus markers when focus is "none"');

  assert.equal(withFocus.focus, 'code');
  assert.equal(noFocus.focus, undefined);
});

test('scenario: code focus — multi-step: search library docs → execute → document in notion', async () => {
  const { aggregator, fixture } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'code' });
  const sessionId = 'scenario-session-code-001';

  // Step 1: discover context7 tools for library documentation
  const searchResult = await aggregator.callTool('ch1tty/search', { query: 'library documentation', server: 'context7' }, sessionId);
  assert.equal(searchResult.isError, undefined);
  const found = parseSearch(searchResult);
  assert.ok(
    found.tools && found.tools.some((t) => t.tool === 'context7/query-docs'),
    'should find context7/query-docs',
  );

  // Step 2: get library docs
  const docsResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'context7/query-docs',
    args: { libraryId: '/modelcontextprotocol/typescript-sdk', query: 'server setup' },
  }, sessionId);
  assert.equal(docsResult.isError, undefined);

  // Step 3: create a notion page to document findings
  const notionResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'notion/create_page',
    args: { title: 'MCP SDK: server setup', content: docsResult.content[0].text },
  }, sessionId);
  assert.equal(notionResult.isError, undefined);
  const page = JSON.parse(notionResult.content[0].text as string) as { id: string };
  assert.ok(page.id, 'notion page should have an id');

  // Verify call log shows both backend invocations
  const toolNames = fixture.getCallLog().map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(toolNames.includes('context7/query-docs'), 'context7 should have been called');
  assert.ok(toolNames.includes('notion/create_page'), 'notion should have been called');
});

// ── Scenario 11: Communication focus ─────────────────────────────────────────

test('scenario: communication focus — cast "send iMessage" resolves to imessage', async () => {
  const { aggregator } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'communication' });

  // Contains "imessage" as a word → fires exact serverId nameBonus on imessage/send_message,
  // ensuring it wins over other communication-profile tools with similar keyword scores.
  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'send text message via iMessage to team',
    confirm: true,
  });

  assert.equal(result.isError, undefined);
  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan');
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.equal(resolved.tool, 'imessage/send_message', `expected imessage/send_message, got ${resolved.tool}`);
  assert.ok((resolved.score ?? 0) > 0.1, `score should be >0.1, got ${resolved.score}`);
  assert.equal(cast.focus, 'communication');
});

test('scenario: communication focus — search "apple notes" marks chittymac tools inFocus', async () => {
  const { aggregator } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'communication' });

  // "apple notes" — both terms appear in chittymac descriptions ("Apple Notes"); search uses
  // all-terms filter (every term must be present), so only chittymac tools match.
  const resultWithFocus = await aggregator.callTool('ch1tty/search', {
    query: 'apple notes',
    focus: 'communication',
  });
  const resultNoFocus = await aggregator.callTool('ch1tty/search', {
    query: 'apple notes',
    focus: 'none',
  });

  assert.equal(resultWithFocus.isError, undefined);
  assert.equal(resultNoFocus.isError, undefined);

  const withFocus = parseSearch(resultWithFocus);
  const noFocus = parseSearch(resultNoFocus);

  // With communication focus, chittymac (Apple Notes) tools must rank first
  const withTools = withFocus.tools ?? [];
  assert.ok(withTools.length > 0, 'should return tools');
  assert.ok(
    withTools[0].tool.startsWith('chittymac/'),
    `first result with communication focus should be chittymac, got ${withTools[0].tool}`,
  );
  assert.equal(withTools[0].inFocus, true, 'top chittymac result should be marked inFocus');

  // Without focus, no inFocus markers
  const noFocusTools = noFocus.tools ?? [];
  assert.ok(!noFocusTools.some((t) => t.inFocus), 'no inFocus markers when focus is "none"');

  assert.equal(withFocus.focus, 'communication');
  assert.equal(noFocus.focus, undefined);
});

test('scenario: communication focus — multi-step: search meeting notes, create follow-up task', async () => {
  const { aggregator, fixture } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'communication' });
  const sessionId = 'scenario-session-comm-001';
  fixture.clearCallLog();

  // Step 1: search Apple Notes for meeting action items
  const notesResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'chittymac/search_notes',
    args: { query: 'team meeting action items' },
  }, sessionId);
  assert.equal(notesResult.isError, undefined);
  const notes = JSON.parse(notesResult.content[0].text as string) as Array<{ id: string; title: string }>;
  assert.ok(notes.length > 0, 'should return meeting notes');

  // Step 2: create a follow-up task based on meeting notes
  const taskResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'tasks/create_task',
    args: { entity_id: 'team', title: 'Follow up on deployment action items from team meeting' },
  }, sessionId);
  assert.equal(taskResult.isError, undefined);
  const task = JSON.parse(taskResult.content[0].text as string) as { id: string; status: string };
  assert.equal(task.status, 'open', 'created task should be open');

  // Both communication-profile backends (chittymac + tasks) were invoked
  const calls = fixture.getCallLog();
  const toolNames = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(toolNames.includes('chittymac/search_notes'), 'chittymac should have been called');
  assert.ok(toolNames.includes('tasks/create_task'), 'tasks should have been called');
});

test('resolvedBy: keyword-augmented tool wins after focus bias → resolvedBy=keyword despite brain route', async () => {
  // Brain returns a neon tool (wrong domain for a payment intent) while finance focus is
  // active. The keyword augmentation adds stripe/create_payment_intent (in-focus, 3/3 term
  // match), which scores higher after focus bias. resolvedBy must track the winner's origin
  // ('keyword'), not the overall castRoute ('brain').
  const fixture = new FixtureBackend();
  for (const [id, def] of Object.entries(FIXTURE_SERVERS)) {
    fixture.defineServer(id, def);
  }

  const brainResults: RoutedTool[] = [{
    tool: { namespacedName: 'neon/run_sql', description: 'Execute SQL on Neon database', category: 'code' },
    confidence: 0.9,
    reason: 'stub',
  }];

  const coordinator = new StubCoordinator(brainResults);
  const aggregator = new Aggregator(FIXTURE_CONFIGS, {
    focusProfiles: FOCUS_PROFILES,
    focus: 'finance',
    embedEnabled: false,
    coordinator,
    backendFactory: (config) => { fixture.registerServer(config); return fixture; },
  });

  // "create payment intent" → 3/3 keyword match for stripe/create_payment_intent
  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'create payment intent',
    confirm: true,
  });

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', 'should resolve to a plan');
  // The keyword-augmented stripe tool must win after focus boost over the brain's neon pick
  assert.equal(cast.resolved?.tool, 'stripe/create_payment_intent', 'stripe tool must win after focus bias');
  // Key assertion: resolvedBy must be keyword even though castRoute was brain
  assert.equal(cast.resolvedBy, 'keyword', 'winner came from keyword augmentation — must report keyword not brain');
});

// ── Scenario 12: Suggestions in cast:executed (real catalog) ─────────────────

test('scenario: suggestions — finance focus cast:executed includes real catalog suggestions', async () => {
  const { aggregator } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'finance' });

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list recent payments',
  });

  assert.equal(result.isError, undefined);
  const cast = parseCast(result);
  assert.equal(cast.cast, 'executed', `expected executed, got: ${cast.cast}`);
  assert.ok(cast.suggestions, 'cast:executed with finance focus must include suggestions from real catalog');
  const suggestions = cast.suggestions as { combos: Array<{ name: string; chain: string[] }>; prompts: Array<{ text: string }> };
  assert.ok(Array.isArray(suggestions.combos) && suggestions.combos.length > 0, 'suggestions.combos must be non-empty');
  assert.ok(Array.isArray(suggestions.prompts) && suggestions.prompts.length > 0, 'suggestions.prompts must be non-empty');
  assert.equal(cast.focus, 'finance');

  // All suggestion combos must reference at least one finance-relevant backend
  const financeBackends = new Set(['stripe', 'tasks', 'ledger', 'notion', 'thinking']);
  for (const combo of suggestions.combos) {
    const servers = combo.chain.map((t) => t.split('/')[0]);
    assert.ok(
      servers.some((s) => financeBackends.has(s)),
      `finance combo "${combo.name}" should reference a finance backend; chain: ${JSON.stringify(combo.chain)}`,
    );
  }
});

test('scenario: suggestions — cast:executed without focus has no suggestions field', async () => {
  const { aggregator } = buildAggregator(FIXTURE_CONFIGS);

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list database projects',
  });

  assert.equal(result.isError, undefined);
  const cast = parseCast(result);
  assert.equal(cast.cast, 'executed', `expected executed, got: ${cast.cast}`);
  assert.equal(cast.suggestions, undefined, 'cast:executed without focus must not include suggestions');
});

test('scenario: suggestions — governance focus cast:plan and cast:executed return same catalog suggestions', async () => {
  const { aggregator: aggPlan } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'governance' });
  const { aggregator: aggExec } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'governance' });

  const planResult = await aggPlan.callTool('ch1tty/cast', {
    intent: 'inspect database schema',
    confirm: true,
    focus: 'governance',
  });
  const execResult = await aggExec.callTool('ch1tty/cast', {
    intent: 'inspect database schema',
    focus: 'governance',
  });

  const plan = parseCast(planResult);
  const exec = parseCast(execResult);

  assert.equal(plan.cast, 'plan', `expected plan, got: ${plan.cast}`);
  assert.equal(exec.cast, 'executed', `expected executed, got: ${exec.cast}`);

  assert.ok(plan.suggestions, 'governance cast:plan must include suggestions');
  assert.ok(exec.suggestions, 'governance cast:executed must include suggestions');

  const planSugs = plan.suggestions as { combos: Array<{ name: string }>; prompts: Array<{ text: string }> };
  const execSugs = exec.suggestions as { combos: Array<{ name: string }>; prompts: Array<{ text: string }> };

  // Both paths hit the same getSuggestionsForFocus lookup — results must match
  assert.deepEqual(
    planSugs.combos.map((c) => c.name),
    execSugs.combos.map((c) => c.name),
    'cast:plan and cast:executed must return the same combo names from the catalog',
  );
  assert.deepEqual(
    planSugs.prompts.map((p) => p.text),
    execSugs.prompts.map((p) => p.text),
    'cast:plan and cast:executed must return the same prompt texts from the catalog',
  );
});

test('scenario: suggestions — per-call focus override propagates suggestions to cast:executed', async () => {
  // Aggregator has no default focus, but per-call focus overrides it.
  // Confirms that suggestions are tied to the resolved focus name (per-call wins).
  const { aggregator } = buildAggregator(FIXTURE_CONFIGS); // no default focus

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list recent payments',
    focus: 'finance',
  });

  assert.equal(result.isError, undefined);
  const cast = parseCast(result);
  assert.equal(cast.cast, 'executed', `expected executed, got: ${cast.cast}`);
  assert.ok(cast.suggestions, 'per-call focus:finance must produce suggestions in cast:executed');
  assert.equal(cast.focus, 'finance', 'focus field must report the per-call override');
  const suggestions = cast.suggestions as { combos: unknown[]; prompts: unknown[] };
  assert.ok(suggestions.combos.length > 0, 'per-call focus suggestions must have combos');
  assert.ok(suggestions.prompts.length > 0, 'per-call focus suggestions must have prompts');
});

// ── Scenario 13: Ops focus ────────────────────────────────────────────────────

test('scenario: ops focus — cast "deploy worker" resolves to cloudflare', async () => {
  const { aggregator } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'ops' });

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'deploy cloudflare worker script to production',
    confirm: true,
  });

  assert.equal(result.isError, undefined);
  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan');
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.equal(resolved.tool, 'cloudflare/deploy_worker', `expected cloudflare/deploy_worker, got ${resolved.tool}`);
  assert.ok((resolved.score ?? 0) > 0.1, `score should be >0.1, got ${resolved.score}`);
  assert.equal(cast.focus, 'ops');
});

test('scenario: ops focus boosts cloudflare over out-of-focus tools', async () => {
  const { aggregator } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'ops' });

  // "list workers" matches cloudflare/list_workers (in-focus) and should rank ahead of
  // out-of-focus tools like imessage or chittymac with similar keyword scores.
  const resultWithFocus = await aggregator.callTool('ch1tty/search', {
    query: 'list workers',
    focus: 'ops',
  });
  const resultNoFocus = await aggregator.callTool('ch1tty/search', {
    query: 'list workers',
    focus: 'none',
  });

  assert.equal(resultWithFocus.isError, undefined);
  assert.equal(resultNoFocus.isError, undefined);

  const withFocus = parseSearch(resultWithFocus);
  const noFocus = parseSearch(resultNoFocus);

  // With ops focus, cloudflare tools (in-focus) must rank first and be marked inFocus
  const withTools = withFocus.tools ?? [];
  assert.ok(withTools.length > 0, 'should return tools with ops focus');
  assert.ok(
    withTools[0].tool.startsWith('cloudflare/'),
    `first result with ops focus should be cloudflare, got ${withTools[0].tool}`,
  );
  assert.equal(withTools[0].inFocus, true, 'top cloudflare result should be marked inFocus');

  // Without focus, out-of-focus tools appear and no inFocus markers are set
  const noFocusTools = noFocus.tools ?? [];
  assert.ok(!noFocusTools.some((t) => t.inFocus), 'no inFocus markers when focus is "none"');

  assert.equal(withFocus.focus, 'ops');
  assert.equal(noFocus.focus, undefined);
});

test('scenario: ops focus — multi-step: list workers, inspect logs, document incident in notion', async () => {
  const { aggregator, fixture } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'ops' });
  const sessionId = 'scenario-session-ops-001';
  fixture.clearCallLog();

  // Step 1: list deployed workers to find the affected one
  const workersResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare/list_workers',
    args: {},
  }, sessionId);
  assert.equal(workersResult.isError, undefined);
  const workers = JSON.parse(workersResult.content[0].text as string) as Array<{ id: string; name: string; status: string }>;
  assert.ok(workers.length > 0, 'should return deployed workers');
  assert.ok(workers.some((w) => w.name === 'ch1tty-gateway'), 'ch1tty-gateway worker should be listed');

  // Step 2: pull logs from the affected worker
  const logsResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'cloudflare/get_worker_logs',
    args: { worker_name: 'ch1tty-gateway', limit: 20 },
  }, sessionId);
  assert.equal(logsResult.isError, undefined);
  const logData = JSON.parse(logsResult.content[0].text as string) as { worker: string; logs: Array<{ level: string; message: string }> };
  assert.equal(logData.worker, 'ch1tty-gateway', 'logs should be for ch1tty-gateway');
  const errors = logData.logs.filter((l) => l.level === 'error');
  assert.ok(errors.length > 0, 'should surface error-level log entries');

  // Step 3: create a Notion incident page documenting the issue
  const incidentResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'notion/create_page',
    args: {
      title: `Incident: ${logData.worker} backend timeout`,
      content: JSON.stringify({ errors, worker: logData.worker }),
    },
  }, sessionId);
  assert.equal(incidentResult.isError, undefined);
  const page = JSON.parse(incidentResult.content[0].text as string) as { id: string };
  assert.ok(page.id, 'incident Notion page should have an id');

  // Verify call log shows ops backends + notion were invoked
  const toolNames = fixture.getCallLog().map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(toolNames.includes('cloudflare/list_workers'), 'cloudflare/list_workers must have been called');
  assert.ok(toolNames.includes('cloudflare/get_worker_logs'), 'cloudflare/get_worker_logs must have been called');
  assert.ok(toolNames.includes('notion/create_page'), 'notion/create_page must have been called');
});

// ── Scenario 14: Ops REORDER probe ───────────────────────────────────────────

test('scenario: ops REORDER — without focus chittymac/list_notes wins on raw keyword score', async () => {
  // "list notes in filesystem folder" — terms: [list, notes, filesystem, folder]
  // chittymac/list_notes matches list+notes+folder = 3/4 = 0.75 (OOF for ops)
  // fs/list_directory matches list+filesystem = 2/4 = 0.50 (in-focus for ops)
  // Without focus the higher raw score wins → chittymac/list_notes at 0.75
  const { aggregator } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'none' });

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list notes in filesystem folder',
    focus: 'none',
    confirm: true,
  });

  assert.equal(result.isError, undefined);
  const cast = parseCast(result);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.equal(
    resolved.tool,
    'chittymac/list_notes',
    `without focus chittymac/list_notes (score 0.75) should win; got ${resolved.tool} (score ${resolved.score})`,
  );
  assert.ok(Math.abs((resolved.score ?? 0) - 0.75) < 0.05, `raw score should be ~0.75, got ${resolved.score}`);
});

test('scenario: ops REORDER — with ops focus fs/list_directory overtakes chittymac/list_notes', async () => {
  // With ops focus: fs is in-focus (servers list) → +0.50 boost
  // fs/list_directory: 2/4 + 0.50 = 1.00 → wins
  // chittymac/list_notes: 3/4 = 0.75, no boost (communication, OOF for ops) → loses
  const { aggregator } = buildAggregator(FIXTURE_CONFIGS, undefined, { focus: 'ops' });

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'list notes in filesystem folder',
    focus: 'ops',
    confirm: true,
  });

  assert.equal(result.isError, undefined);
  const cast = parseCast(result);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.equal(
    resolved.tool,
    'fs/list_directory',
    `with ops focus fs/list_directory (score 1.00) should win; got ${resolved.tool} (score ${resolved.score})`,
  );
  assert.ok((resolved.score ?? 0) >= 0.95, `boosted score should be ~1.00, got ${resolved.score}`);

  // OOF lens-not-gate: chittymac/list_notes must still be discoverable via search even
  // when ops focus is active. cast.alternatives is only top-3 runners-up, so with many
  // in-focus ecosystem tools tied at 0.75, chittymac may be pushed out of that slice.
  // Use ch1tty/search with a large limit to verify reachability independently.
  const searchResult = await aggregator.callTool('ch1tty/search', {
    query: 'notes folder',
    focus: 'ops',
    limit: 50,
  });
  assert.equal(searchResult.isError, undefined);
  const searchData = parseSearch(searchResult);
  assert.ok(
    (searchData.tools ?? []).some((t) => t.tool === 'chittymac/list_notes'),
    'chittymac/list_notes must remain discoverable via search (lens-not-gate) even when ops focus is active',
  );
});
