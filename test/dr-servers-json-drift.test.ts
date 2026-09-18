/**
 * DR — servers.json structural drift guard.
 *
 * Parses the real servers.json against the production validateServersConfig()
 * validator and asserts structural invariants. Guards that the config on disk
 * is always valid and that the known set of 59 servers has not silently
 * changed in count, ID roster, type distribution, or field constraints.
 *
 * Coverage:
 *   - validateServersConfig() passes on the actual file (no exceptions)
 *   - Exactly 59 servers registered (non-comment entries)
 *   - No duplicate server IDs
 *   - All 59 known server IDs are present in the roster
 *   - All entries have id, name, type, access, category
 *   - Every category is within VALID_CATEGORIES
 *   - Every access level is within VALID_ACCESS
 *   - Local servers have a non-empty command field
 *   - Remote servers have a non-empty endpoint field
 *   - Type distribution: 17 local, 42 remote
 *   - Category distribution matches expected counts
 *   - Access distribution matches expected counts
 *   - 8 servers have enabled:false (disabled at this snapshot)
 *   - Remote non-localhost endpoints use https://
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { validateServersConfig } from '../src-stdio/config.js';

// Parse the URL and check the hostname exactly — prefix matching on the raw
// string allows http://127.attacker.example to pass a startsWith('http://127.')
// check. Using URL + isIP ensures only real loopback addresses are accepted.
const isLocalhost = (ep: string): boolean => {
  try {
    const { hostname } = new URL(ep);
    return hostname === 'localhost'
      || (isIP(hostname) === 4 && hostname.startsWith('127.'));
  } catch {
    return false;
  }
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = JSON.parse(readFileSync(join(ROOT, 'servers.json'), 'utf-8')) as unknown;

// Mirror VALID_CATEGORIES from src-stdio/config.ts so drift in the validator
// is also caught by this guard.
const VALID_CATEGORIES = new Set([
  'ecosystem', 'code', 'search', 'reasoning', 'desktop', 'documents', 'communication',
]);
const VALID_ACCESS = new Set(['read', 'write', 'readwrite']);

// Exhaustive snapshot of all 59 server IDs — update when a server is
// intentionally added or removed, keeping the count assertion in sync.
const EXPECTED_SERVER_IDS = [
  'tasks', 'ledger', 'session', 'chittyevidence', 'chittyos',
  'cloudflare', 'cloudflare-builds', 'evidence', 'browser-rendering', 'cowork',
  'github', 'linear', 'notion', 'stripe', 'neon',
  'context7', 'thinking', 'fs', 'playwright', 'chittymac',
  'imessage', 'comms', 'serena', 'quality', 'desktop',
  'chrome', 'pdf', 'orchestrator', 'connect', 'google',
  'finance', 'canon', 'schema', 'dispatch', 'monitor',
  'gam', 'comptroller', 'ship', 'scrape', 'storage',
  'turbotenant', 'dispute', 'auth', 'notes', 'resolve',
  'sandbox', 'viewport', 'market', 'autoassist', 'bindings',
  'cleaner', 'chatgpt', 'bluebubbles', 'ai', 'git',
  'helper', 'quo', 'context', 'contextual',
] as const;

// ── Parse + validate via the production validator ──────────────────────────────

describe('validateServersConfig() against real servers.json', () => {
  test('validator passes without throwing', () => {
    assert.doesNotThrow(() => validateServersConfig(RAW));
  });

  test('validated result has a servers array', () => {
    const result = validateServersConfig(RAW);
    assert.ok(Array.isArray(result.servers), 'result.servers must be an array');
  });
});

// ── Server count + ID roster ───────────────────────────────────────────────────

describe('server count and ID roster', () => {
  const validated = validateServersConfig(RAW);
  const servers = validated.servers;

  test('exactly 59 servers registered', () => {
    assert.equal(
      servers.length,
      59,
      `Expected 59 servers, got ${servers.length}. Update EXPECTED_SERVER_IDS if intentional.`,
    );
  });

  test('no duplicate server IDs', () => {
    const ids = servers.map((s) => s.id);
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const id of ids) {
      if (seen.has(id)) dupes.push(id);
      seen.add(id);
    }
    assert.deepEqual(dupes, [], `Duplicate server IDs found: ${dupes.join(', ')}`);
  });

  for (const expectedId of EXPECTED_SERVER_IDS) {
    test(`server "${expectedId}" is registered`, () => {
      const found = servers.some((s) => s.id === expectedId);
      assert.ok(found, `Expected server id "${expectedId}" not found in servers.json`);
    });
  }
});

// ── Required common fields ────────────────────────────────────────────────────

describe('all servers have required common fields', () => {
  const validated = validateServersConfig(RAW);

  for (const server of validated.servers) {
    test(`server "${server.id}" has non-empty id`, () => {
      assert.ok(typeof server.id === 'string' && server.id.length > 0);
    });

    test(`server "${server.id}" has non-empty name`, () => {
      assert.ok(typeof server.name === 'string' && server.name.length > 0);
    });

    test(`server "${server.id}" type is "local" or "remote"`, () => {
      assert.ok(
        server.type === 'local' || server.type === 'remote',
        `server "${server.id}" has unexpected type: ${server.type}`,
      );
    });

    test(`server "${server.id}" category is valid`, () => {
      assert.ok(
        VALID_CATEGORIES.has(server.category),
        `server "${server.id}" has invalid category: ${server.category}`,
      );
    });

    test(`server "${server.id}" access is valid`, () => {
      assert.ok(
        VALID_ACCESS.has(server.access),
        `server "${server.id}" has invalid access: ${server.access}`,
      );
    });
  }
});

// ── Type-specific required fields ─────────────────────────────────────────────

describe('type-specific field constraints', () => {
  const validated = validateServersConfig(RAW);
  const locals = validated.servers.filter((s) => s.type === 'local');
  const remotes = validated.servers.filter((s) => s.type === 'remote');

  for (const server of locals) {
    test(`local server "${server.id}" has non-empty command`, () => {
      assert.ok(
        typeof server.command === 'string' && server.command.length > 0,
        `local server "${server.id}" missing command`,
      );
    });
  }

  for (const server of remotes) {
    test(`remote server "${server.id}" has non-empty endpoint`, () => {
      assert.ok(
        typeof server.endpoint === 'string' && server.endpoint.length > 0,
        `remote server "${server.id}" missing endpoint`,
      );
    });

    test(`remote server "${server.id}" endpoint uses https (or is localhost)`, () => {
      const ep = server.endpoint as string;
      assert.ok(
        ep.startsWith('https://') || isLocalhost(ep),
        `remote server "${server.id}" endpoint is not HTTPS and not localhost: ${ep}`,
      );
    });
  }
});

// ── Type distribution ─────────────────────────────────────────────────────────

describe('type distribution', () => {
  const validated = validateServersConfig(RAW);
  const locals = validated.servers.filter((s) => s.type === 'local');
  const remotes = validated.servers.filter((s) => s.type === 'remote');

  test('17 local servers', () => {
    assert.equal(locals.length, 17, `Expected 17 local servers, got ${locals.length}`);
  });

  test('42 remote servers', () => {
    assert.equal(remotes.length, 42, `Expected 42 remote servers, got ${remotes.length}`);
  });
});

// ── Category distribution ──────────────────────────────────────────────────────

describe('category distribution', () => {
  const validated = validateServersConfig(RAW);

  const byCat = new Map<string, number>();
  for (const s of validated.servers) {
    byCat.set(s.category, (byCat.get(s.category) ?? 0) + 1);
  }

  const expected: Record<string, number> = {
    ecosystem: 39,
    desktop: 6,
    code: 4,
    documents: 4,
    communication: 4,
    search: 1,
    reasoning: 1,
  };

  for (const [cat, count] of Object.entries(expected)) {
    test(`category "${cat}" has ${count} server(s)`, () => {
      assert.equal(
        byCat.get(cat) ?? 0,
        count,
        `Expected ${count} server(s) in category "${cat}", got ${byCat.get(cat) ?? 0}`,
      );
    });
  }
});

// ── Access distribution ────────────────────────────────────────────────────────

describe('access distribution', () => {
  const validated = validateServersConfig(RAW);

  const byAccess = new Map<string, number>();
  for (const s of validated.servers) {
    byAccess.set(s.access, (byAccess.get(s.access) ?? 0) + 1);
  }

  const expected: Record<string, number> = {
    readwrite: 44,
    read: 14,
    write: 1,
  };

  for (const [acc, count] of Object.entries(expected)) {
    test(`access "${acc}" has ${count} server(s)`, () => {
      assert.equal(
        byAccess.get(acc) ?? 0,
        count,
        `Expected ${count} server(s) with access "${acc}", got ${byAccess.get(acc) ?? 0}`,
      );
    });
  }
});

// ── Enabled/disabled server snapshot ──────────────────────────────────────────

// Snapshot of the 8 servers that have enabled:false — these are local-only or
// conditional services (mac-only, VM bridges, dev-only). Update when intentionally
// enabling or disabling a server.
const EXPECTED_DISABLED_IDS = [
  'cowork', 'chittymac', 'imessage', 'serena',
  'quality', 'desktop', 'chrome', 'pdf',
] as const;

describe('enabled/disabled server snapshot', () => {
  const validated = validateServersConfig(RAW);

  test('exactly 8 servers have enabled:false at this snapshot', () => {
    const disabled = validated.servers.filter((s) => s.enabled === false);
    assert.equal(
      disabled.length,
      8,
      `Expected 8 disabled servers, got ${disabled.length}: ${disabled.map((s) => s.id).join(', ')}`,
    );
  });

  test('exactly 51 servers have enabled:true or no enabled field', () => {
    const active = validated.servers.filter((s) => s.enabled !== false);
    assert.equal(
      active.length,
      51,
      `Expected 51 active servers, got ${active.length}`,
    );
  });

  for (const id of EXPECTED_DISABLED_IDS) {
    test(`server "${id}" is in the expected-disabled roster`, () => {
      const server = validated.servers.find((s) => s.id === id);
      assert.ok(server, `Server "${id}" not found`);
      assert.equal(
        server.enabled,
        false,
        `Expected server "${id}" to have enabled:false`,
      );
    });
  }
});
