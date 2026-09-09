/**
 * Workstream I: ch1tty/reload includes missingEnvVars diagnostics in its response
 * and calls logStartupEnvWarnings() so operators see missing env vars both in the
 * tool response and in the process log.
 *
 * No mocks — drives the real Aggregator with a temp config file and env vars we
 * control in the test process.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ch1tty-reload-env-'));
}

function writeConfigFile(path: string, servers: ServerConfig[]): void {
  writeFileSync(path, JSON.stringify({ servers }));
}

function makeAgg(servers: ServerConfig[], configPath: string, dir: string): Aggregator {
  return new Aggregator(servers, {
    embedEnabled: false,
    ledgerDlqPath: join(dir, 'test.dlq.jsonl'),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
    configPath,
  });
}

function saveEnv(...keys: string[]): () => void {
  const snapshot: Record<string, string | undefined> = {};
  for (const k of keys) snapshot[k] = process.env[k];
  return () => {
    for (const [k, v] of Object.entries(snapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

const ABSENT = 'CH1TTY_TEST_I_ABSENT_XYZ_99999';
const SET = 'CH1TTY_TEST_I_SET_XYZ_99999';

function remoteServer(id: string, envHeaders?: Record<string, string>): ServerConfig {
  const cfg: ServerConfig = {
    id,
    name: `Test ${id}`,
    type: 'remote',
    access: 'read',
    category: 'ecosystem',
    endpoint: 'https://example.invalid/mcp',
    lazy: true,
  };
  if (envHeaders) cfg.envHeaders = envHeaders;
  return cfg;
}

test('reload result includes missingEnvVars when server has an unset envHeaders var', async () => {
  const dir = tempDir();
  const configPath = join(dir, 'servers.json');
  const restore = saveEnv(ABSENT);
  delete process.env[ABSENT];
  try {
    const servers = [remoteServer('srv-missing', { 'X-Token': ABSENT })];
    writeConfigFile(configPath, servers);
    const instance = makeAgg(servers, configPath, dir);
    const result = await instance.callTool('ch1tty/reload', {});
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.reloaded, true);
    assert.ok(Array.isArray(parsed.missingEnvVars), 'missingEnvVars is an array');
    const entry = parsed.missingEnvVars.find((e: { serverId: string }) => e.serverId === 'srv-missing');
    assert.ok(entry, 'entry for srv-missing present in missingEnvVars');
    assert.ok(entry.vars.includes(ABSENT), `${ABSENT} listed in vars`);
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reload result has empty missingEnvVars when all envHeaders vars are set', async () => {
  const dir = tempDir();
  const configPath = join(dir, 'servers.json');
  const restore = saveEnv(SET);
  process.env[SET] = 'some-value';
  try {
    const servers = [remoteServer('srv-ok', { 'X-Token': SET })];
    writeConfigFile(configPath, servers);
    const instance = makeAgg(servers, configPath, dir);
    const result = await instance.callTool('ch1tty/reload', {});
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.reloaded, true);
    assert.deepEqual(parsed.missingEnvVars, []);
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reload result missingEnvVars only lists servers with unset vars, not servers that are fine', async () => {
  const dir = tempDir();
  const configPath = join(dir, 'servers.json');
  const restore = saveEnv(ABSENT, SET);
  delete process.env[ABSENT];
  process.env[SET] = 'some-value';
  try {
    const servers = [
      remoteServer('srv-missing', { 'X-Token': ABSENT }),
      remoteServer('srv-ok', { 'X-Token': SET }),
    ];
    writeConfigFile(configPath, servers);
    const instance = makeAgg(servers, configPath, dir);
    const result = await instance.callTool('ch1tty/reload', {});
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.missingEnvVars.length, 1, 'only srv-missing has an unset var');
    assert.equal(parsed.missingEnvVars[0].serverId, 'srv-missing');
    assert.equal(
      parsed.missingEnvVars.find((e: { serverId: string }) => e.serverId === 'srv-ok'),
      undefined,
    );
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reload result always includes missingEnvVars field even when no servers have envHeaders', async () => {
  const dir = tempDir();
  const configPath = join(dir, 'servers.json');
  try {
    const servers = [remoteServer('srv-no-envheaders')];
    writeConfigFile(configPath, servers);
    const instance = makeAgg(servers, configPath, dir);
    const result = await instance.callTool('ch1tty/reload', {});
    const parsed = JSON.parse(result.content[0].text);
    assert.ok(Object.prototype.hasOwnProperty.call(parsed, 'missingEnvVars'), 'field always present');
    assert.deepEqual(parsed.missingEnvVars, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
