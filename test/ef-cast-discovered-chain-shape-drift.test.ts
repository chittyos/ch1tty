/**
 * EF: Drift guard — ch1tty/cast remaining path shapes.
 *
 * EA already freezes cast:executed / cast:plan / cast:resolved / cast:no_match.
 * This file freezes the two paths EA left uncovered:
 *
 * ── cast:discovered (tools: 0, prompts/resources: ≥ 1) ──────────────────────
 * Always-present: cast, resolvedBy, intent, latencyMs, hint
 * Conditional:    scope, explanation, sessionContext, suggestions,
 *                 prompts (array), resources (array)
 *
 * ── cast:chain_executed (chain:true + catalogCombo + ≥ 2 steps) ─────────────
 * Always-present: cast, resolvedBy, intent, latencyMs, latencyBreakdown,
 *                 focus (always truthy when catalogCombo non-null),
 *                 catalog (sub-object), steps (array)
 * Conditional:    explanation, summary, sessionContext, suggestions
 * catalog fields: name, chain, accomplishes
 * latencyBreakdown fields: scoringMs, executionMs, registryMs (+ brainMs when brain)
 *
 * ── Error path (intent absent / empty) ──────────────────────────────────────
 * isError:true, single text content item
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

const DISCOVERED_REQUIRED: readonly string[] = [
  'cast',
  'hint',
  'intent',
  'latencyMs',
  'resolvedBy',
];

// Permitted set for a minimal discovered (no focus/scope/explain/session/suggestions).
// Actual set must be a subset of this.
const DISCOVERED_PERMITTED: readonly string[] = [
  'cast',
  'hint',
  'intent',
  'latencyMs',
  'prompts',
  'resources',
  'resolvedBy',
];

const CHAIN_REQUIRED: readonly string[] = [
  'cast',
  'catalog',
  'focus',
  'intent',
  'latencyBreakdown',
  'latencyMs',
  'resolvedBy',
  'steps',
];

// Permitted set for a minimal chain_executed (no explain/sessionId).
// suggestions is always present when focusName is set and catalog[focusName] exists.
// summary is present when any step produces text output.
const CHAIN_PERMITTED: readonly string[] = [
  'cast',
  'catalog',
  'focus',
  'intent',
  'latencyBreakdown',
  'latencyMs',
  'resolvedBy',
  'steps',
  'suggestions',
  'summary',
];

const CATALOG_CHAIN_FIELDS: readonly string[] = ['accomplishes', 'chain', 'name'];

const LATENCY_BREAKDOWN_REQUIRED: readonly string[] = ['executionMs', 'registryMs', 'scoringMs'];

// ── Helpers ───────────────────────────────────────────────────────────────────

let dlqSeq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-ef-${Date.now()}-${++dlqSeq}.jsonl`);
}

// Coordinator that never routes via brain — keeps scoring deterministic.
class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// Aggregator that produces cast:discovered: one billing server with a prompt
// and resource matching "invoice", but whose tool description has zero overlap
// with the intent.
function makeDiscoveredAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('billing', {
    tools: [
      {
        name: 'create_subscription',
        description: 'create a new recurring subscription plan',
        inputSchema: { type: 'object' },
        response: { content: [{ type: 'text', text: 'ok' }] },
      },
    ],
    prompts: [
      { name: 'retrieve_invoice', description: 'retrieve and format an invoice for a customer' },
    ],
    resources: [],
  });
  const configs: ServerConfig[] = [{
    id: 'billing', name: 'Billing', type: 'remote', access: 'readwrite',
    category: 'ecosystem', endpoint: 'https://billing.test/mcp', lazy: true,
  }];
  const path = dlq();
  return new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: {},
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

// Aggregator that produces cast:chain_executed when intent matches 'list neon projects'
// with chain:true and focus:'code'.
const CHAIN_CATALOG = {
  code: {
    description: 'Code focus',
    combos: [{
      name: 'neon-setup',
      chain: ['neon/list_projects', 'neon/create_project'],
      accomplishes: 'List existing Neon projects then create a new one',
      verified: true,
    }],
    prompts: [],
  },
};

function makeChainAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon projects in the database',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'text', text: '["proj-1","proj-2"]' }] },
      },
      {
        name: 'create_project',
        description: 'create a new neon project database instance',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        response: { content: [{ type: 'text', text: '{"id":"proj-new"}' }] },
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
    suggestionsCatalog: CHAIN_CATALOG,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

async function cast(agg: Aggregator, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', args);
  assert.equal(result.isError, undefined, `cast must not error, got: ${JSON.stringify(result.content)}`);
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

// ── Suite 1: Structural invariants ────────────────────────────────────────────

describe('EF — cast structural invariants', () => {
  test('content is an array on cast:discovered', async () => {
    const agg = makeDiscoveredAgg();
    try {
      const result = await agg.callTool('ch1tty/cast', { intent: 'retrieve customer invoice document' });
      assert.ok(Array.isArray(result.content), 'content must be an array');
    } finally {
      await agg.shutdown();
    }
  });

  test('content is an array on cast:chain_executed', async () => {
    const agg = makeChainAgg();
    try {
      const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', chain: true });
      assert.ok(Array.isArray(result.content), 'content must be an array');
    } finally {
      await agg.shutdown();
    }
  });

  test('isError absent on cast:discovered success', async () => {
    const agg = makeDiscoveredAgg();
    try {
      const result = await agg.callTool('ch1tty/cast', { intent: 'retrieve customer invoice document' });
      assert.equal(result.isError, undefined, 'isError must be absent on discovered');
    } finally {
      await agg.shutdown();
    }
  });

  test('isError absent on cast:chain_executed success', async () => {
    const agg = makeChainAgg();
    try {
      const result = await agg.callTool('ch1tty/cast', { intent: 'list neon projects', chain: true });
      assert.equal(result.isError, undefined, 'isError must be absent on chain_executed');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 2: cast:discovered top-level shape ──────────────────────────────────

describe('EF — cast:discovered top-level shape', () => {
  test('cast value is "discovered"', async () => {
    const agg = makeDiscoveredAgg();
    try {
      const body = await cast(agg, { intent: 'retrieve customer invoice document' });
      assert.equal(body['cast'], 'discovered', `expected cast:discovered, got ${body['cast']}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('all required top-level keys present', async () => {
    const agg = makeDiscoveredAgg();
    try {
      const body = await cast(agg, { intent: 'retrieve customer invoice document' });
      assert.equal(body['cast'], 'discovered');
      const actual = Object.keys(body).sort();
      const missing = DISCOVERED_REQUIRED.filter((k) => !actual.includes(k));
      assert.deepEqual(missing, [], `Missing required keys from cast:discovered: ${missing.join(', ')}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('no unexpected top-level keys in minimal discovered response', async () => {
    const agg = makeDiscoveredAgg();
    try {
      const body = await cast(agg, { intent: 'retrieve customer invoice document' });
      assert.equal(body['cast'], 'discovered');
      const actual = Object.keys(body).sort();
      const unexpected = actual.filter((k) => !DISCOVERED_PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:discovered (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('hint is the expected static string', async () => {
    const agg = makeDiscoveredAgg();
    try {
      const body = await cast(agg, { intent: 'retrieve customer invoice document' });
      assert.equal(body['cast'], 'discovered');
      assert.equal(
        body['hint'],
        'No executable tools matched, but related prompts/resources found.',
        'discovered hint must match frozen string',
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('latencyMs is a non-negative number', async () => {
    const agg = makeDiscoveredAgg();
    try {
      const body = await cast(agg, { intent: 'retrieve customer invoice document' });
      assert.equal(body['cast'], 'discovered');
      assert.ok(
        typeof body['latencyMs'] === 'number' && (body['latencyMs'] as number) >= 0,
        `latencyMs must be non-negative, got ${body['latencyMs']}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('resolvedBy is a non-empty string', async () => {
    const agg = makeDiscoveredAgg();
    try {
      const body = await cast(agg, { intent: 'retrieve customer invoice document' });
      assert.equal(body['cast'], 'discovered');
      assert.ok(
        typeof body['resolvedBy'] === 'string' && (body['resolvedBy'] as string).length > 0,
        'resolvedBy must be a non-empty string',
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('intent echoes the original intent string', async () => {
    const agg = makeDiscoveredAgg();
    try {
      const intentIn = 'retrieve customer invoice document';
      const body = await cast(agg, { intent: intentIn });
      assert.equal(body['cast'], 'discovered');
      assert.equal(body['intent'], intentIn, 'intent must echo back the original intent');
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 3: cast:chain_executed top-level shape ──────────────────────────────

describe('EF — cast:chain_executed top-level shape', () => {
  test('cast value is "chain_executed"', async () => {
    const agg = makeChainAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', chain: true });
      assert.equal(body['cast'], 'chain_executed', `expected chain_executed, got ${body['cast']}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('all required top-level keys present', async () => {
    const agg = makeChainAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', chain: true });
      assert.equal(body['cast'], 'chain_executed');
      const actual = Object.keys(body).sort();
      const missing = CHAIN_REQUIRED.filter((k) => !actual.includes(k));
      assert.deepEqual(missing, [], `Missing required keys from cast:chain_executed: ${missing.join(', ')}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('no unexpected top-level keys in minimal chain_executed response', async () => {
    const agg = makeChainAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', chain: true });
      assert.equal(body['cast'], 'chain_executed');
      const actual = Object.keys(body).sort();
      const unexpected = actual.filter((k) => !CHAIN_PERMITTED.includes(k));
      assert.deepEqual(
        unexpected,
        [],
        `Unexpected keys in cast:chain_executed (shape drift): ${unexpected.join(', ')}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('focus is a non-empty string (always present on chain_executed)', async () => {
    const agg = makeChainAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', chain: true });
      assert.equal(body['cast'], 'chain_executed');
      assert.ok(
        typeof body['focus'] === 'string' && (body['focus'] as string).length > 0,
        'focus must be a non-empty string in chain_executed',
      );
    } finally {
      await agg.shutdown();
    }
  });

  test('catalog is an object with required fields', async () => {
    const agg = makeChainAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', chain: true });
      assert.equal(body['cast'], 'chain_executed');
      const catalog = body['catalog'] as Record<string, unknown>;
      assert.ok(catalog && typeof catalog === 'object' && !Array.isArray(catalog), 'catalog must be an object');
      const actual = Object.keys(catalog).sort();
      const missing = CATALOG_CHAIN_FIELDS.filter((k) => !actual.includes(k));
      assert.deepEqual(missing, [], `Missing keys from catalog in chain_executed: ${missing.join(', ')}`);
    } finally {
      await agg.shutdown();
    }
  });

  test('catalog.chain is an array of strings', async () => {
    const agg = makeChainAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', chain: true });
      assert.equal(body['cast'], 'chain_executed');
      const catalog = body['catalog'] as Record<string, unknown>;
      assert.ok(Array.isArray(catalog['chain']), 'catalog.chain must be an array');
      for (const step of catalog['chain'] as unknown[]) {
        assert.equal(typeof step, 'string', 'each catalog.chain entry must be a string');
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('steps is a non-empty array', async () => {
    const agg = makeChainAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', chain: true });
      assert.equal(body['cast'], 'chain_executed');
      assert.ok(Array.isArray(body['steps']) && (body['steps'] as unknown[]).length > 0, 'steps must be a non-empty array');
    } finally {
      await agg.shutdown();
    }
  });

  test('each step entry has step (number), tool (string), ok (boolean)', async () => {
    const agg = makeChainAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', chain: true });
      assert.equal(body['cast'], 'chain_executed');
      const steps = body['steps'] as Array<Record<string, unknown>>;
      for (const s of steps) {
        assert.equal(typeof s['step'], 'number', 'step.step must be a number');
        assert.equal(typeof s['tool'], 'string', 'step.tool must be a string');
        assert.equal(typeof s['ok'], 'boolean', 'step.ok must be a boolean');
      }
    } finally {
      await agg.shutdown();
    }
  });

  test('latencyBreakdown has required fields (scoringMs, executionMs, registryMs)', async () => {
    const agg = makeChainAgg();
    try {
      const body = await cast(agg, { intent: 'list neon projects', chain: true });
      assert.equal(body['cast'], 'chain_executed');
      const lb = body['latencyBreakdown'] as Record<string, unknown>;
      assert.ok(lb && typeof lb === 'object' && !Array.isArray(lb), 'latencyBreakdown must be an object');
      const actual = Object.keys(lb).sort();
      const missing = LATENCY_BREAKDOWN_REQUIRED.filter((k) => !actual.includes(k));
      assert.deepEqual(missing, [], `Missing keys from latencyBreakdown: ${missing.join(', ')}`);
      for (const k of LATENCY_BREAKDOWN_REQUIRED) {
        assert.ok(typeof lb[k] === 'number' && (lb[k] as number) >= 0, `latencyBreakdown.${k} must be non-negative number`);
      }
    } finally {
      await agg.shutdown();
    }
  });
});

// ── Suite 4: Error path ───────────────────────────────────────────────────────

describe('EF — cast error path (missing intent)', () => {
  test('isError:true when intent is empty string', async () => {
    const agg = new Aggregator([], {
      embedEnabled: false,
      ledgerDlqPath: dlq(),
      focusProfiles: { profiles: {} },
      suggestionsCatalog: {},
    });
    try {
      const result = await agg.callTool('ch1tty/cast', { intent: '' });
      assert.equal(result.isError, true, 'cast with empty intent must return isError:true');
    } finally {
      await agg.shutdown();
    }
  });

  test('isError:true when intent key is absent', async () => {
    const agg = new Aggregator([], {
      embedEnabled: false,
      ledgerDlqPath: dlq(),
      focusProfiles: { profiles: {} },
      suggestionsCatalog: {},
    });
    try {
      const result = await agg.callTool('ch1tty/cast', {});
      assert.equal(result.isError, true, 'cast without intent must return isError:true');
    } finally {
      await agg.shutdown();
    }
  });

  test('error response has exactly one content item', async () => {
    const agg = new Aggregator([], {
      embedEnabled: false,
      ledgerDlqPath: dlq(),
      focusProfiles: { profiles: {} },
      suggestionsCatalog: {},
    });
    try {
      const result = await agg.callTool('ch1tty/cast', { intent: '' });
      assert.equal(result.content.length, 1, 'error cast must have exactly one content item');
    } finally {
      await agg.shutdown();
    }
  });

  test('error response content item has type:text', async () => {
    const agg = new Aggregator([], {
      embedEnabled: false,
      ledgerDlqPath: dlq(),
      focusProfiles: { profiles: {} },
      suggestionsCatalog: {},
    });
    try {
      const result = await agg.callTool('ch1tty/cast', { intent: '' });
      const item = result.content[0] as Record<string, unknown>;
      assert.equal(item['type'], 'text', 'error cast content item must have type:text');
    } finally {
      await agg.shutdown();
    }
  });
});
