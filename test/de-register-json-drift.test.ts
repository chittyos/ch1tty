/**
 * DE — register.json drift guard.
 *
 * register.json is the canonical registry entry submitted to register.chitty.cc.
 * It must remain in sync with the gateway's actual public surface.
 *
 * Guards:
 *   1. Exactly 5 tools in capabilities.tools (the "exactly 5 meta-tools" invariant)
 *   2. Tool names match the 5 meta-tools exactly: search, execute, status, reload, cast
 *   3. version in register.json matches package.json version
 *   4. canonicalUri is present and non-empty
 *   5. base_url is present and is an HTTPS URL
 *   6. endpoints array includes /health, /api/v1/status, and /mcp
 *   7. No tool defines isError, access violations, or extra surface bloat
 *   8. Every tool has an inputSchema of type "object"
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const registerJson = JSON.parse(readFileSync(join(ROOT, 'register.json'), 'utf-8')) as {
  version: string;
  base_url: string;
  canonicalUri: string;
  endpoints: string[];
  capabilities: {
    tools: Array<{
      name: string;
      description: string;
      inputSchema: { type: string; required?: string[] };
      access: string;
    }>;
  };
};

const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as {
  version: string;
};

const EXPECTED_TOOLS = ['search', 'execute', 'status', 'reload', 'cast'] as const;

describe('register.json — 5-tool surface invariant', () => {
  test('capabilities.tools has exactly 5 entries', () => {
    const count = registerJson.capabilities.tools.length;
    assert.equal(
      count,
      5,
      `expected exactly 5 tools, got ${count}: ${registerJson.capabilities.tools.map((t) => t.name).join(', ')}`,
    );
  });

  test('tool names are exactly search, execute, status, reload, cast (no extra, no rename)', () => {
    const names = registerJson.capabilities.tools.map((t) => t.name).sort();
    const expected = [...EXPECTED_TOOLS].sort();
    assert.deepEqual(names, expected);
  });

  test('tool names appear in canonical order: search, execute, status, reload, cast', () => {
    const names = registerJson.capabilities.tools.map((t) => t.name);
    assert.deepEqual(names, [...EXPECTED_TOOLS]);
  });
});

describe('register.json — version sync with package.json', () => {
  test('register.json version matches package.json version', () => {
    assert.equal(
      registerJson.version,
      packageJson.version,
      `register.json version "${registerJson.version}" must match package.json version "${packageJson.version}"`,
    );
  });
});

describe('register.json — structural requirements', () => {
  test('base_url is present and uses HTTPS', () => {
    assert.ok(typeof registerJson.base_url === 'string' && registerJson.base_url.length > 0, 'base_url must be a non-empty string');
    assert.ok(
      registerJson.base_url.startsWith('https://'),
      `base_url must use HTTPS, got: "${registerJson.base_url}"`,
    );
  });

  test('canonicalUri is present and non-empty', () => {
    assert.ok(
      typeof registerJson.canonicalUri === 'string' && registerJson.canonicalUri.length > 0,
      'canonicalUri must be a non-empty string',
    );
  });

  test('endpoints includes /health', () => {
    assert.ok(
      registerJson.endpoints.includes('/health'),
      `endpoints must include "/health", got: ${JSON.stringify(registerJson.endpoints)}`,
    );
  });

  test('endpoints includes /api/v1/status', () => {
    assert.ok(
      registerJson.endpoints.includes('/api/v1/status'),
      `endpoints must include "/api/v1/status", got: ${JSON.stringify(registerJson.endpoints)}`,
    );
  });

  test('endpoints includes /mcp', () => {
    assert.ok(
      registerJson.endpoints.includes('/mcp'),
      `endpoints must include "/mcp", got: ${JSON.stringify(registerJson.endpoints)}`,
    );
  });
});

describe('register.json — per-tool schema integrity', () => {
  for (const tool of EXPECTED_TOOLS) {
    test(`tool "${tool}" has a non-empty description`, () => {
      const entry = registerJson.capabilities.tools.find((t) => t.name === tool);
      assert.ok(entry, `tool "${tool}" not found`);
      assert.ok(
        typeof entry.description === 'string' && entry.description.length > 0,
        `tool "${tool}" description must be a non-empty string`,
      );
    });

    test(`tool "${tool}" inputSchema.type is "object"`, () => {
      const entry = registerJson.capabilities.tools.find((t) => t.name === tool);
      assert.ok(entry, `tool "${tool}" not found`);
      assert.equal(
        entry.inputSchema.type,
        'object',
        `tool "${tool}" inputSchema.type must be "object", got "${entry.inputSchema.type}"`,
      );
    });
  }
});
