/**
 * GAC drift guard: freeze that cast:plan, cast:executed, and cast:discovered
 * resources items carry a NON-EMPTY description when the fixture defines one.
 *
 * EO (plan/resolved) and EP (executed/discovered) each check:
 *   if ('description' in r) assert.equal(typeof r['description'], 'string')
 * Neither checks length > 0, so a refactor emitting description: '' (empty string)
 * for resources that have a real description in the fixture would pass EO/EP
 * silently but be caught by GAC.
 *
 * GAB froze the exact key set for resources items and confirmed that a resource
 * without mimeType has key set {description, name, score, uri}. GAC closes the
 * remaining value gap for the description field itself.
 *
 * Tests:
 *
 *   GAC-1  cast:plan resources: every item whose description key is present has a
 *           non-empty string value (typeof === 'string' && length > 0).
 *
 *   GAC-2  cast:plan resources: a fixture resource with a non-empty description is
 *           emitted with that EXACT description value in the output — not trimmed to
 *           empty, not replaced by name, not set to null or undefined.
 *
 *   GAC-3  cast:executed resources: every item whose description key is present has
 *           a non-empty string value.
 *
 *   GAC-4  cast:discovered resources: every item whose description key is present has
 *           a non-empty string value.
 *
 *   GAC-5  cast:executed resources: a fixture resource with a specific description
 *           is emitted with that exact description in the output (value preserved).
 *
 * Fixtures:
 *
 *   GAC-1/2 use a 'gac-plan' server:
 *     - tool 'list_project_resources': description 'List project resources by type and name'
 *       → scores 3/3 on 'list project resources' → cast:plan (confirm:true).
 *     - resource WITH mimeType 'project://resources/index': has description.
 *     - resource WITHOUT mimeType 'project://resources/list': has description.
 *
 *   GAC-3/5 use a 'gac-exec' server:
 *     - tool 'fetch_project_resources': description 'Fetch project resources list'
 *       → scores 3/3 on 'fetch project resources list' → cast:executed.
 *     - resource 'project://exec/resources': has description.
 *
 *   GAC-4 uses a 'gac-disc' server:
 *     - tool 'write_file_data': description 'Write data to a local file path'
 *       → no overlap with 'browse documentation resources catalog'
 *       → best === undefined → cast:discovered.
 *     - resource 'project://docs/browse': description contains all 4 intent terms
 *       → scores > 0 → appears in discovered.
 *
 * Actual description values probed 2026-09-21 — resources pass their description
 * field through unchanged from src-stdio/aggregator.ts line ~1410.
 *
 * URI note: the aggregator prefixes resource URIs with the server ID when constructing
 * related.resources (e.g. fixture uri 'project://resources/list' becomes
 * 'gac-plan2://project://resources/list'). GAC-2 and GAC-5 filter by URI substring
 * to isolate fixture resources from prepended suggestions catalog entries.
 *
 * Source: src-stdio/aggregator.ts
 *   resources map: lines ~1407–1413  (related.resources construction)
 *   cast:plan path: line ~1617        (confirm:true branch)
 *   cast:executed path: line ~1630    (execution result branch)
 *   cast:discovered path: line ~1439  (best===undefined branch)
 *
 * Frozen 2026-09-21.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (resources item value, not explain)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Fixture description constants (probed 2026-09-21) ────────────────────────

const PLAN_RESOURCE_WITH_MIMETYPE_DESCRIPTION = 'Index of project resources by type';
const PLAN_RESOURCE_NO_MIMETYPE_DESCRIPTION = 'List of project resources';
const EXEC_RESOURCE_DESCRIPTION = 'Executable project resources listing';
const DISC_RESOURCE_DESCRIPTION = 'Browse documentation resources catalog content';

// ── Helpers ───────────────────────────────────────────────────────────────────

let _seq = 0;

function dlq(): string {
  return join(tmpdir(), `ch1tty-gac-${Date.now()}-${++_seq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(serverId: string, serverDef: Parameters<FixtureBackend['defineServer']>[1], category: string): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer(serverId, serverDef);
  return new Aggregator(
    [
      {
        id: serverId,
        name: `GAC ${serverId} Service`,
        type: 'remote',
        access: 'readwrite',
        category,
        endpoint: `https://${serverId}.example/mcp`,
        lazy: true,
      } as ServerConfig,
    ],
    {
      backendFactory: () => backend,
      embedEnabled: false,
      ledgerDlqPath: dlq(),
      coordinator: new KeywordOnlyCoordinator(),
    },
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GAC-1: cast:plan resources description, when present, is a non-empty string', async () => {
  // EO checks typeof === 'string' when present. GAC-1 adds the length > 0 check.
  // A refactor emitting description: '' for resources would pass EO but fail GAC-1.
  const agg = makeAgg('gac-plan', {
    tools: [
      {
        name: 'list_project_resources',
        description: 'List project resources by type and name',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{"resources":[]}' }] },
      },
    ],
    resources: [
      {
        uri: 'project://resources/index',
        name: 'Project Resource Index',
        description: PLAN_RESOURCE_WITH_MIMETYPE_DESCRIPTION,
        mimeType: 'application/json',
      },
      {
        uri: 'project://resources/list',
        name: 'Project Resources Listing',
        description: PLAN_RESOURCE_NO_MIMETYPE_DESCRIPTION,
      },
    ],
  }, 'search');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list project resources', confirm: true });
    assert.equal(result.isError, undefined, 'cast:plan must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'plan', `expected cast:plan, got cast:${String(body['cast'])}`);
    const resources = body['resources'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(resources) && resources.length > 0,
      'cast:plan must include at least one resources item');

    for (const item of resources) {
      if ('description' in item) {
        assert.equal(typeof item['description'], 'string',
          `resources item.description must be a string, got ${typeof item['description']}`);
        assert.ok((item['description'] as string).length > 0,
          `resources item.description must be non-empty, got '' (fixture defines non-empty descriptions)`);
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAC-2: cast:plan resources: fixture description value is preserved exactly in output', async () => {
  // EO does not check that the description value is preserved from the fixture.
  // A bug replacing description with an empty string or trimming it would pass
  // EO (typeof check) and GAC-1 (length check) if it kept some characters, but
  // GAC-2 verifies the full value is unchanged.
  const agg = makeAgg('gac-plan2', {
    tools: [
      {
        name: 'list_project_resources',
        description: 'List project resources by type and name',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{"resources":[]}' }] },
      },
    ],
    resources: [
      {
        uri: 'project://resources/index',
        name: 'Project Resource Index',
        description: PLAN_RESOURCE_WITH_MIMETYPE_DESCRIPTION,
        mimeType: 'application/json',
      },
      {
        uri: 'project://resources/list',
        name: 'Project Resources Listing',
        description: PLAN_RESOURCE_NO_MIMETYPE_DESCRIPTION,
      },
    ],
  }, 'search');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'list project resources', confirm: true });
    assert.equal(result.isError, undefined, 'cast:plan must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'plan', `expected cast:plan, got cast:${String(body['cast'])}`);
    const resources = body['resources'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(resources) && resources.length > 0,
      'cast:plan must include at least one resources item');

    // Filter to fixture resources by URI prefix; suggestions catalog resources are also
    // prepended by listSuggestionResources() and have their own descriptions.
    // The aggregator prefixes resource URIs with the server ID (e.g. 'gac-plan2://...').
    const fixtureResources = resources.filter(
      (r) => typeof r['uri'] === 'string' && (r['uri'] as string).includes('project://resources/'),
    );
    assert.ok(fixtureResources.length > 0,
      'expected at least one fixture resources item with uri containing project://resources/ (fixture defines two)');

    const withMimeType = fixtureResources.filter((r) => 'mimeType' in r);
    assert.ok(withMimeType.length > 0,
      'expected at least one fixture resources item with mimeType (fixture defines one)');
    for (const item of withMimeType) {
      assert.equal(item['description'], PLAN_RESOURCE_WITH_MIMETYPE_DESCRIPTION,
        `resources item with mimeType: description must equal fixture value ` +
        `'${PLAN_RESOURCE_WITH_MIMETYPE_DESCRIPTION}', got '${String(item['description'])}'`);
    }

    const withoutMimeType = fixtureResources.filter((r) => !('mimeType' in r));
    assert.ok(withoutMimeType.length > 0,
      'expected at least one fixture resources item without mimeType (fixture defines one)');
    for (const item of withoutMimeType) {
      assert.equal(item['description'], PLAN_RESOURCE_NO_MIMETYPE_DESCRIPTION,
        `resources item without mimeType: description must equal fixture value ` +
        `'${PLAN_RESOURCE_NO_MIMETYPE_DESCRIPTION}', got '${String(item['description'])}'`);
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAC-3: cast:executed resources description, when present, is a non-empty string', async () => {
  // EP checks typeof === 'string' for cast:executed resources. GAC-3 adds length > 0.
  const agg = makeAgg('gac-exec', {
    tools: [
      {
        name: 'fetch_project_resources',
        description: 'Fetch project resources list',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{"items":[]}' }] },
      },
    ],
    resources: [
      {
        uri: 'project://exec/resources',
        name: 'Exec Project Resources',
        description: EXEC_RESOURCE_DESCRIPTION,
        mimeType: 'application/json',
      },
    ],
  }, 'search');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'fetch project resources list' });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'executed',
      `expected cast:executed, got cast:${String(body['cast'])}`);
    const resources = body['resources'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(resources) && resources.length > 0,
      'cast:executed must include at least one resources item (fixture defines one resource)');

    for (const item of resources) {
      if ('description' in item) {
        assert.equal(typeof item['description'], 'string',
          `resources item.description must be a string, got ${typeof item['description']}`);
        assert.ok((item['description'] as string).length > 0,
          `resources item.description must be non-empty (fixture defines '${EXEC_RESOURCE_DESCRIPTION}')`);
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAC-4: cast:discovered resources description, when present, is a non-empty string', async () => {
  // EP checks typeof === 'string' for cast:discovered resources. GAC-4 adds length > 0.
  // Uses a tool with no keyword overlap so best === undefined → cast:discovered.
  const agg = makeAgg('gac-disc', {
    tools: [
      {
        name: 'write_file_data',
        description: 'Write data to a local file path',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        response: { content: [{ type: 'text', text: '{"ok":true}' }] },
      },
    ],
    resources: [
      {
        uri: 'project://docs/browse',
        name: 'Documentation Browser',
        description: DISC_RESOURCE_DESCRIPTION,
        mimeType: 'text/html',
      },
    ],
  }, 'documents');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'browse documentation resources catalog' });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'discovered',
      `expected cast:discovered (tool 'write_file_data' has no overlap with intent), ` +
      `got cast:${String(body['cast'])}`);
    const resources = body['resources'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(resources) && resources.length > 0,
      'cast:discovered must include at least one resources item (fixture has one matching resource)');

    for (const item of resources) {
      if ('description' in item) {
        assert.equal(typeof item['description'], 'string',
          `resources item.description must be a string, got ${typeof item['description']}`);
        assert.ok((item['description'] as string).length > 0,
          `resources item.description must be non-empty (fixture defines '${DISC_RESOURCE_DESCRIPTION}')`);
      }
    }
  } finally {
    await agg.shutdown();
  }
});

test('GAC-5: cast:executed resources: fixture description is preserved exactly in output', async () => {
  // Mirrors GAC-2 for the cast:executed path. Verifies that the aggregator passes
  // the description through unchanged — not trimmed, not emptied, not replaced.
  const agg = makeAgg('gac-exec2', {
    tools: [
      {
        name: 'fetch_project_resources',
        description: 'Fetch project resources list',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '{"items":[]}' }] },
      },
    ],
    resources: [
      {
        uri: 'project://exec2/resources',
        name: 'Exec2 Project Resources',
        description: EXEC_RESOURCE_DESCRIPTION,
        mimeType: 'application/json',
      },
    ],
  }, 'search');
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: 'fetch project resources list' });
    assert.equal(result.isError, undefined, 'cast must not error');
    const body = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(body['cast'], 'executed',
      `expected cast:executed, got cast:${String(body['cast'])}`);
    const resources = body['resources'] as Array<Record<string, unknown>> | undefined;
    assert.ok(Array.isArray(resources) && resources.length > 0,
      'cast:executed must include the configured fixture resource');

    // Filter to fixture resources by URI substring; suggestions catalog resources are also
    // prepended by listSuggestionResources(). The aggregator prefixes URIs with server ID.
    const fixtureResources = resources.filter(
      (r) => typeof r['uri'] === 'string' && (r['uri'] as string).includes('project://exec2/'),
    );
    assert.ok(fixtureResources.length > 0,
      'expected the configured project://exec2/ fixture resource in cast:executed output');
    for (const item of fixtureResources) {
      if ('description' in item) {
        assert.equal(item['description'], EXEC_RESOURCE_DESCRIPTION,
          `resources item.description must equal fixture value ` +
          `'${EXEC_RESOURCE_DESCRIPTION}', got '${String(item['description'])}'`);
      }
    }
  } finally {
    await agg.shutdown();
  }
});
