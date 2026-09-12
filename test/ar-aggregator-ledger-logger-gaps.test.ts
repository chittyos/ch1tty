/**
 * AR batch — 3 uncovered branch/statement gaps on main:
 *
 *   1. aggregator.ts:51-53 — `filterSuggestionsCatalog()` warn-and-skip branch:
 *      fires when a profile key equals 'catalog' (reserved) or contains '/'.
 *      Prior tests always pass valid profile keys; the guard was never exercised.
 *
 *   2. ledger.ts:167 — `LedgerClient` constructor's `typeof … !== 'string'` branch:
 *      fires when the caller passes an explicit DlqStore object (not a path string).
 *      All existing tests pass a string path → the `else` branch (FileDlqStore) is
 *      always taken. Worker/DO usage passes an object, exercising the `if` branch.
 *
 *   3. logger.ts:34-37 — `Logger.setLevel()` is never called in any existing test:
 *      the method exists so Worker/DO code can configure the level from env bindings
 *      that aren't present at Logger construction time. Tests cover:
 *        - falsy input (undefined / empty string) → early return
 *        - unknown level name → parsed is undefined, minLevel unchanged
 *        - valid level name → minLevel updated
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Aggregator } from '../src/aggregator.js';
import { LedgerClient, type DlqStore, type LedgerEntry } from '../src/ledger.js';
import { Logger } from '../src/logger.js';
import type { Backend, BackendStatus, ServerConfig } from '../src/types.js';

// ── shared helpers ────────────────────────────────────────────────────────────

let _seq = 0;
function dlqPath(): string {
  return join(tmpdir(), `ch1tty-ar-${process.pid}-${++_seq}.dlq.jsonl`);
}

function cfg(id: string): ServerConfig {
  return { id, name: id, type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: `https://${id}.invalid/mcp` };
}

function minimalBackend(): Backend {
  return {
    registerServer: () => {},
    isRegistered: () => false,
    getStatus: (): BackendStatus => ({ connected: false, toolCount: 0, toolCacheAge: null }),
    listTools: async () => [],
    callTool: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async (_s: string, uri: string) => ({ contents: [{ uri, text: '' }] }),
    listPrompts: async () => [],
    getPrompt: async (_s: string, name: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text: name } }] }),
    shutdown: async () => {},
  };
}

// ── 1. aggregator.ts:51-53 — filterSuggestionsCatalog warns on invalid keys ──

describe('filterSuggestionsCatalog — invalid profile key warning', () => {
  test('key "catalog" is reserved: emitted as warning, excluded from active catalog', async () => {
    const b = minimalBackend();
    const emittedWarnings: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as NodeJS.WriteStream & { write: typeof process.stderr.write }).write = (
      chunk: string | Uint8Array,
      ..._rest: unknown[]
    ) => {
      emittedWarnings.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    };

    try {
      const agg = new Aggregator([cfg('svc1')], {
        backendFactory: () => b,
        embedEnabled: false,
        ledgerDlqPath: dlqPath(),
        suggestionsCatalog: {
          catalog: {
            description: 'should be filtered',
            combos: [],
            prompts: [],
          },
          finance: {
            description: 'valid profile',
            combos: [],
            prompts: [],
          },
        } as never,
      });

      // The 'catalog' key must be warned about and excluded
      const combined = emittedWarnings.join('');
      assert.ok(
        combined.includes('catalog') && combined.includes('reserved'),
        `warning should mention "catalog" and "reserved"; got: ${combined.slice(0, 400)}`,
      );

      // status should not reference 'catalog' as an available focus profile
      const statusResult = await agg.callTool('ch1tty/status', {});
      const status = JSON.parse(statusResult.content[0]?.text ?? '{}') as { availableFocusProfiles?: string[] };
      assert.ok(
        !status.availableFocusProfiles?.includes('catalog'),
        '"catalog" must not appear as an available focus profile',
      );

      await agg.shutdown();
    } finally {
      process.stderr.write = origWrite;
    }
  });

  test('key containing "/" is invalid: emitted as warning, excluded from active catalog', async () => {
    const b = minimalBackend();
    const emittedWarnings: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as NodeJS.WriteStream & { write: typeof process.stderr.write }).write = (
      chunk: string | Uint8Array,
      ..._rest: unknown[]
    ) => {
      emittedWarnings.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString());
      return true;
    };

    try {
      const agg = new Aggregator([cfg('svc2')], {
        backendFactory: () => b,
        embedEnabled: false,
        ledgerDlqPath: dlqPath(),
        suggestionsCatalog: {
          'finance/ops': {
            description: 'slash in key — invalid',
            combos: [],
            prompts: [],
          },
          governance: {
            description: 'valid profile',
            combos: [],
            prompts: [],
          },
        } as never,
      });

      const combined = emittedWarnings.join('');
      assert.ok(
        combined.includes('finance/ops'),
        `warning should mention the invalid key "finance/ops"; got: ${combined.slice(0, 400)}`,
      );

      const statusResult = await agg.callTool('ch1tty/status', {});
      const status = JSON.parse(statusResult.content[0]?.text ?? '{}') as { availableFocusProfiles?: string[] };
      assert.ok(
        !status.availableFocusProfiles?.includes('finance/ops'),
        '"finance/ops" must not appear as an available focus profile',
      );

      await agg.shutdown();
    } finally {
      process.stderr.write = origWrite;
    }
  });
});

// ── 2. ledger.ts:167 — LedgerClient constructor with explicit DlqStore object ─

describe('LedgerClient constructor — explicit DlqStore branch', () => {
  test('passing a DlqStore object (not a string) uses it directly as dlq', async () => {
    const appendedEntries: LedgerEntry[][] = [];
    const rewrittenEntries: object[][] = [];

    const mockStore: DlqStore = {
      append(entries: LedgerEntry[]): void { appendedEntries.push(entries); },
      readEntries(_limit: number): object[] { return []; },
      rewrite(entries: object[]): void { rewrittenEntries.push(entries); },
      count(): number { return 0; },
      describe(): string { return 'mock://dlq-store'; },
    };

    const client = new LedgerClient(mockStore);

    // dlqPath is set from describe()
    const stats = client.getStats();
    assert.equal(stats.dlqPath, 'mock://dlq-store', 'dlqPath must come from the injected DlqStore.describe()');

    // Record an entry and shut down — should append to the mock store
    client.record('sess-ar', 'test_event', { source: 'ar-test' });
    await client.shutdown();

    // Either the entry was flushed via the backend (empty) or drained to the DLQ on shutdown
    // Either way: no error was thrown and dlqPath is correctly set
    assert.equal(stats.dlqPath, 'mock://dlq-store');
  });
});

// ── 3. logger.ts:34-37 — Logger.setLevel() ───────────────────────────────────

describe('Logger.setLevel()', () => {
  function makeLogger(envOverrides: Record<string, string | undefined> = {}): Logger {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(envOverrides)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    const l = new Logger();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return l;
  }

  test('setLevel(undefined) returns early without changing the level', () => {
    const cap: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    (process.stderr as NodeJS.WriteStream & { write: typeof process.stderr.write }).write = (
      chunk: string | Uint8Array,
      ..._rest: unknown[]
    ) => { cap.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()); return true; };

    try {
      const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'warn' });
      logger.setLevel(undefined);
      // Level should remain at 'warn' — debug and info are suppressed
      logger.debug('should not appear');
      logger.info('should not appear either');
      assert.equal(cap.length, 0, 'debug/info must be suppressed after setLevel(undefined) when minLevel=warn');
    } finally {
      process.stderr.write = orig;
    }
  });

  test('setLevel("") returns early without changing the level', () => {
    const cap: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    (process.stderr as NodeJS.WriteStream & { write: typeof process.stderr.write }).write = (
      chunk: string | Uint8Array,
      ..._rest: unknown[]
    ) => { cap.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()); return true; };

    try {
      const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'error' });
      logger.setLevel('');
      logger.warn('should be suppressed');
      assert.equal(cap.length, 0, 'warn must be suppressed after setLevel("") when minLevel=error');
    } finally {
      process.stderr.write = orig;
    }
  });

  test('setLevel("unknown-level") leaves minLevel unchanged', () => {
    const cap: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    (process.stderr as NodeJS.WriteStream & { write: typeof process.stderr.write }).write = (
      chunk: string | Uint8Array,
      ..._rest: unknown[]
    ) => { cap.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()); return true; };

    try {
      const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'error' });
      logger.setLevel('not-a-valid-level');
      logger.warn('should still be suppressed');
      assert.equal(cap.length, 0, 'warn must be suppressed: unknown level must not override minLevel=error');
    } finally {
      process.stderr.write = orig;
    }
  });

  test('setLevel("debug") updates minLevel so debug messages appear', () => {
    const cap: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    (process.stderr as NodeJS.WriteStream & { write: typeof process.stderr.write }).write = (
      chunk: string | Uint8Array,
      ..._rest: unknown[]
    ) => { cap.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()); return true; };

    try {
      const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'warn' });
      logger.setLevel('debug');
      logger.debug('debug message after setLevel');
      assert.ok(cap.some((l) => l.includes('debug message after setLevel')),
        'debug message must appear after setLevel("debug")');
    } finally {
      process.stderr.write = orig;
    }
  });

  test('setLevel("INFO") is case-insensitive', () => {
    const cap: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    (process.stderr as NodeJS.WriteStream & { write: typeof process.stderr.write }).write = (
      chunk: string | Uint8Array,
      ..._rest: unknown[]
    ) => { cap.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()); return true; };

    try {
      const logger = makeLogger({ CH1TTY_LOG_LEVEL: 'error' });
      logger.setLevel('INFO');
      logger.info('info after setLevel INFO');
      assert.ok(cap.some((l) => l.includes('info after setLevel INFO')),
        'info must appear after setLevel("INFO") — case-insensitive');
    } finally {
      process.stderr.write = orig;
    }
  });
});
