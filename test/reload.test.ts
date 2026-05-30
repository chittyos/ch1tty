/**
 * Tests for ch1tty/reload hot-reload: reading a mutated servers.json from disk,
 * diffing old vs. new server IDs, rebuilding backends, and reporting results.
 *
 * Uses FixtureBackend + backendFactory so no real child processes are spawned.
 * Each test writes its own temp config file and DLQ path to stay fully isolated.
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import type { ServersConfig, ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

const TMP = tmpdir();
const TEST_ID = process.pid;

// Each test gets a unique index for its temp files.
let nextIdx = 0;
function tempFiles(): { configPath: string; dlqPath: string } {
  const idx = nextIdx++;
  return {
    configPath: join(TMP, `ch1tty-reload-test-${TEST_ID}-${idx}.json`),
    dlqPath: join(TMP, `ch1tty-reload-dlq-${TEST_ID}-${idx}.jsonl`),
  };
}

after(() => {
  // Best-effort cleanup — temp OS handles this on reboot anyway.
  for (let i = 0; i < nextIdx; i++) {
    rmSync(join(TMP, `ch1tty-reload-test-${TEST_ID}-${i}.json`), { force: true });
    rmSync(join(TMP, `ch1tty-reload-dlq-${TEST_ID}-${i}.jsonl`), { force: true });
  }
});

function writeConfig(path: string, servers: ServerConfig[]): void {
  const cfg: ServersConfig = { servers };
  writeFileSync(path, JSON.stringify(cfg, null, 2), 'utf8');
}

function makeServer(id: string): ServerConfig {
  return { id, name: id, type: 'remote', access: 'readwrite', category: 'code', endpoint: `https://fixture.test/${id}` };
}

function buildAgg(initialServers: ServerConfig[], configPath: string, dlqPath: string): Aggregator {
  const fb = new FixtureBackend();
  return new Aggregator(initialServers, {
    configPath,
    ledgerDlqPath: dlqPath,
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    backendFactory: () => fb,
  });
}

// ── reload with identical config ─────────────────────────────────────────────

test('ch1tty/reload with unchanged config returns reloaded:true, empty diffs', async () => {
  const { configPath, dlqPath } = tempFiles();
  const servers = [makeServer('alpha')];
  writeConfig(configPath, servers);

  const agg = buildAgg(servers, configPath, dlqPath);
  const result = await agg.callTool('ch1tty/reload');

  assert.equal(result.isError, undefined, 'should not be an error');
  const data = JSON.parse((result.content[0] as { text: string }).text);
  assert.equal(data.reloaded, true);
  assert.deepEqual(data.added, []);
  assert.deepEqual(data.removed, []);
  assert.equal(data.totalServers, 1);
});

// ── reload adds a server ─────────────────────────────────────────────────────

test('ch1tty/reload picks up a new server added to the config file', async () => {
  const { configPath, dlqPath } = tempFiles();
  const initial = [makeServer('alpha')];
  writeConfig(configPath, initial);

  const agg = buildAgg(initial, configPath, dlqPath);

  // Mutate the file on disk before reloading
  writeConfig(configPath, [makeServer('alpha'), makeServer('beta')]);

  const result = await agg.callTool('ch1tty/reload');
  assert.equal(result.isError, undefined);
  const data = JSON.parse((result.content[0] as { text: string }).text);
  assert.equal(data.reloaded, true);
  assert.deepEqual(data.added, ['beta']);
  assert.deepEqual(data.removed, []);
  assert.equal(data.totalServers, 2);
});

// ── reload removes a server ──────────────────────────────────────────────────

test('ch1tty/reload detects a server removed from the config file', async () => {
  const { configPath, dlqPath } = tempFiles();
  const initial = [makeServer('alpha'), makeServer('beta')];
  writeConfig(configPath, initial);

  const agg = buildAgg(initial, configPath, dlqPath);

  writeConfig(configPath, [makeServer('alpha')]);

  const result = await agg.callTool('ch1tty/reload');
  assert.equal(result.isError, undefined);
  const data = JSON.parse((result.content[0] as { text: string }).text);
  assert.equal(data.reloaded, true);
  assert.deepEqual(data.added, []);
  assert.deepEqual(data.removed, ['beta']);
  assert.equal(data.totalServers, 1);
});

// ── reload adds and removes simultaneously ───────────────────────────────────

test('ch1tty/reload handles simultaneous add + remove correctly', async () => {
  const { configPath, dlqPath } = tempFiles();
  const initial = [makeServer('alpha'), makeServer('beta')];
  writeConfig(configPath, initial);

  const agg = buildAgg(initial, configPath, dlqPath);

  // Replace beta with gamma
  writeConfig(configPath, [makeServer('alpha'), makeServer('gamma')]);

  const result = await agg.callTool('ch1tty/reload');
  assert.equal(result.isError, undefined);
  const data = JSON.parse((result.content[0] as { text: string }).text);
  assert.equal(data.reloaded, true);
  assert.deepEqual(data.added, ['gamma']);
  assert.deepEqual(data.removed, ['beta']);
  assert.equal(data.totalServers, 2);
});

// ── status reflects changes after reload ────────────────────────────────────

test('ch1tty/status totalServers reflects the new config after reload', async () => {
  const { configPath, dlqPath } = tempFiles();
  const initial = [makeServer('alpha')];
  writeConfig(configPath, initial);

  const agg = buildAgg(initial, configPath, dlqPath);

  // Confirm baseline count
  const before = await agg.callTool('ch1tty/status');
  const beforeStatus = JSON.parse((before.content[0] as { text: string }).text);
  assert.equal(beforeStatus.totalServers, 1);

  // Add two servers via file mutation + reload
  writeConfig(configPath, [makeServer('alpha'), makeServer('beta'), makeServer('gamma')]);
  await agg.callTool('ch1tty/reload');

  const after = await agg.callTool('ch1tty/status');
  const afterStatus = JSON.parse((after.content[0] as { text: string }).text);
  assert.equal(afterStatus.totalServers, 3);
});

// ── reload with invalid JSON ─────────────────────────────────────────────────

test('ch1tty/reload returns isError when config file contains invalid JSON', async () => {
  const { configPath, dlqPath } = tempFiles();
  const initial = [makeServer('alpha')];
  writeConfig(configPath, initial);

  const agg = buildAgg(initial, configPath, dlqPath);

  writeFileSync(configPath, '{ this is not valid json }', 'utf8');

  const result = await agg.callTool('ch1tty/reload');
  assert.equal(result.isError, true);
  assert.match((result.content[0] as { text: string }).text, /Reload failed/);
});

// ── reload respects missing configPath ───────────────────────────────────────

test('ch1tty/reload fails gracefully when no configPath was provided', async () => {
  const { dlqPath } = tempFiles();
  // No configPath supplied
  const agg = new Aggregator([makeServer('alpha')], {
    ledgerDlqPath: dlqPath,
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    backendFactory: () => new FixtureBackend(),
  });

  const result = await agg.callTool('ch1tty/reload');
  assert.equal(result.isError, true);
  assert.match((result.content[0] as { text: string }).text, /No config path/);
});

// ── reload is idempotent (multiple reloads with same file) ───────────────────

test('ch1tty/reload is idempotent: repeated reloads with same file return empty diffs', async () => {
  const { configPath, dlqPath } = tempFiles();
  const servers = [makeServer('alpha'), makeServer('beta')];
  writeConfig(configPath, servers);

  const agg = buildAgg(servers, configPath, dlqPath);

  for (let i = 0; i < 3; i++) {
    const result = await agg.callTool('ch1tty/reload');
    assert.equal(result.isError, undefined, `reload #${i + 1} should not error`);
    const data = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(data.reloaded, true, `reload #${i + 1} reloaded must be true`);
    assert.deepEqual(data.added, [], `reload #${i + 1} added must be empty`);
    assert.deepEqual(data.removed, [], `reload #${i + 1} removed must be empty`);
    assert.equal(data.totalServers, 2, `reload #${i + 1} totalServers must stay 2`);
  }
});
