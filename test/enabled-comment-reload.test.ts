/**
 * SS: aggregator enabled:false filtering, config _comment entries, reload backend
 *     shutdown failure recovery.
 *
 * Covered paths not reached by prior suites:
 *   1. validateServersConfig: pure comment entry `{_comment:"..."}` is filtered out —
 *      does not appear in the resulting servers array (config.ts:222).
 *   2. validateServersConfig: mixed comment + real entries — only real entries survive.
 *   3. Aggregator: server with enabled:false is excluded from activeConfigs()
 *      (aggregator.ts:189) — absent from ch1tty/status server list and from
 *      ch1tty/search results.
 *   4. Aggregator: server with enabled:false does not get a Backend instantiated.
 *   5. ch1tty/reload: old backend's shutdown() rejects — reload still returns
 *      {reloaded:true, added, removed} (aggregator.ts:685–691, allSettled path).
 */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import { validateServersConfig } from '../src/config.js';
import type { ServerConfig, Backend, BackendStatus, ToolEntry, ToolCallResult } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Temp directory management ─────────────────────────────────────────────────

const testDirs: string[] = [];
after(() => { for (const d of testDirs) rmSync(d, { recursive: true, force: true }); });

function tempFiles(): { configPath: string; dlqPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-ss-'));
  testDirs.push(dir);
  return {
    configPath: join(dir, 'servers.json'),
    dlqPath: join(dir, 'ledger.dlq.jsonl'),
  };
}

function writeConfig(path: string, raw: unknown): void {
  writeFileSync(path, JSON.stringify(raw, null, 2), 'utf8');
}

function makeServer(id: string, extra: Partial<ServerConfig> = {}): ServerConfig {
  return { id, name: id, type: 'remote', access: 'readwrite', category: 'code', endpoint: `https://ss.test/${id}`, ...extra };
}

function buildAgg(servers: ServerConfig[], configPath: string, dlqPath: string): Aggregator {
  const fb = new FixtureBackend();
  return new Aggregator(servers, {
    configPath,
    ledgerDlqPath: dlqPath,
    backendFactory: () => fb,
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    embedEnabled: false,
  });
}

// ── 1. validateServersConfig: pure comment entry is filtered out ──────────────

test('validateServersConfig: pure _comment entry is filtered — not present in servers', () => {
  const raw = {
    servers: [
      { _comment: 'This is documentation only' },
    ],
  };
  const cfg = validateServersConfig(raw);
  assert.equal(cfg.servers.length, 0, 'comment-only entry must be removed from servers array');
});

// ── 2. validateServersConfig: mixed comment + real entries ────────────────────

test('validateServersConfig: mixed _comment + real entries — only real entries survive', () => {
  const raw = {
    servers: [
      { _comment: 'Neon DB — production Postgres' },
      { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://neon.test/mcp' },
      { _comment: 'GitHub — source control' },
      { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://gh.test/mcp' },
    ],
  };
  const cfg = validateServersConfig(raw);
  assert.equal(cfg.servers.length, 2, 'two real entries must survive; two comment entries removed');
  assert.equal(cfg.servers[0].id, 'neon');
  assert.equal(cfg.servers[1].id, 'github');
});

// ── 3. enabled:false excluded from ch1tty/status and ch1tty/search ───────────

test('enabled:false server excluded from status server list and search results', async () => {
  const { configPath, dlqPath } = tempFiles();
  writeConfig(configPath, {
    servers: [
      makeServer('active-srv'),
      makeServer('disabled-srv', { enabled: false }),
    ],
  });

  const agg = buildAgg(
    [makeServer('active-srv'), makeServer('disabled-srv', { enabled: false })],
    configPath,
    dlqPath,
  );
  try {
    // ch1tty/status — disabled server must not appear in server list
    const statusResult = await agg.callTool('ch1tty/status', {});
    const statusData = JSON.parse(statusResult.content[0].text as string) as {
      servers: Array<{ id: string }>;
    };
    const ids = statusData.servers.map((s) => s.id);
    assert.ok(ids.includes('active-srv'), 'active-srv must appear in status');
    assert.ok(!ids.includes('disabled-srv'), 'disabled-srv must not appear in status');

    // ch1tty/search with server filter — disabled server returns nothing
    const searchResult = await agg.callTool('ch1tty/search', { server: 'disabled-srv' });
    const searchData = JSON.parse(searchResult.content[0].text as string) as { tools: unknown[] };
    assert.equal(searchData.tools.length, 0, 'disabled server has no tools in search results');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. enabled:false server does not get a Backend instantiated ───────────────

test('enabled:false server: backendFactory not called for that server', async () => {
  const { configPath, dlqPath } = tempFiles();
  writeConfig(configPath, { servers: [makeServer('live')] });

  const instantiated: string[] = [];
  const agg = new Aggregator(
    [makeServer('live'), makeServer('off', { enabled: false })],
    {
      configPath,
      ledgerDlqPath: dlqPath,
      backendFactory: (cfg) => {
        instantiated.push(cfg.id);
        return new FixtureBackend();
      },
      focusProfiles: { profiles: {} },
      suggestionsCatalog: {},
      embedEnabled: false,
    },
  );
  try {
    assert.ok(instantiated.includes('live'), 'live server backend created');
    assert.ok(!instantiated.includes('off'), 'disabled server backend NOT created');
  } finally {
    await agg.shutdown();
  }
});

// ── 5. ch1tty/reload: old backend shutdown() rejection is tolerated ───────────

test('ch1tty/reload: old backend.shutdown() rejection does not fail the reload', async () => {
  const { configPath, dlqPath } = tempFiles();
  writeConfig(configPath, { servers: [makeServer('alpha'), makeServer('beta')] });

  // Build a backend whose shutdown() always rejects
  class RejectingBackend extends FixtureBackend {
    override shutdown(): Promise<void> {
      return Promise.reject(new Error('shutdown exploded'));
    }
  }

  const agg = new Aggregator([makeServer('alpha'), makeServer('beta')], {
    configPath,
    ledgerDlqPath: dlqPath,
    backendFactory: () => new RejectingBackend(),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    embedEnabled: false,
  });
  try {
    // Mutate config to replace beta with gamma
    writeConfig(configPath, { servers: [makeServer('alpha'), makeServer('gamma')] });

    const result = await agg.callTool('ch1tty/reload', {});
    assert.equal(result.isError, undefined, `reload must succeed even when shutdown rejects; got: ${result.content[0].text}`);
    const data = JSON.parse(result.content[0].text as string) as {
      reloaded: boolean;
      added: string[];
      removed: string[];
    };
    assert.equal(data.reloaded, true, 'reloaded flag must be true');
    assert.ok(data.added.includes('gamma'), 'gamma must appear in added');
    assert.ok(data.removed.includes('beta'), 'beta must appear in removed');
  } finally {
    await agg.shutdown().catch(() => {}); // ignore shutdown rejection
  }
});
