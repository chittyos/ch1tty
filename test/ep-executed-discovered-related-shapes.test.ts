/**
 * EP: Drift guard — cast:executed and cast:discovered related.prompts and
 *     related.resources item shapes.
 *
 * EO froze these item shapes in the cast:plan path (aggregator line 1617).
 * The same `related` object (constructed at lines 1399–1414) is spread at
 * two additional code paths that EO did not exercise:
 *
 * ── cast:executed path (aggregator line 1666) ─────────────────────────────────
 * When the tool executes (confirm absent), related is spread into the
 * cast:executed response. The item shapes are identical to EO's frozen shapes,
 * but the code path is distinct. A refactor of either path could drift one
 * without breaking the other.
 *
 * ── cast:discovered path (aggregator line 1439) ───────────────────────────────
 * When no tool matches the intent but prompts/resources do (best === undefined,
 * scoredPrompts.length > 0 || scoredResources.length > 0), related is spread
 * into the cast:discovered response. This path is reached by using an intent
 * whose keywords appear in prompts/resources but not in any tool's metadata.
 *
 * ── Frozen field sets (same as EO — same construction, separate paths) ────────
 * Prompts item PERMITTED:  { arguments, description, name, score }
 * Prompts item REQUIRED:   { name, score }
 * Resources item PERMITTED: { description, mimeType, name, score, uri }
 * Resources item REQUIRED:  { name, score, uri }
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Frozen field sets ─────────────────────────────────────────────────────────

const PROMPTS_ITEM_PERMITTED: readonly string[] = ['arguments', 'description', 'name', 'score'];
const PROMPTS_ITEM_REQUIRED: readonly string[] = ['name', 'score'];

const RESOURCES_ITEM_PERMITTED: readonly string[] = ['description', 'mimeType', 'name', 'score', 'uri'];
const RESOURCES_ITEM_REQUIRED: readonly string[] = ['name', 'score', 'uri'];

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-ep-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// Backend with a tool, a prompt, and a resource that all score against
// the intent "list neon projects" (terms: "list", "neon", "projects").
// Used for cast:executed (tool resolves and executes, related context appears
// alongside the execution result).
function makeExecutedAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon projects in the database',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '["proj-1"]' }] },
      },
    ],
    prompts: [
      {
        name: 'neon-list',
        description: 'List neon projects template',
        arguments: [{ name: 'filter', description: 'Project name filter', required: false }],
      },
    ],
    resources: [
      {
        uri: 'neon://projects',
        name: 'Neon Projects',
        description: 'Listing of neon projects',
        mimeType: 'application/json',
      },
    ],
  });
  const configs: ServerConfig[] = [{
    id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite',
    category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true,
  }];
  const path = dlq();
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

// Backend where the tool does NOT match "retrieve neon project record"
// (tool name/description/serverName/category contain none of those terms),
// but the prompt and resource DO match (all 4 intent terms present).
// This ensures best === undefined → cast:discovered path.
//
// Intent terms (length > 2): ["retrieve", "neon", "project", "record"]
//
// Tool haystack: "fs/write_file write content to a local file filesystem filesystem"
//   → no match → score 0 → filtered out → best === undefined
//
// Prompt "neon-retrieve" with description "Template to retrieve neon project records":
//   → all 4 terms present → score 1.0
//
// Resource uri "neon://projects/record", name "Neon Project Record",
//   description "Retrieve neon project record details":
//   → all 4 terms present → score 1.0
function makeDiscoveredAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('fs', {
    tools: [
      {
        name: 'write_file',
        description: 'write content to a local file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        response: { content: [{ type: 'text', text: '{"ok":true}' }] },
      },
    ],
    prompts: [
      {
        name: 'neon-retrieve',
        description: 'Template to retrieve neon project records',
        arguments: [{ name: 'id', description: 'Project id', required: true }],
      },
    ],
    resources: [
      {
        uri: 'neon://projects/record',
        name: 'Neon Project Record',
        description: 'Retrieve neon project record details',
        mimeType: 'application/json',
      },
    ],
  });
  const configs: ServerConfig[] = [{
    id: 'fs', name: 'Filesystem', type: 'remote', access: 'readwrite',
    category: 'filesystem', endpoint: 'https://fs.example.com/mcp', lazy: true,
  }];
  const path = dlq();
  return new Aggregator(configs, {
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

// ── Suite 1: cast:executed related.prompts item shape ─────────────────────────

describe('EP — cast:executed related.prompts item shape', () => {
  test('related.prompts items have no unexpected keys in cast:executed', async () => {
    const agg = makeExecutedAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects' });
      assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
      assert.ok('prompts' in body, 'prompts must be present in cast:executed when backend has matching prompts');
      const prompts = body['prompts'] as unknown[];
      assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be a non-empty array');
      for (const item of prompts) {
        const p = item as Record<string, unknown>;
        const unexpected = Object.keys(p).filter((k) => !PROMPTS_ITEM_PERMITTED.includes(k));
        assert.deepEqual(
          unexpected,
          [],
          `Unexpected keys in cast:executed prompts item (shape drift): ${unexpected.join(', ')}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('related.prompts items have all required keys in cast:executed', async () => {
    const agg = makeExecutedAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects' });
      assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
      const prompts = body['prompts'] as unknown[];
      assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be present and non-empty');
      for (const item of prompts) {
        const p = item as Record<string, unknown>;
        for (const key of PROMPTS_ITEM_REQUIRED) {
          assert.ok(key in p, `cast:executed prompts item must have required key "${key}"`);
        }
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('related.prompts item field types are correct in cast:executed', async () => {
    const agg = makeExecutedAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects' });
      assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
      const prompts = body['prompts'] as unknown[];
      assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be present and non-empty');
      for (const item of prompts) {
        const p = item as Record<string, unknown>;
        assert.ok(typeof p['name'] === 'string' && (p['name'] as string).length > 0, 'prompts item.name must be a non-empty string');
        assert.ok(typeof p['score'] === 'number' && (p['score'] as number) >= 0, 'prompts item.score must be a non-negative number');
        if ('description' in p) {
          assert.equal(typeof p['description'], 'string', 'prompts item.description must be a string when present');
        }
        if ('arguments' in p) {
          assert.ok(Array.isArray(p['arguments']), 'prompts item.arguments must be an array when present');
        }
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: cast:executed related.resources item shape ───────────────────────

describe('EP — cast:executed related.resources item shape', () => {
  test('related.resources items have no unexpected keys in cast:executed', async () => {
    const agg = makeExecutedAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects' });
      assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
      assert.ok('resources' in body, 'resources must be present in cast:executed when backend has matching resources');
      const resources = body['resources'] as unknown[];
      assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be a non-empty array');
      for (const item of resources) {
        const r = item as Record<string, unknown>;
        const unexpected = Object.keys(r).filter((k) => !RESOURCES_ITEM_PERMITTED.includes(k));
        assert.deepEqual(
          unexpected,
          [],
          `Unexpected keys in cast:executed resources item (shape drift): ${unexpected.join(', ')}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('related.resources items have all required keys in cast:executed', async () => {
    const agg = makeExecutedAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects' });
      assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
      const resources = body['resources'] as unknown[];
      assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be present and non-empty');
      for (const item of resources) {
        const r = item as Record<string, unknown>;
        for (const key of RESOURCES_ITEM_REQUIRED) {
          assert.ok(key in r, `cast:executed resources item must have required key "${key}"`);
        }
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('related.resources item field types are correct in cast:executed', async () => {
    const agg = makeExecutedAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects' });
      assert.equal(body['cast'], 'executed', `expected cast:executed, got ${body['cast']}`);
      const resources = body['resources'] as unknown[];
      assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be present and non-empty');
      for (const item of resources) {
        const r = item as Record<string, unknown>;
        assert.ok(typeof r['uri'] === 'string' && (r['uri'] as string).length > 0, 'resources item.uri must be a non-empty string');
        assert.ok(typeof r['name'] === 'string' && (r['name'] as string).length > 0, 'resources item.name must be a non-empty string');
        assert.ok(typeof r['score'] === 'number' && (r['score'] as number) >= 0, 'resources item.score must be a non-negative number');
        if ('description' in r) {
          assert.equal(typeof r['description'], 'string', 'resources item.description must be a string when present');
        }
        if ('mimeType' in r) {
          assert.equal(typeof r['mimeType'], 'string', 'resources item.mimeType must be a string when present');
        }
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 3: cast:discovered related.prompts item shape ───────────────────────

describe('EP — cast:discovered related.prompts item shape', () => {
  test('related.prompts items have no unexpected keys in cast:discovered', async () => {
    const agg = makeDiscoveredAgg();
    try {
      const body = await cast(agg, { intent: 'retrieve neon project record' });
      assert.equal(body['cast'], 'discovered', `expected cast:discovered, got ${body['cast']}`);
      assert.ok('prompts' in body, 'prompts must be present in cast:discovered when backend has matching prompts');
      const prompts = body['prompts'] as unknown[];
      assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be a non-empty array');
      for (const item of prompts) {
        const p = item as Record<string, unknown>;
        const unexpected = Object.keys(p).filter((k) => !PROMPTS_ITEM_PERMITTED.includes(k));
        assert.deepEqual(
          unexpected,
          [],
          `Unexpected keys in cast:discovered prompts item (shape drift): ${unexpected.join(', ')}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('related.prompts items have all required keys in cast:discovered', async () => {
    const agg = makeDiscoveredAgg();
    try {
      const body = await cast(agg, { intent: 'retrieve neon project record' });
      assert.equal(body['cast'], 'discovered', `expected cast:discovered, got ${body['cast']}`);
      const prompts = body['prompts'] as unknown[];
      assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be present and non-empty');
      for (const item of prompts) {
        const p = item as Record<string, unknown>;
        for (const key of PROMPTS_ITEM_REQUIRED) {
          assert.ok(key in p, `cast:discovered prompts item must have required key "${key}"`);
        }
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('related.prompts item field types are correct in cast:discovered', async () => {
    const agg = makeDiscoveredAgg();
    try {
      const body = await cast(agg, { intent: 'retrieve neon project record' });
      assert.equal(body['cast'], 'discovered', `expected cast:discovered, got ${body['cast']}`);
      const prompts = body['prompts'] as unknown[];
      assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be present and non-empty');
      for (const item of prompts) {
        const p = item as Record<string, unknown>;
        assert.ok(typeof p['name'] === 'string' && (p['name'] as string).length > 0, 'prompts item.name must be a non-empty string');
        assert.ok(typeof p['score'] === 'number' && (p['score'] as number) >= 0, 'prompts item.score must be a non-negative number');
        if ('description' in p) {
          assert.equal(typeof p['description'], 'string', 'prompts item.description must be a string when present');
        }
        if ('arguments' in p) {
          assert.ok(Array.isArray(p['arguments']), 'prompts item.arguments must be an array when present');
        }
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 4: cast:discovered related.resources item shape ─────────────────────

describe('EP — cast:discovered related.resources item shape', () => {
  test('related.resources items have no unexpected keys in cast:discovered', async () => {
    const agg = makeDiscoveredAgg();
    try {
      const body = await cast(agg, { intent: 'retrieve neon project record' });
      assert.equal(body['cast'], 'discovered', `expected cast:discovered, got ${body['cast']}`);
      assert.ok('resources' in body, 'resources must be present in cast:discovered when backend has matching resources');
      const resources = body['resources'] as unknown[];
      assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be a non-empty array');
      for (const item of resources) {
        const r = item as Record<string, unknown>;
        const unexpected = Object.keys(r).filter((k) => !RESOURCES_ITEM_PERMITTED.includes(k));
        assert.deepEqual(
          unexpected,
          [],
          `Unexpected keys in cast:discovered resources item (shape drift): ${unexpected.join(', ')}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('related.resources items have all required keys in cast:discovered', async () => {
    const agg = makeDiscoveredAgg();
    try {
      const body = await cast(agg, { intent: 'retrieve neon project record' });
      assert.equal(body['cast'], 'discovered', `expected cast:discovered, got ${body['cast']}`);
      const resources = body['resources'] as unknown[];
      assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be present and non-empty');
      for (const item of resources) {
        const r = item as Record<string, unknown>;
        for (const key of RESOURCES_ITEM_REQUIRED) {
          assert.ok(key in r, `cast:discovered resources item must have required key "${key}"`);
        }
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('related.resources item field types are correct in cast:discovered', async () => {
    const agg = makeDiscoveredAgg();
    try {
      const body = await cast(agg, { intent: 'retrieve neon project record' });
      assert.equal(body['cast'], 'discovered', `expected cast:discovered, got ${body['cast']}`);
      const resources = body['resources'] as unknown[];
      assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be present and non-empty');
      for (const item of resources) {
        const r = item as Record<string, unknown>;
        assert.ok(typeof r['uri'] === 'string' && (r['uri'] as string).length > 0, 'resources item.uri must be a non-empty string');
        assert.ok(typeof r['name'] === 'string' && (r['name'] as string).length > 0, 'resources item.name must be a non-empty string');
        assert.ok(typeof r['score'] === 'number' && (r['score'] as number) >= 0, 'resources item.score must be a non-negative number');
        if ('description' in r) {
          assert.equal(typeof r['description'], 'string', 'resources item.description must be a string when present');
        }
        if ('mimeType' in r) {
          assert.equal(typeof r['mimeType'], 'string', 'resources item.mimeType must be a string when present');
        }
      }
    } finally {
      await agg.shutdown();
    }
  });
});
