/**
 * DX — register.json structural drift guard.
 *
 * register.json is the external-facing registration payload submitted to
 * register.chitty.cc. It declares the 5 slim-MCP meta-tools to the ChittyOS
 * registry. CLAUDE.md mandates the public surface is FIXED at exactly 5 tools
 * (search / execute / status / reload / cast) — never 4, never 6.
 *
 * Coverage:
 *   - File parses as valid JSON
 *   - All required top-level keys are present
 *   - version matches package.json (the two must stay in sync)
 *   - name is exactly 'ch1tty'
 *   - capabilities.tools has exactly 5 entries (CLAUDE.md invariant)
 *   - Tool names are the canonical 5 meta-tools in the expected order
 *   - No duplicate tool names
 *   - Each tool has required fields: name, description, inputSchema, http, access
 *   - Each tool's http object has method and path
 *   - Each tool's access is one of read / write / readwrite
 *   - /health, /api/v1/status, /mcp are all declared in endpoints
 *   - base_url uses https:// (no http:// or missing scheme)
 *   - tier is a positive integer
 *   - schema.entities includes Server, Tool, Resource, Prompt
 *   - security.authentication and security.encryption are non-empty strings
 *   - metadata.transport is non-empty
 *   - metadata.repository references the canonical org/repo
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_REGISTER = JSON.parse(readFileSync(join(ROOT, 'register.json'), 'utf-8')) as Record<string, unknown>;
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')) as { version: string };

// The canonical 5 meta-tools — order matches register.json as-authored.
// If someone reorders them without changing this list CI will fail, surfacing
// the change for human review before it reaches registry submission.
const EXPECTED_TOOL_NAMES = ['search', 'execute', 'status', 'reload', 'cast'] as const;
const EXPECTED_TOOL_NAME_SET = new Set<string>(EXPECTED_TOOL_NAMES);

const VALID_ACCESS = new Set(['read', 'write', 'readwrite']);
const REQUIRED_ENDPOINTS = ['/health', '/api/v1/status', '/mcp'];
const REQUIRED_SCHEMA_ENTITIES = ['Server', 'Tool', 'Resource', 'Prompt'];
const REQUIRED_TOP_LEVEL_KEYS = [
  'name', 'description', 'version', 'base_url', 'tier', 'domain',
  'canonicalUri', 'category', 'endpoints', 'schema', 'security',
  'metadata', 'capabilities',
];

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  http: { method: string; path: string };
  access: string;
};

describe('DX: register.json structural drift guard', () => {
  // ── Top-level structure ───────────────────────────────────────────────────

  test('parses as an object (not null, not array)', () => {
    assert.strictEqual(typeof RAW_REGISTER, 'object');
    assert.notStrictEqual(RAW_REGISTER, null);
    assert.ok(!Array.isArray(RAW_REGISTER));
  });

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    test(`has required top-level key: ${key}`, () => {
      assert.ok(Object.prototype.hasOwnProperty.call(RAW_REGISTER, key), `missing key: ${key}`);
    });
  }

  test('name is exactly "ch1tty"', () => {
    assert.strictEqual(RAW_REGISTER['name'], 'ch1tty');
  });

  test('description is a non-empty string', () => {
    const d = RAW_REGISTER['description'];
    assert.strictEqual(typeof d, 'string');
    assert.ok((d as string).length > 0);
  });

  test('version matches package.json version', () => {
    assert.strictEqual(
      RAW_REGISTER['version'],
      PKG.version,
      `register.json version (${RAW_REGISTER['version']}) does not match package.json (${PKG.version})`,
    );
  });

  test('base_url starts with https://', () => {
    const url = RAW_REGISTER['base_url'] as string;
    assert.strictEqual(typeof url, 'string');
    assert.ok(url.startsWith('https://'), `base_url must use https://, got: ${url}`);
  });

  test('tier is a positive integer', () => {
    const tier = RAW_REGISTER['tier'];
    assert.strictEqual(typeof tier, 'number');
    assert.ok(Number.isInteger(tier));
    assert.ok((tier as number) > 0, `tier must be positive, got: ${tier}`);
  });

  test('domain is a non-empty string', () => {
    const d = RAW_REGISTER['domain'];
    assert.strictEqual(typeof d, 'string');
    assert.ok((d as string).length > 0);
  });

  test('canonicalUri starts with chittycanon://', () => {
    const uri = RAW_REGISTER['canonicalUri'] as string;
    assert.strictEqual(typeof uri, 'string');
    assert.ok(uri.startsWith('chittycanon://'), `canonicalUri must start with chittycanon://, got: ${uri}`);
  });

  test('category is a non-empty string', () => {
    const c = RAW_REGISTER['category'];
    assert.strictEqual(typeof c, 'string');
    assert.ok((c as string).length > 0);
  });

  // ── Endpoints ─────────────────────────────────────────────────────────────

  test('endpoints is an array', () => {
    assert.ok(Array.isArray(RAW_REGISTER['endpoints']));
  });

  for (const ep of REQUIRED_ENDPOINTS) {
    test(`endpoints array includes ${ep}`, () => {
      const endpoints = RAW_REGISTER['endpoints'] as unknown[];
      assert.ok(
        endpoints.includes(ep),
        `register.json endpoints must include '${ep}'; found: ${JSON.stringify(endpoints)}`,
      );
    });
  }

  // ── Schema ─────────────────────────────────────────────────────────────────

  test('schema is a non-null object', () => {
    const s = RAW_REGISTER['schema'];
    assert.strictEqual(typeof s, 'object');
    assert.notStrictEqual(s, null);
  });

  test('schema.version is a non-empty string', () => {
    const sv = (RAW_REGISTER['schema'] as Record<string, unknown>)['version'];
    assert.strictEqual(typeof sv, 'string');
    assert.ok((sv as string).length > 0);
  });

  test('schema.entities is an array', () => {
    const entities = (RAW_REGISTER['schema'] as Record<string, unknown>)['entities'];
    assert.ok(Array.isArray(entities));
  });

  for (const entity of REQUIRED_SCHEMA_ENTITIES) {
    test(`schema.entities includes '${entity}'`, () => {
      const entities = (RAW_REGISTER['schema'] as Record<string, unknown>)['entities'] as unknown[];
      assert.ok(
        entities.includes(entity),
        `schema.entities must include '${entity}'; found: ${JSON.stringify(entities)}`,
      );
    });
  }

  // ── Security ──────────────────────────────────────────────────────────────

  test('security is a non-null object', () => {
    const s = RAW_REGISTER['security'];
    assert.strictEqual(typeof s, 'object');
    assert.notStrictEqual(s, null);
  });

  test('security.authentication is a non-empty string', () => {
    const auth = (RAW_REGISTER['security'] as Record<string, unknown>)['authentication'];
    assert.strictEqual(typeof auth, 'string');
    assert.ok((auth as string).length > 0);
  });

  test('security.encryption is a non-empty string', () => {
    const enc = (RAW_REGISTER['security'] as Record<string, unknown>)['encryption'];
    assert.strictEqual(typeof enc, 'string');
    assert.ok((enc as string).length > 0);
  });

  // ── Metadata ──────────────────────────────────────────────────────────────

  test('metadata is a non-null object', () => {
    const m = RAW_REGISTER['metadata'];
    assert.strictEqual(typeof m, 'object');
    assert.notStrictEqual(m, null);
  });

  test('metadata.transport is a non-empty string', () => {
    const t = (RAW_REGISTER['metadata'] as Record<string, unknown>)['transport'];
    assert.strictEqual(typeof t, 'string');
    assert.ok((t as string).length > 0);
  });

  test('metadata.repository references chittyos/ch1tty (case-insensitive)', () => {
    const repo = (RAW_REGISTER['metadata'] as Record<string, unknown>)['repository'] as string;
    assert.strictEqual(typeof repo, 'string');
    assert.ok(
      repo.toLowerCase().includes('chittyos/ch1tty'),
      `metadata.repository should reference chittyos/ch1tty; got: ${repo}`,
    );
  });

  // ── Capabilities / Tools ──────────────────────────────────────────────────

  test('capabilities is a non-null object', () => {
    const caps = RAW_REGISTER['capabilities'];
    assert.strictEqual(typeof caps, 'object');
    assert.notStrictEqual(caps, null);
  });

  test('capabilities.tools is an array', () => {
    const tools = (RAW_REGISTER['capabilities'] as Record<string, unknown>)['tools'];
    assert.ok(Array.isArray(tools), 'capabilities.tools must be an array');
  });

  test('capabilities.tools has exactly 5 entries (CLAUDE.md metric freeze)', () => {
    const tools = (RAW_REGISTER['capabilities'] as Record<string, unknown>)['tools'] as Tool[];
    assert.strictEqual(
      tools.length,
      5,
      `register.json MUST declare exactly 5 tools per CLAUDE.md; found ${tools.length}: ${tools.map(t => t.name).join(', ')}`,
    );
  });

  test('tool names are exactly the 5 canonical meta-tools in expected order', () => {
    const tools = (RAW_REGISTER['capabilities'] as Record<string, unknown>)['tools'] as Tool[];
    const names = tools.map(t => t.name);
    assert.deepStrictEqual(
      names,
      [...EXPECTED_TOOL_NAMES],
      `tool name order/content must be ${JSON.stringify(EXPECTED_TOOL_NAMES)}; got ${JSON.stringify(names)}`,
    );
  });

  test('no duplicate tool names', () => {
    const tools = (RAW_REGISTER['capabilities'] as Record<string, unknown>)['tools'] as Tool[];
    const names = tools.map(t => t.name);
    const unique = new Set(names);
    assert.strictEqual(unique.size, names.length, `duplicate tool names detected: ${names.join(', ')}`);
  });

  // Per-tool field assertions
  const TOOLS = ((RAW_REGISTER['capabilities'] as Record<string, unknown>)['tools'] ?? []) as Tool[];

  for (const toolName of EXPECTED_TOOL_NAMES) {
    test(`tool '${toolName}' is present`, () => {
      assert.ok(EXPECTED_TOOL_NAME_SET.has(toolName));
      const found = TOOLS.find(t => t.name === toolName);
      assert.ok(found, `tool '${toolName}' not found in capabilities.tools`);
    });

    test(`tool '${toolName}' has a non-empty description`, () => {
      const tool = TOOLS.find(t => t.name === toolName);
      if (!tool) return; // caught by presence test above
      assert.strictEqual(typeof tool.description, 'string');
      assert.ok(tool.description.length > 0, `tool '${toolName}' description must be non-empty`);
    });

    test(`tool '${toolName}' has inputSchema object`, () => {
      const tool = TOOLS.find(t => t.name === toolName);
      if (!tool) return;
      assert.strictEqual(typeof tool.inputSchema, 'object');
      assert.notStrictEqual(tool.inputSchema, null);
    });

    test(`tool '${toolName}' has http.method string`, () => {
      const tool = TOOLS.find(t => t.name === toolName);
      if (!tool) return;
      assert.ok(tool.http, `tool '${toolName}' missing http field`);
      assert.strictEqual(typeof tool.http.method, 'string');
      assert.ok(tool.http.method.length > 0);
    });

    test(`tool '${toolName}' has http.path starting with /`, () => {
      const tool = TOOLS.find(t => t.name === toolName);
      if (!tool) return;
      assert.ok(tool.http?.path?.startsWith('/'), `tool '${toolName}' http.path must start with /`);
    });

    test(`tool '${toolName}' access is valid (read|write|readwrite)`, () => {
      const tool = TOOLS.find(t => t.name === toolName);
      if (!tool) return;
      assert.ok(
        VALID_ACCESS.has(tool.access),
        `tool '${toolName}' access '${tool.access}' is not one of ${[...VALID_ACCESS].join('|')}`,
      );
    });
  }

  // ── Surface-level invariant summaries ─────────────────────────────────────

  test('read-access tools: search and status', () => {
    const readTools = TOOLS.filter(t => t.access === 'read').map(t => t.name).sort();
    assert.deepStrictEqual(readTools, ['search', 'status']);
  });

  test('write-access tools: reload only', () => {
    const writeTools = TOOLS.filter(t => t.access === 'write').map(t => t.name);
    assert.deepStrictEqual(writeTools, ['reload']);
  });

  test('readwrite-access tools: execute and cast', () => {
    const rwTools = TOOLS.filter(t => t.access === 'readwrite').map(t => t.name).sort();
    assert.deepStrictEqual(rwTools, ['cast', 'execute']);
  });

  test('all tool http paths are /mcp or /api/v1/status', () => {
    const allowedPaths = new Set(['/mcp', '/api/v1/status']);
    for (const tool of TOOLS) {
      assert.ok(
        allowedPaths.has(tool.http?.path),
        `tool '${tool.name}' http.path '${tool.http?.path}' is unexpected; must be one of ${[...allowedPaths].join(', ')}`,
      );
    }
  });

  test('inputSchema for search has properties.query', () => {
    const search = TOOLS.find(t => t.name === 'search');
    if (!search) return;
    const props = (search.inputSchema as Record<string, unknown>)['properties'] as Record<string, unknown>;
    assert.ok(props, 'search inputSchema missing properties');
    assert.ok('query' in props, 'search inputSchema missing query property');
  });

  test('inputSchema for execute has required: [tool]', () => {
    const execute = TOOLS.find(t => t.name === 'execute');
    if (!execute) return;
    const required = (execute.inputSchema as Record<string, unknown>)['required'] as unknown[];
    assert.ok(Array.isArray(required) && required.includes('tool'), 'execute inputSchema must require "tool"');
  });

  test('inputSchema for cast has required: [intent]', () => {
    const cast = TOOLS.find(t => t.name === 'cast');
    if (!cast) return;
    const required = (cast.inputSchema as Record<string, unknown>)['required'] as unknown[];
    assert.ok(Array.isArray(required) && required.includes('intent'), 'cast inputSchema must require "intent"');
  });
});
