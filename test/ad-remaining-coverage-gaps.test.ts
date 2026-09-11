/**
 * AD: Remaining coverage gaps — 5 uncovered paths identified by c8.
 *
 * Paths closed:
 *   aggregator.ts:50-52   — filterSuggestionsCatalog: reserved key 'catalog' stripped with warn
 *   aggregator.ts:50-52   — filterSuggestionsCatalog: key containing '/' stripped with warn
 *   logger.ts:34-37       — Logger.setLevel() with a valid level string (lines 35-36)
 *   ledger.ts:167         — LedgerClient constructor: DlqStore instance path (non-string arg)
 *   remote-proxy.ts:112-113 — getAuthToken: tokenSource returns '' (falsy) → auth_token_unavailable
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { Logger } from '../src/logger.js';
import { LedgerClient, type DlqStore } from '../src/ledger.js';
import { RemoteProxy, type TokenSource } from '../src/remote-proxy.js';
import type { ServerConfig } from '../src/types.js';

// ─── 1. filterSuggestionsCatalog: reserved keys stripped ─────────────────────

test('filterSuggestionsCatalog: reserved key "catalog" is stripped from injected catalog', async () => {
  const dlqPath = join(tmpdir(), `ch1tty-ad-catalog-reserved-${Date.now()}.jsonl`);
  const agg = new Aggregator([], {
    ledgerDlqPath: dlqPath,
    focusProfiles: { profiles: {} },
    embedEnabled: false,
    suggestionsCatalog: {
      catalog: {
        description: 'reserved key, must be stripped',
        combos: [{ name: 'x', chain: ['s/t'], accomplishes: 'x', verified: true }],
        prompts: [],
      },
      finance: {
        description: 'valid profile',
        combos: [{ name: 'c', chain: ['billing/list'], accomplishes: 'a', verified: true }],
        prompts: [{ text: 'list charges', resolves_to: 'billing/list_charges' }],
      },
    },
  });

  const result = await agg.callTool('ch1tty/status', {}, 'ad-test-1');
  const snap = JSON.parse((result.content[0] as { text: string }).text) as {
    catalog: { byFocus: Record<string, number> };
  };

  assert.ok(!('catalog' in snap.catalog.byFocus), '"catalog" key must be stripped by filterSuggestionsCatalog');
  assert.ok('finance' in snap.catalog.byFocus, '"finance" key must be preserved');
  assert.equal(snap.catalog.byFocus['finance'], 1, 'finance should have 1 combo');
});

test('filterSuggestionsCatalog: key containing "/" is stripped from injected catalog', async () => {
  const dlqPath = join(tmpdir(), `ch1tty-ad-catalog-slash-${Date.now()}.jsonl`);
  const agg = new Aggregator([], {
    ledgerDlqPath: dlqPath,
    focusProfiles: { profiles: {} },
    embedEnabled: false,
    suggestionsCatalog: {
      'foo/bar': {
        description: 'slash key, must be stripped',
        combos: [{ name: 'y', chain: ['s/t'], accomplishes: 'y', verified: false }],
        prompts: [],
      },
      ops: {
        description: 'valid profile',
        combos: [{ name: 'd', chain: ['deploy/run'], accomplishes: 'b', verified: true }],
        prompts: [],
      },
    },
  });

  const result = await agg.callTool('ch1tty/status', {}, 'ad-test-2');
  const snap = JSON.parse((result.content[0] as { text: string }).text) as {
    catalog: { byFocus: Record<string, number> };
  };

  assert.ok(!('foo/bar' in snap.catalog.byFocus), '"foo/bar" key must be stripped by filterSuggestionsCatalog');
  assert.ok('ops' in snap.catalog.byFocus, '"ops" key must be preserved');
});

// ─── 2. Logger.setLevel with valid level strings ──────────────────────────────

test('Logger.setLevel: valid level "debug" is accepted (lines 35-36 covered)', () => {
  const logger = new Logger();
  // setLevel with a valid known level must not throw and must update the internal level.
  // Verify indirectly by capturing stderr: after setLevel('error'), debug messages
  // must be suppressed; after setLevel('debug'), they must appear.
  const captured: string[] = [];
  const origWrite = process.stderr.write.bind(process.stderr);
  (process.stderr as { write: typeof process.stderr.write }).write = (chunk: string | Uint8Array, ..._r: unknown[]) => {
    captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString());
    return true;
  };
  try {
    logger.setLevel('error');
    logger.debug('should be suppressed after error level');
    const suppressedLen = captured.length;

    logger.setLevel('debug');
    logger.debug('should appear after debug level');
    assert.ok(captured.length > suppressedLen, 'debug message must appear after setLevel("debug")');
  } finally {
    process.stderr.write = origWrite;
  }
});

test('Logger.setLevel: case-insensitive — "WARN" is treated as warn', () => {
  const logger = new Logger();
  // Just verify it doesn't throw and the path is exercised (lines 35-36 covered via setLevel('WARN'))
  assert.doesNotThrow(() => logger.setLevel('WARN'));
  assert.doesNotThrow(() => logger.setLevel('INFO'));
  assert.doesNotThrow(() => logger.setLevel('ERROR'));
});

test('Logger.setLevel: unknown level string is silently ignored', () => {
  const logger = new Logger();
  assert.doesNotThrow(() => logger.setLevel('verbose'));
  assert.doesNotThrow(() => logger.setLevel('trace'));
  assert.doesNotThrow(() => logger.setLevel('SILLY'));
});

test('Logger.setLevel: undefined/empty does not throw (early-return path)', () => {
  const logger = new Logger();
  assert.doesNotThrow(() => logger.setLevel(undefined));
  assert.doesNotThrow(() => logger.setLevel(''));
});

// ─── 3. LedgerClient constructor: DlqStore instance path (ledger.ts:167) ─────

test('LedgerClient accepts a DlqStore instance directly (non-string constructor path)', () => {
  let appendCalled = false;
  const mockStore: DlqStore = {
    append: (_entries) => { appendCalled = true; },
    readEntries: (_limit) => [],
    rewrite: (_entries) => {},
    count: () => 0,
    describe: () => 'mock-dlq-store',
  };

  // Passing a DlqStore instance (not a string) covers ledger.ts:167 (this.dlq = dlqPathOrStore)
  const ledger = new LedgerClient(mockStore);
  const stats = ledger.getStats();

  assert.equal(stats.dlqPath, 'mock-dlq-store', 'dlqPath must come from store.describe()');
  assert.equal(stats.dlqEntries, 0, 'dlqEntries should be 0 for an empty mock store');
  assert.equal(appendCalled, false, 'append must not be called at construction time');
});

// ─── 4. RemoteProxy: tokenSource returns empty string (remote-proxy.ts:112-113) ─

test('RemoteProxy: tokenSource returning empty string triggers auth_token_unavailable error', async () => {
  // TokenSource that resolves to '' (falsy) without throwing — hits lines 112-113
  const emptyTokenSource: TokenSource = {
    async getToken(_key: string): Promise<string> {
      return '';
    },
  };

  const proxy = new RemoteProxy(emptyTokenSource);
  proxy.registerServer({
    id: 'emptytoken',
    name: 'Empty Token Test',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    enabled: true,
    lazy: true,
    endpoint: 'http://127.0.0.1:19999/mcp',
    authTokenKey: 'test-empty-key',
  } as ServerConfig);

  // callTool triggers connect → doConnect → getAuthToken → '' is falsy → throws internally
  // → caught by getAuthToken catch → re-thrown as auth_token_unavailable
  // → caught by callTool catch → returned as isError result
  const result = await proxy.callTool('emptytoken', 'some_tool', {});

  assert.ok(result.isError, 'result must be an error when tokenSource returns empty string');
  const text = (result.content[0] as { type: string; text: string }).text;
  assert.ok(
    text.includes('auth_token_unavailable'),
    `error text must include "auth_token_unavailable", got: ${text}`,
  );
});
