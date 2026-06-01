/**
 * Config validation error paths not covered by config.test.ts or interpolation.test.ts.
 *
 * Specifically targets:
 *   - validateServersConfig root / servers structural errors
 *   - _comment entry filtering
 *   - loadConfigFromPath file-not-found + valid-JSON-but-invalid-config
 *   - type / access / category / lazy type enforcement
 *   - header value interpolation through validateServersConfig
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test, after } from 'node:test';
import { loadConfigFromPath, validateServersConfig } from '../src/config.js';

const tempDir = mkdtempSync(join(tmpdir(), 'ch1tty-config-val-'));
after(() => rmSync(tempDir, { recursive: true, force: true }));

function writeConfig(filename: string, content: string): string {
  const p = join(tempDir, filename);
  writeFileSync(p, content, 'utf-8');
  return p;
}

function remoteServer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'r1',
    name: 'Remote',
    type: 'remote',
    access: 'read',
    category: 'search',
    endpoint: 'https://example.com/mcp',
    ...overrides,
  };
}

function localServer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'l1',
    name: 'Local',
    type: 'local',
    access: 'readwrite',
    category: 'code',
    command: '/usr/bin/node',
    ...overrides,
  };
}

describe('validateServersConfig — structural errors', () => {
  test('throws when root is not an object (array)', () => {
    assert.throws(
      () => validateServersConfig([{ servers: [] }]),
      /Config root must be an object/,
    );
  });

  test('throws when root is not an object (string)', () => {
    assert.throws(
      () => validateServersConfig('{"servers":[]}'),
      /Config root must be an object/,
    );
  });

  test('throws when servers key is missing', () => {
    assert.throws(
      () => validateServersConfig({}),
      /must include a "servers" array/,
    );
  });

  test('throws when servers is not an array', () => {
    assert.throws(
      () => validateServersConfig({ servers: {} }),
      /must include a "servers" array/,
    );
  });

  test('_comment-only entries are filtered out, real entries still parsed', () => {
    const result = validateServersConfig({
      servers: [
        { _comment: 'this is a documentation comment' },
        remoteServer({ id: 'real' }),
      ],
    });
    assert.equal(result.servers.length, 1);
    assert.equal(result.servers[0].id, 'real');
  });

  test('all-comment config produces empty servers array', () => {
    const result = validateServersConfig({
      servers: [
        { _comment: 'first' },
        { _comment: 'second' },
      ],
    });
    assert.equal(result.servers.length, 0);
  });
});

describe('validateServersConfig — field type enforcement', () => {
  test('throws for invalid type value', () => {
    assert.throws(
      () => validateServersConfig({ servers: [remoteServer({ type: 'ftp' })] }),
      /type must be either "local" or "remote"/,
    );
  });

  test('throws for invalid access value', () => {
    assert.throws(
      () => validateServersConfig({ servers: [remoteServer({ access: 'superuser' })] }),
      /access must be one of/,
    );
  });

  test('throws for invalid category value', () => {
    assert.throws(
      () => validateServersConfig({ servers: [remoteServer({ category: 'gaming' })] }),
      /category must be one of/,
    );
  });

  test('throws for non-boolean lazy', () => {
    assert.throws(
      () => validateServersConfig({ servers: [localServer({ lazy: 'yes' })] }),
      /lazy must be a boolean/,
    );
  });

  test('throws for non-boolean enabled', () => {
    assert.throws(
      () => validateServersConfig({ servers: [localServer({ enabled: 1 })] }),
      /enabled must be a boolean/,
    );
  });
});

describe('validateServersConfig — header interpolation', () => {
  test('interpolates ${VAR} in remote server header values', () => {
    process.env.CH1TTY_SS_HDR_VAR = 'secret-token';
    try {
      const result = validateServersConfig({
        servers: [remoteServer({ headers: { Authorization: 'Bearer ${CH1TTY_SS_HDR_VAR}' } })],
      });
      const server = result.servers[0];
      assert.equal(server.type, 'remote');
      if (server.type === 'remote') {
        assert.deepEqual(server.headers, { Authorization: 'Bearer secret-token' });
      }
    } finally {
      delete process.env.CH1TTY_SS_HDR_VAR;
    }
  });

  test('throws when header references an unset env var', () => {
    delete process.env.CH1TTY_SS_MISSING_VAR;
    assert.throws(
      () => validateServersConfig({
        servers: [remoteServer({ headers: { Authorization: '${CH1TTY_SS_MISSING_VAR}' } })],
      }),
      /unset environment variable: CH1TTY_SS_MISSING_VAR/,
    );
  });
});

describe('loadConfigFromPath — file error paths', () => {
  test('throws with path in message when file does not exist', () => {
    const missingPath = join(tempDir, 'does-not-exist.json');
    assert.throws(
      () => loadConfigFromPath(missingPath),
      new RegExp(`Unable to read config at ${missingPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    );
  });

  test('throws with path in message when JSON is valid but config is invalid', () => {
    const p = writeConfig('invalid-config.json', JSON.stringify({ servers: [{ type: 'ftp' }] }));
    assert.throws(
      () => loadConfigFromPath(p),
      new RegExp(`Invalid config at ${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    );
  });
});
