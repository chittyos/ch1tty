/**
 * GAO drift guard: freeze the `description` value type for resources items in cast responses.
 *
 * A ResourceEntry may carry a `description` field:
 *   interface ResourceEntry {
 *     uri: string;
 *     name: string;
 *     description?: string;
 *     mimeType?: string;
 *   }
 * (packages/shared-types/src/index.ts)
 *
 * The aggregator maps `description` through verbatim via:
 *   related.resources = scoredResources.map((r) => ({
 *     uri: r.uri,
 *     name: r.name,
 *     description: r.description,   // ← passthrough — no transformation
 *     mimeType: r.mimeType,
 *     score: r.score,
 *   }));
 * (src-stdio/aggregator.ts lines ~1407–1413)
 *
 * No prior G-series test exercises the resources `description` value type —
 * it appears in fixture definitions and passes through, but has never been
 * asserted for type or non-emptiness.
 *
 * Invariants frozen by GAO:
 *   1. cast:executed  — `description` is typeof 'string' when present (not number/object/etc).
 *   2. cast:executed  — `description` is non-empty (length > 0) when present.
 *   3. cast:executed  — a resource with no `description` in the fixture has `description`
 *                       absent or undefined in the output (absence passthrough preserved).
 *   4. cast:discovered — `description` is typeof 'string' and non-empty when present.
 *   5. cast:plan       — `description` is typeof 'string' and non-empty when present.
 *
 * Fixtures:
 *
 *   All tests use intent "list neon database projects" (4 terms).
 *
 *   TOOL_EXEC:   matched tool → cast:executed (GAO-1/2/3)
 *   TOOL_NOMATCH: unmatched tool → cast:discovered (GAO-4)
 *
 *   RESOURCE_WITH_DESC: has a description; description hits all 4 intent terms → score 1.0.
 *   RESOURCE_NO_DESC:   no description field; uri+name hit all 4 terms → score 1.0.
 *
 * Source refs:
 *   resources scoring:   src-stdio/aggregator.ts ~lines 1328–1337
 *   related.resources:   src-stdio/aggregator.ts ~lines 1407–1413
 *   cast:executed path:  src-stdio/aggregator.ts ~line 1666
 *   cast:discovered:     src-stdio/aggregator.ts ~line 1439
 *   cast:plan path:      src-stdio/aggregator.ts ~line 1617
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (resources description passthrough)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-gao-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(
  serverId: string,
  tools: unknown[],
  resources: unknown[],
): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer(serverId, { tools, prompts: [], resources });
  const path = dlq();
  const config: ServerConfig[] = [
    {
      id: serverId,
      name: serverId,
      type: 'remote',
      access: 'readwrite',
      category: 'code',
      endpoint: 'https://unused.example.com/mcp',
      lazy: true,
    },
  ];
  return new Aggregator(config, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

async function cast(agg: Aggregator, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// Intent: "list neon database projects" → 4 terms
const INTENT = 'list neon database projects';

// Tool that matches intent → cast:executed
const TOOL_EXEC = {
  name: 'list_neon_database_projects',
  description: 'List neon database projects',
  inputSchema: { type: 'object', properties: {} },
  response: { content: [{ type: 'text', text: '{"projects":[]}' }] },
};

// Tool that does NOT match → cast:discovered (no tools match, resources do)
const TOOL_NOMATCH = {
  name: 'write_local_file',
  description: 'Write content to a local filesystem path',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  response: { content: [{ type: 'text', text: '{"ok":true}' }] },
};

// Resource with description — description hits all 4 intent terms → score 1.0
const RESOURCE_WITH_DESC = {
  uri: 'neon://projects',
  name: 'Neon Projects',
  description: 'List neon database projects overview',
};

// Resource with no description — uri+name hit all 4 terms → score still 1.0
// haystack: "neon://projects/database/list list neon database projects"
const RESOURCE_NO_DESC = {
  uri: 'neon://projects/database/list',
  name: 'List Neon Database Projects',
  // no description
};

// ── GAO-1: cast:executed — description is typeof 'string' when present ───────

test('GAO-1: cast:executed resources item description is typeof string when present', async () => {
  const agg = makeAgg('gao-exec-1', [TOOL_EXEC], [RESOURCE_WITH_DESC]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be a non-empty array');
    let foundDescription = false;
    for (const item of resources) {
      const r = item as Record<string, unknown>;
      if ('description' in r && r['description'] !== undefined) {
        foundDescription = true;
        assert.equal(
          typeof r['description'],
          'string',
          `resources item description must be typeof 'string', got ${typeof r['description']}: ${JSON.stringify(r['description'])}`,
        );
      }
    }
    assert.ok(foundDescription, 'at least one resources item must carry a description field');
  } finally {
    await agg.shutdown();
  }
});

// ── GAO-2: cast:executed — description is non-empty when present ──────────────

test('GAO-2: cast:executed resources item description is non-empty string when present', async () => {
  const agg = makeAgg('gao-exec-2', [TOOL_EXEC], [RESOURCE_WITH_DESC]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be non-empty');
    let foundDescription = false;
    for (const item of resources) {
      const r = item as Record<string, unknown>;
      if ('description' in r && r['description'] !== undefined) {
        foundDescription = true;
        assert.equal(typeof r['description'], 'string', `description must be a string`);
        assert.ok(
          (r['description'] as string).length > 0,
          `resources item description must be non-empty, got empty string for uri "${r['uri']}"`,
        );
      }
    }
    assert.ok(foundDescription, 'at least one resources item must carry a description field');
  } finally {
    await agg.shutdown();
  }
});

// ── GAO-3: cast:executed — resource with no description → absent in output ───

test('GAO-3: cast:executed resource with no fixture description has no description in output', async () => {
  const agg = makeAgg('gao-exec-3', [TOOL_EXEC], [RESOURCE_NO_DESC]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be a non-empty array');
    // URIs are namespaced as "{serverId}://{originalUri}" by the aggregator
    const target = (resources as Record<string, unknown>[]).find(
      (r) => String(r['uri']).endsWith(RESOURCE_NO_DESC.uri),
    );
    assert.ok(target !== undefined, `resource with uri containing "${RESOURCE_NO_DESC.uri}" not found in resources output`);
    const hasDescription = 'description' in target && target['description'] !== undefined;
    assert.ok(
      !hasDescription,
      `resource with no fixture description must not carry description in output, got ${JSON.stringify(target['description'])}`,
    );
  } finally {
    await agg.shutdown();
  }
});

// ── GAO-4: cast:discovered — description is typeof 'string' and non-empty ────

test('GAO-4: cast:discovered resources item description is typeof string and non-empty when present', async () => {
  // TOOL_NOMATCH has no keyword overlap → best === undefined → cast:discovered
  const agg = makeAgg('gao-disc-4', [TOOL_NOMATCH], [RESOURCE_WITH_DESC]);
  try {
    const body = await cast(agg, { intent: INTENT });
    assert.equal(body['cast'], 'discovered', `expected cast:discovered, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'discovered resources must be a non-empty array');
    let foundDescription = false;
    for (const item of resources) {
      const r = item as Record<string, unknown>;
      if ('description' in r && r['description'] !== undefined) {
        foundDescription = true;
        assert.equal(
          typeof r['description'],
          'string',
          `discovered resources description must be typeof 'string', got ${typeof r['description']}`,
        );
        assert.ok(
          (r['description'] as string).length > 0,
          `discovered resources description must be non-empty for uri "${r['uri']}"`,
        );
      }
    }
    assert.ok(foundDescription, 'at least one discovered resources item must carry a description field');
  } finally {
    await agg.shutdown();
  }
});

// ── GAO-5: cast:plan — description is typeof 'string' and non-empty ──────────

test('GAO-5: cast:plan resources item description is typeof string and non-empty when present', async () => {
  const agg = makeAgg('gao-plan-5', [TOOL_EXEC], [RESOURCE_WITH_DESC]);
  try {
    const body = await cast(agg, { intent: INTENT, confirm: true });
    assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
    const resources = body['resources'] as unknown[];
    assert.ok(Array.isArray(resources) && resources.length > 0, 'plan resources must be a non-empty array');
    let foundDescription = false;
    for (const item of resources) {
      const r = item as Record<string, unknown>;
      if ('description' in r && r['description'] !== undefined) {
        foundDescription = true;
        assert.equal(
          typeof r['description'],
          'string',
          `plan resources description must be typeof 'string', got ${typeof r['description']}`,
        );
        assert.ok(
          (r['description'] as string).length > 0,
          `plan resources description must be non-empty for uri "${r['uri']}"`,
        );
      }
    }
    assert.ok(foundDescription, 'at least one plan resources item must carry a description field');
  } finally {
    await agg.shutdown();
  }
});
