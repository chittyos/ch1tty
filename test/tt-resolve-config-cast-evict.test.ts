/**
 * TT: resolveConfigPath env-var branches, handleCast missing-intent guard,
 *     and ChildManager callTool/listTools failure → eviction paths.
 *
 * Paths covered (not reached by any prior suite):
 *
 * 1. resolveConfigPath (config.ts:237-238) — CH1TTY_CONFIG set branch:
 *    returns the env-var value verbatim (no path joining).
 *
 * 2. resolveConfigPath — CH1TTY_CONFIG unset branch:
 *    returns an absolute path ending in "servers.json".
 *
 * 3. handleCast (aggregator.ts:722-726) — empty intent string:
 *    !intent === true → isError:true + "Missing required" message.
 *
 * 4. handleCast — whitespace-only intent:
 *    intent.trim() === '' → same isError guard fires.
 *
 * 5. ChildManager.callTool (child-manager.ts:240-244) — client.callTool throws:
 *    breaker.recordFailure + evict → connection removed (connected:false);
 *    error re-thrown to caller.
 *
 * 6. ChildManager.listTools (child-manager.ts:216-220) — spawn succeeds but
 *    client.listTools throws: breaker.recordFailure + evict → connection evicted.
 */

import assert from 'node:assert/strict';
import { describe, test, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Shared setup ──────────────────────────────────────────────────────────────

process.env.CH1TTY_SPAWN_TIMEOUT_MS = '500';

const { ChildManager } = await import('../src/child-manager.js');
import { resolveConfigPath } from '../src/config.js';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { LocalServerConfig } from '../src/types.js';

const tempDir = mkdtempSync(join(tmpdir(), 'ch1tty-tt-'));
after(() => rmSync(tempDir, { recursive: true, force: true }));

function localConfig(id: string): LocalServerConfig {
  return { id, name: id, type: 'local', access: 'readwrite', category: 'code', command: join(tempDir, `nonexistent-${id}`), args: [] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFakeConn(opts: { callToolFn?: () => Promise<unknown>; listToolsFn?: () => Promise<unknown> } = {}): any {
  return {
    client: {
      callTool: opts.callToolFn ?? (async () => ({ content: [{ type: 'text', text: 'ok' }] })),
      listTools: opts.listToolsFn ?? (async () => ({ tools: [] })),
      listResources: async () => ({ resources: [] }),
      listResourceTemplates: async () => ({ resourceTemplates: [] }),
      listPrompts: async () => ({ prompts: [] }),
      close: async () => {},
    },
    transport: {},
    toolCache: null,
    resourceCache: null,
    promptCache: null,
  };
}

function makeAgg(): Aggregator {
  return new Aggregator([], {
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    backendFactory: () => new FixtureBackend(),
    embedEnabled: false,
  });
}

// ── 1 & 2. resolveConfigPath ──────────────────────────────────────────────────

describe('resolveConfigPath', () => {
  test('CH1TTY_CONFIG set → returns that path verbatim', () => {
    const saved = process.env.CH1TTY_CONFIG;
    try {
      process.env.CH1TTY_CONFIG = '/custom/path/my-servers.json';
      assert.equal(resolveConfigPath(), '/custom/path/my-servers.json');
    } finally {
      if (saved === undefined) delete process.env.CH1TTY_CONFIG;
      else process.env.CH1TTY_CONFIG = saved;
    }
  });

  test('CH1TTY_CONFIG unset → returns absolute default path ending in servers.json', () => {
    const saved = process.env.CH1TTY_CONFIG;
    try {
      delete process.env.CH1TTY_CONFIG;
      const result = resolveConfigPath();
      assert.ok(result.endsWith('servers.json'), `expected path to end with servers.json, got: ${result}`);
      assert.ok(isAbsolute(result), `expected absolute path, got: ${result}`);
    } finally {
      if (saved === undefined) delete process.env.CH1TTY_CONFIG;
      else process.env.CH1TTY_CONFIG = saved;
    }
  });
});

// ── 3 & 4. handleCast missing-intent guard ────────────────────────────────────

describe('handleCast: missing-intent guard', () => {
  test('empty intent string → isError:true with "Missing required" message', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/cast', { intent: '' });
    assert.equal(result.isError, true, 'empty intent must return isError:true');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    assert.match(text, /Missing required/i, `unexpected message: ${text}`);
    await agg.shutdown();
  });

  test('whitespace-only intent → isError:true with "Missing required" message', async () => {
    const agg = makeAgg();
    const result = await agg.callTool('ch1tty/cast', { intent: '   ' });
    assert.equal(result.isError, true, 'whitespace intent must return isError:true');
    const text = (result.content[0] as { type: 'text'; text: string }).text;
    assert.match(text, /Missing required/i, `unexpected message: ${text}`);
    await agg.shutdown();
  });
});

// ── 5. ChildManager.callTool failure → eviction ───────────────────────────────

describe('ChildManager.callTool failure → eviction', { concurrency: false }, () => {
  test('callTool: client.callTool throws → connection evicted, error re-thrown', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('ct-fail'));

    const conn = makeFakeConn({
      callToolFn: async () => { throw new Error('transport dead'); },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).children.set('ct-fail', conn);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal((cm as any).children.has('ct-fail'), true, 'precondition: connection present');

    await assert.rejects(
      () => cm.callTool('ct-fail', 'do-thing', {}),
      /transport dead/,
      'error must be re-thrown by callTool',
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal((cm as any).children.has('ct-fail'), false, 'connection must be evicted after callTool failure');
    await cm.shutdown();
  });
});

// ── 6. ChildManager.listTools spawn-ok but client.listTools throws → eviction ─

describe('ChildManager.listTools client-throw → eviction', { concurrency: false }, () => {
  test('listTools: spawn succeeds but client.listTools throws → connection evicted', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('lt-fail'));

    const conn = makeFakeConn({
      listToolsFn: async () => { throw new Error('listTools RPC failed'); },
    });
    // Patch doSpawn (not spawn) so the real spawn() still runs its children.set() book-keeping.
    // This ensures children has an entry for 'lt-fail' when evict() fires in the catch block.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).doSpawn = async () => conn;

    await assert.rejects(
      () => cm.listTools('lt-fail'),
      /listTools RPC failed/,
      'error must propagate from listTools',
    );

    // spawn() added the connection; evict() in the catch block must have removed it.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal((cm as any).children.has('lt-fail'), false, 'connection must be evicted after listTools failure');
    await cm.shutdown();
  });
});
