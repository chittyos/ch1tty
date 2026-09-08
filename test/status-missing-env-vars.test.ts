/**
 * Workstream F: status reports missingEnvVars for remote servers whose envHeaders
 * reference env vars that are unset at status time.
 *
 * No mocks, no fake data — drives the real Aggregator with real ServerConfig entries
 * that reference env vars we control in the test process.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ch1tty-missing-env-'));
}

function agg(configs: ServerConfig[], dir: string): Aggregator {
  return new Aggregator(configs, {
    embedEnabled: false,
    ledgerDlqPath: join(dir, 'test.dlq.jsonl'),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
  });
}

test('missingEnvVars: unset envHeaders vars appear in server status', async () => {
  const dir = tempDir();
  const ABSENT_VAR = 'CH1TTY_TEST_ABSENT_ENV_VAR_XYZ_12345';
  delete process.env[ABSENT_VAR];

  const configs: ServerConfig[] = [
    {
      id: 'testremote',
      name: 'Test Remote',
      type: 'remote',
      access: 'read',
      category: 'ecosystem',
      endpoint: 'https://example.invalid/mcp',
      envHeaders: {
        'X-Test-Header': ABSENT_VAR,
      },
    },
  ];

  const instance = agg(configs, dir);
  try {
    const snap = instance.getStatusSnapshot();
    const serverStatus = snap.servers.find((s) => s.id === 'testremote');
    assert.ok(serverStatus, 'testremote server should appear in status');
    assert.deepEqual(serverStatus.missingEnvVars, [ABSENT_VAR]);
  } finally {
    await instance.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missingEnvVars: empty-string envHeaders vars appear in server status (matches doConnect behavior)', async () => {
  const dir = tempDir();
  const EMPTY_VAR = 'CH1TTY_TEST_EMPTY_ENV_VAR_XYZ_12345';
  process.env[EMPTY_VAR] = '';

  const configs: ServerConfig[] = [
    {
      id: 'testremote-empty',
      name: 'Test Remote Empty',
      type: 'remote',
      access: 'read',
      category: 'ecosystem',
      endpoint: 'https://example.invalid/mcp',
      envHeaders: {
        'X-Test-Header': EMPTY_VAR,
      },
    },
  ];

  const instance = agg(configs, dir);
  try {
    const snap = instance.getStatusSnapshot();
    const serverStatus = snap.servers.find((s) => s.id === 'testremote-empty');
    assert.ok(serverStatus);
    // Empty string is falsy → header won't be sent by doConnect → should appear as missing
    assert.deepEqual(serverStatus.missingEnvVars, [EMPTY_VAR]);
  } finally {
    delete process.env[EMPTY_VAR];
    await instance.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missingEnvVars: set envHeaders vars do NOT appear in server status', async () => {
  const dir = tempDir();
  const SET_VAR = 'CH1TTY_TEST_SET_ENV_VAR_XYZ_12345';
  process.env[SET_VAR] = 'test-value';

  const configs: ServerConfig[] = [
    {
      id: 'testremote2',
      name: 'Test Remote 2',
      type: 'remote',
      access: 'read',
      category: 'ecosystem',
      endpoint: 'https://example.invalid/mcp',
      envHeaders: {
        'X-Test-Header': SET_VAR,
      },
    },
  ];

  const instance = agg(configs, dir);
  try {
    const snap = instance.getStatusSnapshot();
    const serverStatus = snap.servers.find((s) => s.id === 'testremote2');
    assert.ok(serverStatus, 'testremote2 server should appear in status');
    assert.equal(serverStatus.missingEnvVars, undefined);
  } finally {
    delete process.env[SET_VAR];
    await instance.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missingEnvVars: mixed envHeaders — only unset ones appear', async () => {
  const dir = tempDir();
  const SET_VAR = 'CH1TTY_TEST_SET_MIXED_XYZ_12345';
  const ABSENT_VAR = 'CH1TTY_TEST_ABSENT_MIXED_XYZ_12345';
  process.env[SET_VAR] = 'set-value';
  delete process.env[ABSENT_VAR];

  const configs: ServerConfig[] = [
    {
      id: 'testremote3',
      name: 'Test Remote 3',
      type: 'remote',
      access: 'read',
      category: 'ecosystem',
      endpoint: 'https://example.invalid/mcp',
      envHeaders: {
        'X-Set-Header': SET_VAR,
        'X-Absent-Header': ABSENT_VAR,
      },
    },
  ];

  const instance = agg(configs, dir);
  try {
    const snap = instance.getStatusSnapshot();
    const serverStatus = snap.servers.find((s) => s.id === 'testremote3');
    assert.ok(serverStatus, 'testremote3 server should appear in status');
    assert.deepEqual(serverStatus.missingEnvVars, [ABSENT_VAR]);
  } finally {
    delete process.env[SET_VAR];
    await instance.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missingEnvVars: absent when server has no envHeaders', async () => {
  const dir = tempDir();

  const configs: ServerConfig[] = [
    {
      id: 'testremote4',
      name: 'Test Remote 4',
      type: 'remote',
      access: 'read',
      category: 'ecosystem',
      endpoint: 'https://example.invalid/mcp',
    },
  ];

  const instance = agg(configs, dir);
  try {
    const snap = instance.getStatusSnapshot();
    const serverStatus = snap.servers.find((s) => s.id === 'testremote4');
    assert.ok(serverStatus);
    assert.equal(serverStatus.missingEnvVars, undefined);
  } finally {
    await instance.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missingEnvVars: local server never has missingEnvVars', async () => {
  const dir = tempDir();

  const configs: ServerConfig[] = [
    {
      id: 'testlocal',
      name: 'Test Local',
      type: 'local',
      access: 'read',
      category: 'code',
      command: '/bin/true',
    },
  ];

  const instance = agg(configs, dir);
  try {
    const snap = instance.getStatusSnapshot();
    const serverStatus = snap.servers.find((s) => s.id === 'testlocal');
    assert.ok(serverStatus);
    assert.equal(serverStatus.missingEnvVars, undefined);
  } finally {
    await instance.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
