/**
 * Workstream G: Aggregator.getMissingEnvVarDiagnostics() returns the correct set of
 * remote servers and var names that are unset (or empty) at startup time.
 *
 * No mocks — drives the real Aggregator with ServerConfig entries that reference
 * env vars we control in the test process.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ch1tty-startup-env-'));
}

function agg(configs: ServerConfig[], dir: string): Aggregator {
  return new Aggregator(configs, {
    embedEnabled: false,
    ledgerDlqPath: join(dir, 'test.dlq.jsonl'),
    focusProfiles: { profiles: {} },
    suggestionsCatalog: {},
  });
}

const ABSENT = 'CH1TTY_TEST_G_ABSENT_XYZ_99999';
const EMPTY = 'CH1TTY_TEST_G_EMPTY_XYZ_99999';
const SET = 'CH1TTY_TEST_G_SET_XYZ_99999';

test('getMissingEnvVarDiagnostics: returns entry for remote server with unset envHeaders var', async () => {
  const dir = tempDir();
  delete process.env[ABSENT];

  const instance = agg(
    [
      {
        id: 'remote-absent',
        name: 'Remote Absent',
        type: 'remote',
        access: 'read',
        category: 'ecosystem',
        endpoint: 'https://example.invalid/mcp',
        envHeaders: { 'X-Auth': ABSENT },
      },
    ],
    dir,
  );
  try {
    const diags = instance.getMissingEnvVarDiagnostics();
    assert.equal(diags.length, 1);
    assert.equal(diags[0].serverId, 'remote-absent');
    assert.equal(diags[0].serverName, 'Remote Absent');
    assert.deepEqual(diags[0].vars, [ABSENT]);
  } finally {
    await instance.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getMissingEnvVarDiagnostics: treats empty-string env var as missing (matches doConnect)', async () => {
  const dir = tempDir();
  process.env[EMPTY] = '';

  const instance = agg(
    [
      {
        id: 'remote-empty',
        name: 'Remote Empty',
        type: 'remote',
        access: 'read',
        category: 'ecosystem',
        endpoint: 'https://example.invalid/mcp',
        envHeaders: { 'X-Auth': EMPTY },
      },
    ],
    dir,
  );
  try {
    const diags = instance.getMissingEnvVarDiagnostics();
    assert.equal(diags.length, 1);
    assert.deepEqual(diags[0].vars, [EMPTY]);
  } finally {
    delete process.env[EMPTY];
    await instance.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getMissingEnvVarDiagnostics: returns empty array when all envHeaders vars are set', async () => {
  const dir = tempDir();
  process.env[SET] = 'live-value';

  const instance = agg(
    [
      {
        id: 'remote-set',
        name: 'Remote Set',
        type: 'remote',
        access: 'read',
        category: 'ecosystem',
        endpoint: 'https://example.invalid/mcp',
        envHeaders: { 'X-Auth': SET },
      },
    ],
    dir,
  );
  try {
    const diags = instance.getMissingEnvVarDiagnostics();
    assert.equal(diags.length, 0);
  } finally {
    delete process.env[SET];
    await instance.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getMissingEnvVarDiagnostics: mixed envHeaders — only unset var names returned', async () => {
  const dir = tempDir();
  process.env[SET] = 'live-value';
  delete process.env[ABSENT];

  const instance = agg(
    [
      {
        id: 'remote-mixed',
        name: 'Remote Mixed',
        type: 'remote',
        access: 'read',
        category: 'ecosystem',
        endpoint: 'https://example.invalid/mcp',
        envHeaders: { 'X-Set': SET, 'X-Absent': ABSENT },
      },
    ],
    dir,
  );
  try {
    const diags = instance.getMissingEnvVarDiagnostics();
    assert.equal(diags.length, 1);
    assert.deepEqual(diags[0].vars, [ABSENT]);
  } finally {
    delete process.env[SET];
    await instance.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getMissingEnvVarDiagnostics: deduplicates var names when the same var is used for multiple headers', async () => {
  const dir = tempDir();
  delete process.env[ABSENT];

  const instance = agg(
    [
      {
        id: 'remote-dup',
        name: 'Remote Dup',
        type: 'remote',
        access: 'read',
        category: 'ecosystem',
        endpoint: 'https://example.invalid/mcp',
        envHeaders: { 'X-Auth-1': ABSENT, 'X-Auth-2': ABSENT },
      },
    ],
    dir,
  );
  try {
    const diags = instance.getMissingEnvVarDiagnostics();
    assert.equal(diags.length, 1);
    // same var referenced twice — deduplicated to one entry
    assert.deepEqual(diags[0].vars, [ABSENT]);
  } finally {
    await instance.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getMissingEnvVarDiagnostics: local server never included even if type is local', async () => {
  const dir = tempDir();

  const instance = agg(
    [
      {
        id: 'local-server',
        name: 'Local Server',
        type: 'local',
        access: 'read',
        category: 'code',
        command: '/bin/true',
      },
    ],
    dir,
  );
  try {
    const diags = instance.getMissingEnvVarDiagnostics();
    assert.equal(diags.length, 0);
  } finally {
    await instance.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getMissingEnvVarDiagnostics: remote server with no envHeaders returns empty', async () => {
  const dir = tempDir();

  const instance = agg(
    [
      {
        id: 'remote-no-env',
        name: 'Remote No Env',
        type: 'remote',
        access: 'read',
        category: 'ecosystem',
        endpoint: 'https://example.invalid/mcp',
      },
    ],
    dir,
  );
  try {
    const diags = instance.getMissingEnvVarDiagnostics();
    assert.equal(diags.length, 0);
  } finally {
    await instance.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getMissingEnvVarDiagnostics: header already in config.headers is not a false positive', async () => {
  const dir = tempDir();
  delete process.env[ABSENT];

  const instance = agg(
    [
      {
        id: 'remote-static-fallback',
        name: 'Remote Static Fallback',
        type: 'remote',
        access: 'read',
        category: 'ecosystem',
        endpoint: 'https://example.invalid/mcp',
        headers: { 'X-Auth': 'static-literal-value' },
        envHeaders: { 'X-Auth': ABSENT },
      },
    ],
    dir,
  );
  try {
    // config.headers already provides X-Auth; doConnect() will send it regardless of env var
    const diags = instance.getMissingEnvVarDiagnostics();
    assert.equal(diags.length, 0, 'should not warn when header has a static fallback');
  } finally {
    await instance.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getMissingEnvVarDiagnostics: Authorization covered by authTokenKey is not a false positive', async () => {
  const dir = tempDir();
  delete process.env[ABSENT];

  const instance = agg(
    [
      {
        id: 'remote-auth-key',
        name: 'Remote Auth Key',
        type: 'remote',
        access: 'read',
        category: 'ecosystem',
        endpoint: 'https://example.invalid/mcp',
        authTokenKey: 'some-token-key',
        envHeaders: { Authorization: ABSENT },
      },
    ],
    dir,
  );
  try {
    // authTokenKey is a fallback for Authorization in doConnect(); env var being unset is not fatal
    const diags = instance.getMissingEnvVarDiagnostics();
    assert.equal(diags.length, 0, 'should not warn when Authorization has authTokenKey fallback');
  } finally {
    await instance.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('getMissingEnvVarDiagnostics: multiple servers — only those with missing vars appear', async () => {
  const dir = tempDir();
  process.env[SET] = 'live-value';
  delete process.env[ABSENT];

  const instance = agg(
    [
      {
        id: 'server-ok',
        name: 'Server OK',
        type: 'remote',
        access: 'read',
        category: 'ecosystem',
        endpoint: 'https://example.invalid/mcp',
        envHeaders: { 'X-Auth': SET },
      },
      {
        id: 'server-broken',
        name: 'Server Broken',
        type: 'remote',
        access: 'read',
        category: 'ecosystem',
        endpoint: 'https://example.invalid/mcp',
        envHeaders: { 'X-Auth': ABSENT },
      },
    ],
    dir,
  );
  try {
    const diags = instance.getMissingEnvVarDiagnostics();
    assert.equal(diags.length, 1);
    assert.equal(diags[0].serverId, 'server-broken');
  } finally {
    delete process.env[SET];
    await instance.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
