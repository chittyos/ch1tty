/**
 * GES drift guard: freeze cast:chain_executed sessionContext.recentTools item
 * VALUE CONSTRAINTS (namespaced format, non-empty, no duplicates, cap).
 *
 * GEI-4 froze that recentTools is an Array and each item is typeof string for
 * cast:chain_executed. GEI does NOT assert:
 *   - each item is non-empty
 *   - each item follows the namespaced 'serverId/toolName' format (exactly one '/')
 *   - the list has no duplicates after repeated calls
 *   - the list is capped at 5 items
 *
 * For comparison:
 *   GDY froze recentTools item types and constraints for cast:executed.
 *   GDU froze recentTools item types for ch1tty/execute.
 *   GEI-4 froze typeof string for chain_executed (does NOT freeze the above 4).
 *
 * Source: src-stdio/aggregator.ts (~line 1516) — chain_executed sessionContext:
 *   chainSessionContext = {
 *     recentTools: ctxPat.slice(0, 5).map((p) => p.tool),
 *     callCount:   ctxPat.reduce((s, p) => s + p.count, 0),
 *     ...(sfocus ? { activeSessionFocus: sfocus } : {}),
 *   };
 * p.tool is a namespaced 'serverId/toolName' string recorded by recordToolCall().
 * slice(0,5) caps the list.
 *
 * GES freezes:
 *
 *   GES-1  chain_executed + sessionId → every recentTools item is non-empty.
 *          (GEI-4 checks typeof string but NOT that the string is non-empty; a
 *           regression emitting empty-string items would pass GEI-4 silently.)
 *
 *   GES-2  chain_executed + sessionId → every recentTools item contains exactly
 *          one '/' character (namespaced 'serverId/toolName' format).
 *          (GEI-4 checks typeof string but NOT the namespace separator; a regression
 *           recording bare tool names without a server prefix would pass GEI-4.)
 *
 *   GES-3  chain_executed + sessionId → recentTools includes at least one item
 *          matching a tool in the executed chain (content reflects actual execution).
 *          (Sanity-bound: confirms the session recording round-trip is live, not
 *           a stubbed or empty list that happens to satisfy type checks.)
 *
 *   GES-4  after 3 chain_executed calls with the same sessionId →
 *          recentTools has no duplicate entries.
 *          (ctxPat.slice(0,5).map(p => p.tool) — p.tool is the UNIQUE tool
 *           entry key; the same tool can appear at most once in the top-5 list.)
 *
 *   GES-5  after 6 chain_executed calls with the same sessionId →
 *          recentTools length is at most 5 (slice(0,5) cap).
 *          (GEI checks Array type; no test checks the count invariant for
 *           chain_executed. A regression removing the slice would expose unbounded
 *           list growth to API clients.)
 *
 * Setup: keyword-only coordinator (no brain), code focus + neon chain catalog.
 * All steps return non-text content (resource blocks) so `summary` is absent.
 * All cast calls pass `chain: true` to trigger catalogCombo path.
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (sessionContext sub-object
 *     element constraints, not explanation fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CATALOG = {
  code: {
    description: 'Code focus',
    combos: [{
      name: 'neon-setup',
      chain: ['neon/list_projects', 'neon/create_project'],
      accomplishes: 'List then create a Neon project',
      verified: true,
    }],
    prompts: [],
  },
};

const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code' as const], servers: ['neon'], boost: 0.5 },
  },
};

const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true,
};

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-ges-${Date.now()}-${++_seq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'resource', resource: { uri: 'neon://projects', name: 'projects' } }] },
      },
      {
        name: 'create_project',
        description: 'create a neon database project',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        response: { content: [{ type: 'resource', resource: { uri: 'neon://project/new', name: 'new-project' } }] },
      },
    ],
  });
  const path = dlq();
  return new Aggregator([NEON_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: CATALOG,
    focusProfiles: FOCUS_PROFILES,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

const INTENT = 'list neon database projects';

async function chainExecutedWithSession(
  agg: Aggregator,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, chain: true, sessionId });
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'chain_executed',
    `expected cast:chain_executed, got cast="${String(body['cast'])}"`);
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GES-1: chain_executed sessionContext.recentTools items are non-empty strings', async () => {
  const agg = makeAgg();
  try {
    const body = await chainExecutedWithSession(agg, 'ges-s1');
    const ctx = body['sessionContext'] as Record<string, unknown>;
    assert.ok(ctx !== null && typeof ctx === 'object', 'sessionContext must be present');
    const items = ctx['recentTools'] as unknown[];
    assert.ok(Array.isArray(items), 'recentTools must be an Array');
    assert.ok(items.length > 0, 'recentTools must be non-empty after a chain execution');
    for (const item of items) {
      assert.equal(typeof item, 'string', `each item must be a string, got ${typeof item}`);
      assert.ok((item as string).length > 0, `each item must be non-empty, got empty string`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('GES-2: chain_executed sessionContext.recentTools items contain exactly one "/" (namespaced)', async () => {
  const agg = makeAgg();
  try {
    const body = await chainExecutedWithSession(agg, 'ges-s2');
    const ctx = body['sessionContext'] as Record<string, unknown>;
    const items = ctx['recentTools'] as string[];
    assert.ok(Array.isArray(items) && items.length > 0, 'recentTools must be a non-empty Array');
    for (const item of items) {
      const slashCount = (item.match(/\//g) ?? []).length;
      assert.equal(slashCount, 1,
        `item "${item}" must have exactly one '/' (namespaced serverId/toolName), got ${slashCount}`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('GES-3: chain_executed recentTools reflects at least one tool from the executed chain', async () => {
  const agg = makeAgg();
  try {
    const body = await chainExecutedWithSession(agg, 'ges-s3');
    const ctx = body['sessionContext'] as Record<string, unknown>;
    const items = ctx['recentTools'] as string[];
    assert.ok(Array.isArray(items) && items.length > 0, 'recentTools must be a non-empty Array');
    // The chain executes neon/list_projects and neon/create_project; at least one must appear.
    const chainTools = ['neon/list_projects', 'neon/create_project'];
    const hasChainTool = items.some((t) => chainTools.includes(t));
    assert.ok(hasChainTool,
      `recentTools must include at least one chain tool from ${JSON.stringify(chainTools)}; got ${JSON.stringify(items)}`);
  } finally {
    await agg.shutdown();
  }
});

test('GES-4: chain_executed recentTools has no duplicates after repeated calls with same sessionId', async () => {
  const agg = makeAgg();
  try {
    // Three calls with the same sessionId; ctxPat.slice(0,5).map(p => p.tool)
    // maps unique tool entries — each tool appears at most once in the top-5 list.
    await chainExecutedWithSession(agg, 'ges-s4');
    await chainExecutedWithSession(agg, 'ges-s4');
    const body = await chainExecutedWithSession(agg, 'ges-s4');
    const ctx = body['sessionContext'] as Record<string, unknown>;
    const items = ctx['recentTools'] as string[];
    assert.ok(Array.isArray(items), 'recentTools must be an Array');
    const unique = new Set(items);
    assert.equal(unique.size, items.length,
      `recentTools must have no duplicates; got ${JSON.stringify(items)}`);
  } finally {
    await agg.shutdown();
  }
});

test('GES-5: chain_executed recentTools length is at most 5 after many calls', async () => {
  const agg = makeAgg();
  try {
    // 6 calls accumulate session state; slice(0,5) caps the list at 5 items.
    for (let i = 0; i < 5; i++) {
      await chainExecutedWithSession(agg, 'ges-s5');
    }
    const body = await chainExecutedWithSession(agg, 'ges-s5');
    const ctx = body['sessionContext'] as Record<string, unknown>;
    const items = ctx['recentTools'] as unknown[];
    assert.ok(Array.isArray(items), 'recentTools must be an Array');
    assert.ok(items.length <= 5,
      `recentTools must be capped at 5 (slice(0,5)); got ${items.length}: ${JSON.stringify(items)}`);
  } finally {
    await agg.shutdown();
  }
});
