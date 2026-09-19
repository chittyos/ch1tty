/**
 * EQ: Drift guard — `scope` sub-object shape in cast responses.
 *
 * The scope annotation is constructed at aggregator lines 1348–1351:
 *   { ...(scopeServers ? { servers: scopeServers } : {}),
 *     ...(scopeCategories ? { categories: scopeCategories } : {}) }
 *
 * When scope is set in a cast call, the annotation appears on
 * cast:no_match, cast:resolved, cast:plan, and cast:executed responses.
 *
 * Frozen shape:
 *   PERMITTED: { categories, servers }
 *   servers    — string[] when present
 *   categories — string[] when present
 *
 * Frozen 2026-09-19.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

// ── Frozen field set ──────────────────────────────────────────────────────────

const SCOPE_PERMITTED: readonly string[] = ['categories', 'servers'];

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-eq-${Date.now()}-${++dlqSeq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('stripe', FIXTURE_SERVERS.stripe);
  const configs: ServerConfig[] = [
    { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true },
    { id: 'stripe', name: 'Stripe', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://stripe.com/mcp', lazy: true },
  ];
  const path = dlq();
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

function parseBody(result: { content: Array<{ type?: string; text?: unknown }> }): Record<string, unknown> {
  const first = result.content[0] as { type?: string; text?: unknown } | undefined;
  if (typeof first?.text !== 'string') throw new Error('No text content');
  return JSON.parse(first.text) as Record<string, unknown>;
}

// ── Suite 1: scope sub-object no-unexpected-keys ──────────────────────────────

describe('EQ — scope sub-object no-unexpected-keys (cast:no_match)', () => {
  test('scope with servers only has no unexpected keys', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'zzzzzzzzz_no_match_scope_test_xyz_9999',
      scope: { servers: ['nonexistent'] },
    });
    const body = parseBody(result);
    assert.equal(body['cast'], 'no_match', 'nonsense intent + nonexistent scope server → no_match');
    const scope = body['scope'] as Record<string, unknown>;
    assert.ok(scope !== null && typeof scope === 'object', 'scope must be present');
    const unexpected = Object.keys(scope).filter((k) => !SCOPE_PERMITTED.includes(k));
    assert.deepEqual(unexpected, [], `Unexpected keys in scope: ${unexpected.join(', ')}`);
    await agg.shutdown();
  });

  test('scope with categories only has no unexpected keys', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'zzzzzzzzz_no_match_scope_test_xyz_9999',
      scope: { categories: ['nonexistent'] },
    });
    const body = parseBody(result);
    assert.equal(body['cast'], 'no_match');
    const scope = body['scope'] as Record<string, unknown>;
    assert.ok(scope !== null && typeof scope === 'object', 'scope must be present');
    const unexpected = Object.keys(scope).filter((k) => !SCOPE_PERMITTED.includes(k));
    assert.deepEqual(unexpected, [], `Unexpected keys in scope: ${unexpected.join(', ')}`);
    await agg.shutdown();
  });

  test('scope with both servers and categories has no unexpected keys', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'zzzzzzzzz_no_match_scope_test_xyz_9999',
      scope: { servers: ['nonexistent'], categories: ['nonexistent'] },
    });
    const body = parseBody(result);
    assert.equal(body['cast'], 'no_match');
    const scope = body['scope'] as Record<string, unknown>;
    assert.ok(scope !== null && typeof scope === 'object', 'scope must be present');
    const unexpected = Object.keys(scope).filter((k) => !SCOPE_PERMITTED.includes(k));
    assert.deepEqual(unexpected, [], `Unexpected keys in scope: ${unexpected.join(', ')}`);
    await agg.shutdown();
  });
});

// ── Suite 2: scope field types ────────────────────────────────────────────────

describe('EQ — scope field types', () => {
  test('scope.servers is an array of strings when present', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list neon database projects',
      scope: { servers: ['nonexistent'] },
    });
    const body = parseBody(result);
    const scope = body['scope'] as Record<string, unknown>;
    assert.ok(Array.isArray(scope['servers']), 'scope.servers must be an array');
    for (const s of scope['servers'] as unknown[]) {
      assert.equal(typeof s, 'string', 'each scope.servers entry must be a string');
    }
    await agg.shutdown();
  });

  test('scope.categories is an array of strings when present', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list neon database projects',
      scope: { categories: ['nonexistent'] },
    });
    const body = parseBody(result);
    const scope = body['scope'] as Record<string, unknown>;
    assert.ok(Array.isArray(scope['categories']), 'scope.categories must be an array');
    for (const c of scope['categories'] as unknown[]) {
      assert.equal(typeof c, 'string', 'each scope.categories entry must be a string');
    }
    assert.deepEqual(scope['categories'], ['nonexistent'], 'scope.categories carries exactly the values passed');
    await agg.shutdown();
  });

  test('scope.servers carries exactly the values passed', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list neon database projects',
      scope: { servers: ['neon', 'stripe'] },
      dryRun: true,
    });
    const body = parseBody(result);
    const scope = body['scope'] as Record<string, unknown>;
    assert.deepEqual(scope['servers'], ['neon', 'stripe']);
    await agg.shutdown();
  });
});

// ── Suite 3: scope present in cast output paths ───────────────────────────────

describe('EQ — scope annotation present in cast paths when scope is set', () => {
  test('scope present in cast:resolved (dryRun:true)', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list neon database projects',
      scope: { servers: ['neon'] },
      dryRun: true,
    });
    const body = parseBody(result);
    assert.equal(body['cast'], 'resolved');
    assert.ok('scope' in body, 'scope must be present in cast:resolved when scope is set');
    await agg.shutdown();
  });

  test('scope present in cast:plan (confirm:true)', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list neon database projects',
      scope: { servers: ['neon'] },
      confirm: true,
    });
    const body = parseBody(result);
    assert.equal(body['cast'], 'plan');
    assert.ok('scope' in body, 'scope must be present in cast:plan when scope is set');
    await agg.shutdown();
  });

  test('scope present in cast:executed', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list neon database projects',
      scope: { servers: ['neon'] },
    });
    const body = parseBody(result);
    assert.equal(body['cast'], 'executed');
    assert.ok('scope' in body, 'scope must be present in cast:executed when scope is set');
    await agg.shutdown();
  });

  test('scope present in cast:no_match', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'zzzzzzzzz_no_match_scope_test_xyz_9999',
      scope: { servers: ['nonexistent'] },
    });
    const body = parseBody(result);
    assert.equal(body['cast'], 'no_match');
    assert.ok('scope' in body, 'scope must be present in cast:no_match when scope is set');
    await agg.shutdown();
  });
});

// ── Suite 4: scope absent when not set ───────────────────────────────────────

describe('EQ — scope annotation absent when scope is not set', () => {
  test('scope absent from cast:resolved when no scope param', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list neon database projects',
      dryRun: true,
    });
    const body = parseBody(result);
    assert.equal(body['cast'], 'resolved');
    assert.ok(!('scope' in body), 'scope must NOT appear in cast:resolved when scope is not set');
    await agg.shutdown();
  });

  test('scope absent from cast:plan when no scope param', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list neon database projects',
      confirm: true,
    });
    const body = parseBody(result);
    assert.equal(body['cast'], 'plan');
    assert.ok(!('scope' in body), 'scope must NOT appear in cast:plan when scope is not set');
    await agg.shutdown();
  });

  test('scope absent from cast:executed when no scope param', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list neon database projects',
    });
    const body = parseBody(result);
    assert.equal(body['cast'], 'executed');
    assert.ok(!('scope' in body), 'scope must NOT appear in cast:executed when scope is not set');
    await agg.shutdown();
  });

  test('scope absent from cast:no_match when no scope param', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'zzzzzzzzz_no_match_scope_test_xyz_9999',
    });
    const body = parseBody(result);
    assert.equal(body['cast'], 'no_match');
    assert.ok(!('scope' in body), 'scope must NOT appear in cast:no_match when scope is not set');
    await agg.shutdown();
  });
});
