/**
 * ZZZ batch — 4 tests covering previously untested validation branches in
 * src/config.ts:validateServerConfig():
 *
 * 1. servers[0].type → value is neither "local" nor "remote"
 *    (config.ts:147-149: `if (type !== 'local' && type !== 'remote') throw`)
 *
 * 2. servers[0].access → value is not in VALID_ACCESS = {read, write, readwrite}
 *    (config.ts:152-154: `if (!VALID_ACCESS.has(access)) throw`)
 *
 * 3. servers[0].category → value is not in VALID_CATEGORIES
 *    (config.ts:157-159: `if (!VALID_CATEGORIES.has(category)) throw`)
 *
 * 4. assertOptionalBoolean(): lazy/enabled field is present but not a boolean
 *    (config.ts:110-112: `if (typeof value !== 'boolean') throw`)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { validateServersConfig } from '../src/config.js';

// Minimal valid remote server — override individual fields in each test.
function remoteServer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'svc',
    name: 'Svc',
    type: 'remote',
    access: 'read',
    category: 'ecosystem',
    endpoint: 'https://svc.example.com/mcp',
    ...overrides,
  };
}

// ── 1. Invalid type value ─────────────────────────────────────────────────────

test('validateServersConfig: invalid type value → "type must be either local or remote"', () => {
  assert.throws(
    () => validateServersConfig({ servers: [remoteServer({ type: 'websocket' })] }),
    /type must be either "local" or "remote"/,
  );
});

// ── 2. Invalid access value ───────────────────────────────────────────────────

test('validateServersConfig: invalid access value → "access must be one of"', () => {
  assert.throws(
    () => validateServersConfig({ servers: [remoteServer({ access: 'admin' })] }),
    /access must be one of:/,
  );
});

// ── 3. Invalid category value ─────────────────────────────────────────────────

test('validateServersConfig: invalid category value → "category must be one of"', () => {
  assert.throws(
    () => validateServersConfig({ servers: [remoteServer({ category: 'widgets' })] }),
    /category must be one of:/,
  );
});

// ── 4. assertOptionalBoolean: non-boolean value for lazy field ────────────────

test('validateServersConfig: lazy with non-boolean value → "must be a boolean"', () => {
  // lazy is optional; when present it must be a boolean, not a string/number.
  assert.throws(
    () => validateServersConfig({ servers: [remoteServer({ lazy: 'yes' })] }),
    /must be a boolean/,
  );
});
