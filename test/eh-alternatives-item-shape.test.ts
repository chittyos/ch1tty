/**
 * EH: Drift guard — alternatives item shape in cast:executed and cast:plan.
 *
 * EA + EG freeze the top-level permitted keys. EH freezes the ITEM shape
 * inside the alternatives array: each item must have exactly
 * { tool: string, score: number, description: string }.
 *
 * Source: aggregator.ts line ~1389
 *   const alternatives = scoredTools.slice(1, 4).map((t) => ({
 *     tool: t.namespacedName,
 *     score: t.score,
 *     description: t.description,
 *   }));
 *
 * Frozen field set per item (2026-09-19):
 *   tool          — string (namespaced: "server/toolName")
 *   score         — number
 *   description   — string
 *
 * Array constraints:
 *   - Length ≤ 3 (slice(1, 4) — up to 3 runners-up)
 *   - Absent (or empty) when no runners-up exist
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

const DLQ = join(tmpdir(), `ch1tty-eh-${Date.now()}.jsonl`);

// Multi-tool aggregator — enough tools that alternatives will be present
function makeMultiAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  backend.defineServer('tasks', FIXTURE_SERVERS.tasks);
  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
    { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
    { id: 'tasks', name: 'Tasks', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://tasks.chitty.cc/mcp', lazy: true },
  ];
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: DLQ,
  });
}

// Single-tool aggregator — only one tool registered; alternatives must be absent
function makeSingleAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [FIXTURE_SERVERS.neon.tools[0]], // only list_projects
  });
  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
  ];
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: join(tmpdir(), `ch1tty-eh-single-${Date.now()}.jsonl`),
  });
}

function parseBody(agg: Aggregator, intent: string, opts: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return agg.callTool('ch1tty/cast', { intent, ...opts }).then((result) => {
    assert.equal(result.isError, undefined, `cast returned isError for "${intent}": ${JSON.stringify(result.content)}`);
    return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
  });
}

// Frozen permitted keys for an alternatives item
const ALTERNATIVES_ITEM_PERMITTED: readonly string[] = ['tool', 'score', 'description'];

describe('EH — alternatives item shape in cast:executed', () => {
  test('alternatives is an array when present', async () => {
    const agg = makeMultiAgg();
    try {
      const body = await parseBody(agg, 'list database projects');
      assert.equal(body['cast'], 'executed');
      if ('alternatives' in body) {
        assert.ok(Array.isArray(body['alternatives']), 'alternatives must be an array when present');
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('alternatives array length is at most 3', async () => {
    const agg = makeMultiAgg();
    try {
      const body = await parseBody(agg, 'list database projects');
      assert.equal(body['cast'], 'executed');
      if (Array.isArray(body['alternatives'])) {
        assert.ok(
          (body['alternatives'] as unknown[]).length <= 3,
          `alternatives length must be ≤ 3, got ${(body['alternatives'] as unknown[]).length}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('each alternatives item has no unexpected keys', async () => {
    const agg = makeMultiAgg();
    try {
      const body = await parseBody(agg, 'list database projects');
      assert.equal(body['cast'], 'executed');
      const items = body['alternatives'] as Array<Record<string, unknown>> | undefined;
      if (!items || items.length === 0) return;
      for (const item of items) {
        const unexpected = Object.keys(item).filter((k) => !ALTERNATIVES_ITEM_PERMITTED.includes(k));
        assert.deepEqual(
          unexpected,
          [],
          `Unexpected keys in alternatives item (shape drift): ${unexpected.join(', ')}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('each alternatives item.tool is a non-empty string', async () => {
    const agg = makeMultiAgg();
    try {
      const body = await parseBody(agg, 'list database projects');
      assert.equal(body['cast'], 'executed');
      const items = body['alternatives'] as Array<Record<string, unknown>> | undefined;
      if (!items || items.length === 0) return;
      for (const item of items) {
        assert.ok(
          typeof item['tool'] === 'string' && (item['tool'] as string).length > 0,
          `alternatives item.tool must be a non-empty string, got ${JSON.stringify(item['tool'])}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('each alternatives item.tool contains a slash (namespaced)', async () => {
    const agg = makeMultiAgg();
    try {
      const body = await parseBody(agg, 'list database projects');
      assert.equal(body['cast'], 'executed');
      const items = body['alternatives'] as Array<Record<string, unknown>> | undefined;
      if (!items || items.length === 0) return;
      for (const item of items) {
        assert.ok(
          (item['tool'] as string).includes('/'),
          `alternatives item.tool must be namespaced (server/tool), got "${item['tool']}"`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('each alternatives item.score is a number', async () => {
    const agg = makeMultiAgg();
    try {
      const body = await parseBody(agg, 'list database projects');
      assert.equal(body['cast'], 'executed');
      const items = body['alternatives'] as Array<Record<string, unknown>> | undefined;
      if (!items || items.length === 0) return;
      for (const item of items) {
        assert.equal(
          typeof item['score'],
          'number',
          `alternatives item.score must be a number, got ${typeof item['score']}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('each alternatives item.description is a string', async () => {
    const agg = makeMultiAgg();
    try {
      const body = await parseBody(agg, 'list database projects');
      assert.equal(body['cast'], 'executed');
      const items = body['alternatives'] as Array<Record<string, unknown>> | undefined;
      if (!items || items.length === 0) return;
      for (const item of items) {
        assert.equal(
          typeof item['description'],
          'string',
          `alternatives item.description must be a string, got ${typeof item['description']}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('alternatives item.tool differs from the resolved tool', async () => {
    const agg = makeMultiAgg();
    try {
      const body = await parseBody(agg, 'list database projects');
      assert.equal(body['cast'], 'executed');
      const items = body['alternatives'] as Array<Record<string, unknown>> | undefined;
      if (!items || items.length === 0) return;
      const resolved = body['resolved'] as string;
      for (const item of items) {
        assert.notEqual(
          item['tool'],
          resolved,
          `alternatives item.tool must not equal the resolved tool (${resolved})`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('alternatives absent when only one tool registered', async () => {
    const agg = makeSingleAgg();
    try {
      const body = await parseBody(agg, 'list database projects');
      assert.equal(body['cast'], 'executed');
      assert.ok(
        !('alternatives' in body) || (body['alternatives'] as unknown[]).length === 0,
        'alternatives must be absent (or empty) when only one tool is registered',
      );
    } finally {
      await agg.shutdown();
    }
  });
});

describe('EH — alternatives item shape in cast:plan', () => {
  test('alternatives is an array when present in cast:plan', async () => {
    const agg = makeMultiAgg();
    try {
      const body = await parseBody(agg, 'list database projects', { confirm: true });
      assert.equal(body['cast'], 'plan');
      if ('alternatives' in body) {
        assert.ok(Array.isArray(body['alternatives']), 'cast:plan alternatives must be an array when present');
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:plan alternatives array length is at most 3', async () => {
    const agg = makeMultiAgg();
    try {
      const body = await parseBody(agg, 'list database projects', { confirm: true });
      assert.equal(body['cast'], 'plan');
      if (Array.isArray(body['alternatives'])) {
        assert.ok(
          (body['alternatives'] as unknown[]).length <= 3,
          `cast:plan alternatives length must be ≤ 3, got ${(body['alternatives'] as unknown[]).length}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('each cast:plan alternatives item has no unexpected keys', async () => {
    const agg = makeMultiAgg();
    try {
      const body = await parseBody(agg, 'list database projects', { confirm: true });
      assert.equal(body['cast'], 'plan');
      const items = body['alternatives'] as Array<Record<string, unknown>> | undefined;
      if (!items || items.length === 0) return;
      for (const item of items) {
        const unexpected = Object.keys(item).filter((k) => !ALTERNATIVES_ITEM_PERMITTED.includes(k));
        assert.deepEqual(
          unexpected,
          [],
          `Unexpected keys in cast:plan alternatives item (shape drift): ${unexpected.join(', ')}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('each cast:plan alternatives item.tool is namespaced', async () => {
    const agg = makeMultiAgg();
    try {
      const body = await parseBody(agg, 'list database projects', { confirm: true });
      assert.equal(body['cast'], 'plan');
      const items = body['alternatives'] as Array<Record<string, unknown>> | undefined;
      if (!items || items.length === 0) return;
      for (const item of items) {
        assert.ok(
          typeof item['tool'] === 'string' && (item['tool'] as string).includes('/'),
          `cast:plan alternatives item.tool must be namespaced, got "${item['tool']}"`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('each cast:plan alternatives item.score is a finite number', async () => {
    const agg = makeMultiAgg();
    try {
      const body = await parseBody(agg, 'list database projects', { confirm: true });
      assert.equal(body['cast'], 'plan');
      const items = body['alternatives'] as Array<Record<string, unknown>> | undefined;
      if (!items || items.length === 0) return;
      for (const item of items) {
        assert.ok(
          typeof item['score'] === 'number' && isFinite(item['score'] as number),
          `cast:plan alternatives item.score must be a finite number, got ${JSON.stringify(item['score'])}`,
        );
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('cast:plan alternatives absent when only one tool registered', async () => {
    const agg = makeSingleAgg();
    try {
      const body = await parseBody(agg, 'list database projects', { confirm: true });
      assert.equal(body['cast'], 'plan');
      assert.ok(
        !('alternatives' in body) || (body['alternatives'] as unknown[]).length === 0,
        'cast:plan alternatives must be absent (or empty) when only one tool is registered',
      );
    } finally {
      await agg.shutdown();
    }
  });
});
