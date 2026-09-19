/**
 * EO: Drift guard — cast:plan resolved sub-object shape,
 *     cast:plan related.prompts item shape, and
 *     cast:plan related.resources item shape.
 *
 * Three sub-object shapes in cast:plan that share the same code path
 * (aggregator lines 1596–1624) but were never independently frozen:
 *
 * ── cast:plan resolved sub-object ────────────────────────────────────────────
 * Constructed at aggregator lines 1606–1613:
 *   { tool: best.namespacedName, server: best.serverId, category: best.category,
 *     description: best.description, score: best.score, inputSchema: best.inputSchema }
 * EXACT: { category, description, inputSchema, score, server, tool }
 *
 * ── cast:plan related.prompts item shape ─────────────────────────────────────
 * Constructed at aggregator lines 1399–1404 (shared related object, spread at line 1617):
 *   { name: p.name, description: p.description, arguments: p.arguments, score: p.score }
 * PERMITTED: { name, description, arguments, score }
 * REQUIRED:  { name, score }
 *
 * ── cast:plan related.resources item shape ───────────────────────────────────
 * Constructed at aggregator lines 1407–1413 (same related object, spread at line 1617):
 *   { uri: r.uri, name: r.name, description: r.description, mimeType: r.mimeType, score: r.score }
 * PERMITTED: { uri, name, description, mimeType, score }
 * REQUIRED:  { uri, name, score }
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

const RESOLVED_EXACT: readonly string[] = ['category', 'description', 'inputSchema', 'score', 'server', 'tool'];

const PROMPTS_ITEM_PERMITTED: readonly string[] = ['arguments', 'description', 'name', 'score'];
const PROMPTS_ITEM_REQUIRED: readonly string[] = ['name', 'score'];

const RESOURCES_ITEM_PERMITTED: readonly string[] = ['description', 'mimeType', 'name', 'score', 'uri'];
const RESOURCES_ITEM_REQUIRED: readonly string[] = ['name', 'score', 'uri'];

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-eo-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// Backend with a tool, a prompt, and a resource that all score against
// the intent "list neon projects" (terms: "list", "neon", "projects").
// - Prompt "neon-list" with description "List neon projects template" scores 1.0
// - Resource uri "neon://projects", name "Neon Projects", description
//   "Listing of neon projects" scores 1.0 ("listing".includes("list") === true)
function makePlanAgg(): Aggregator {
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

async function cast(agg: Aggregator, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── Suite 1: cast:plan resolved sub-object shape ──────────────────────────────

describe('EO — cast:plan resolved sub-object shape', () => {
  test('resolved has no unexpected keys in cast:plan', async () => {
    const agg = makePlanAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', confirm: true });
      assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
      assert.ok('resolved' in body, 'resolved must be present in cast:plan response');
      const resolved = body['resolved'] as Record<string, unknown>;
      assert.ok(resolved && typeof resolved === 'object' && !Array.isArray(resolved), 'resolved must be an object');
      const unexpected = Object.keys(resolved).filter((k) => !RESOLVED_EXACT.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:plan resolved (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('resolved has exactly the frozen field set in cast:plan', async () => {
    const agg = makePlanAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', confirm: true });
      assert.equal(body['cast'], 'plan');
      const resolved = body['resolved'] as Record<string, unknown>;
      const actual = Object.keys(resolved).sort();
      assert.deepEqual(
        actual,
        [...RESOLVED_EXACT].sort(),
        `cast:plan resolved fields have drifted.\nActual: ${actual.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('resolved field types are correct in cast:plan', async () => {
    const agg = makePlanAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', confirm: true });
      assert.equal(body['cast'], 'plan');
      const resolved = body['resolved'] as Record<string, unknown>;
      assert.ok(typeof resolved['tool'] === 'string' && (resolved['tool'] as string).length > 0, 'resolved.tool must be a non-empty string');
      assert.ok(typeof resolved['server'] === 'string' && (resolved['server'] as string).length > 0, 'resolved.server must be a non-empty string');
      assert.ok(typeof resolved['category'] === 'string' && (resolved['category'] as string).length > 0, 'resolved.category must be a non-empty string');
      assert.ok(typeof resolved['description'] === 'string', 'resolved.description must be a string');
      assert.ok(typeof resolved['score'] === 'number' && (resolved['score'] as number) >= 0, 'resolved.score must be a non-negative number');
      assert.ok(resolved['inputSchema'] && typeof resolved['inputSchema'] === 'object' && !Array.isArray(resolved['inputSchema']), 'resolved.inputSchema must be an object');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: cast:plan related.prompts item shape ─────────────────────────────

describe('EO — cast:plan related.prompts item shape', () => {
  test('related.prompts items have no unexpected keys in cast:plan', async () => {
    const agg = makePlanAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', confirm: true });
      assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
      assert.ok('prompts' in body, 'prompts must be present in cast:plan when backend has matching prompts');
      const prompts = body['prompts'] as unknown[];
      assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be a non-empty array');
      for (const item of prompts) {
        const p = item as Record<string, unknown>;
        const unexpected = Object.keys(p).filter((k) => !PROMPTS_ITEM_PERMITTED.includes(k));
        assert.deepEqual(
          unexpected,
          [],
          `Unexpected keys in cast:plan prompts item (shape drift): ${unexpected.join(', ')}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('related.prompts items have all required keys in cast:plan', async () => {
    const agg = makePlanAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', confirm: true });
      assert.equal(body['cast'], 'plan');
      const prompts = body['prompts'] as unknown[];
      assert.ok(Array.isArray(prompts) && prompts.length > 0, 'prompts must be present and non-empty');
      for (const item of prompts) {
        const p = item as Record<string, unknown>;
        for (const key of PROMPTS_ITEM_REQUIRED) {
          assert.ok(key in p, `prompts item must have required key "${key}"`);
        }
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('related.prompts item field types are correct in cast:plan', async () => {
    const agg = makePlanAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', confirm: true });
      assert.equal(body['cast'], 'plan');
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

// ── Suite 3: cast:plan related.resources item shape ───────────────────────────

describe('EO — cast:plan related.resources item shape', () => {
  test('related.resources items have no unexpected keys in cast:plan', async () => {
    const agg = makePlanAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', confirm: true });
      assert.equal(body['cast'], 'plan', `expected cast:plan, got ${body['cast']}`);
      assert.ok('resources' in body, 'resources must be present in cast:plan when backend has matching resources');
      const resources = body['resources'] as unknown[];
      assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be a non-empty array');
      for (const item of resources) {
        const r = item as Record<string, unknown>;
        const unexpected = Object.keys(r).filter((k) => !RESOURCES_ITEM_PERMITTED.includes(k));
        assert.deepEqual(
          unexpected,
          [],
          `Unexpected keys in cast:plan resources item (shape drift): ${unexpected.join(', ')}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('related.resources items have all required keys in cast:plan', async () => {
    const agg = makePlanAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', confirm: true });
      assert.equal(body['cast'], 'plan');
      const resources = body['resources'] as unknown[];
      assert.ok(Array.isArray(resources) && resources.length > 0, 'resources must be present and non-empty');
      for (const item of resources) {
        const r = item as Record<string, unknown>;
        for (const key of RESOURCES_ITEM_REQUIRED) {
          assert.ok(key in r, `resources item must have required key "${key}"`);
        }
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('related.resources item field types are correct in cast:plan', async () => {
    const agg = makePlanAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', confirm: true });
      assert.equal(body['cast'], 'plan');
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
