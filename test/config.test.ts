import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadConfigFromPath, validateServersConfig } from '../src/config.js';

function localServer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'local-a',
    name: 'Local A',
    type: 'local',
    access: 'readwrite',
    category: 'code',
    command: 'node',
    ...overrides,
  };
}

function remoteServer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'remote-a',
    name: 'Remote A',
    type: 'remote',
    access: 'read',
    category: 'search',
    endpoint: 'https://example.com/mcp',
    ...overrides,
  };
}

test('validateServersConfig accepts valid local and remote servers', () => {
  const config = validateServersConfig({
    servers: [
      localServer({ args: ['index.js'], lazy: true }),
      remoteServer({ authTokenKey: 'key' }),
    ],
  });

  assert.equal(config.servers.length, 2);
  assert.equal(config.servers[0].id, 'local-a');
  assert.equal(config.servers[1].id, 'remote-a');
});

test('validateServersConfig rejects duplicate server ids', () => {
  assert.throws(
    () => validateServersConfig({
      servers: [
        localServer({ id: 'dup', name: 'A' }),
        remoteServer({ id: 'dup', name: 'B', endpoint: 'https://example.com' }),
      ],
    }),
    /Duplicate server id "dup"/,
  );
});

test('validateServersConfig enforces required fields by server type', () => {
  assert.throws(
    () => validateServersConfig({
      servers: [localServer({ command: undefined })],
    }),
    /command is required for local servers/,
  );

  assert.throws(
    () => validateServersConfig({
      servers: [remoteServer({ endpoint: undefined })],
    }),
    /endpoint is required for remote servers/,
  );
});

test('validateServersConfig enforces optional field types', () => {
  assert.throws(
    () => validateServersConfig({
      servers: [localServer({ args: [1, 2] })],
    }),
    /args must be an array of strings/,
  );

  assert.throws(
    () => validateServersConfig({
      servers: [localServer({ env: { FOO: 123 } })],
    }),
    /env\.FOO must be a string/,
  );
});

test('loadConfigFromPath fails fast on invalid JSON with path in message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-config-test-'));
  const filePath = join(dir, 'servers.json');

  try {
    writeFileSync(filePath, '{"servers": [}', 'utf8');
    assert.throws(
      () => loadConfigFromPath(filePath),
      new RegExp(`Invalid JSON in config at ${filePath.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
