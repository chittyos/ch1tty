/**
 * DC — servers.orchestrator.json drift detection.
 *
 * Verifies that `servers.orchestrator.json` stays structurally consistent with
 * the authoritative `servers.json`. The orchestrator profile is an intentional
 * subset that may override certain fields (endpoint, type, enabled) for clean
 * production-orchestration mode — but its logical identity fields (access,
 * category) must stay in sync, and it must never reference server IDs that
 * don't exist in the main registry.
 *
 * Without this guard, renaming or removing a server from servers.json while
 * leaving a stale reference in servers.orchestrator.json is a silent bug.
 *
 * Covered checks:
 *   1. servers.orchestrator.json parses as valid JSON without error.
 *   2. Every server ID in the orchestrator profile exists in servers.json.
 *   3. The orchestrator profile has no duplicate server IDs.
 *   4. Every orchestrator entry has required fields (id, name, type, access, category).
 *   5. `access` values match between orchestrator and servers.json for shared IDs.
 *   6. `category` values match between orchestrator and servers.json for shared IDs.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

type ServerEntry = Record<string, unknown>;

function loadJson(filename: string): { servers: ServerEntry[] } {
  const raw = readFileSync(join(ROOT, filename), 'utf-8');
  return JSON.parse(raw) as { servers: ServerEntry[] };
}

function realServers(entries: ServerEntry[]): ServerEntry[] {
  return entries.filter((s) => typeof s === 'object' && s !== null && 'id' in s);
}

describe('servers.orchestrator.json — drift guard', () => {
  test('servers.orchestrator.json parses without error', () => {
    const data = loadJson('servers.orchestrator.json');
    assert.ok(Array.isArray(data.servers), 'top-level "servers" key must be an array');
    assert.ok(data.servers.length > 0, '"servers" array must not be empty');
  });

  test('every orchestrator server ID exists in servers.json', () => {
    const main = loadJson('servers.json');
    const orch = loadJson('servers.orchestrator.json');

    const mainIds = new Set(realServers(main.servers).map((s) => s.id as string));
    const orchServers = realServers(orch.servers);

    for (const entry of orchServers) {
      const id = entry.id as string;
      assert.ok(
        mainIds.has(id),
        `orchestrator server '${id}' has no matching entry in servers.json — remove it or add it to servers.json`,
      );
    }
  });

  test('orchestrator profile has no duplicate server IDs', () => {
    const orch = loadJson('servers.orchestrator.json');
    const orchServers = realServers(orch.servers);
    const seen = new Set<string>();

    for (const entry of orchServers) {
      const id = entry.id as string;
      assert.ok(
        !seen.has(id),
        `duplicate server ID '${id}' in servers.orchestrator.json`,
      );
      seen.add(id);
    }
  });

  test('every orchestrator server entry has required fields', () => {
    const orch = loadJson('servers.orchestrator.json');
    const required = ['id', 'name', 'type', 'access', 'category'] as const;

    for (const entry of realServers(orch.servers)) {
      for (const field of required) {
        assert.ok(
          field in entry && entry[field] !== undefined && entry[field] !== null && entry[field] !== '',
          `orchestrator server '${entry.id}' is missing required field '${field}'`,
        );
      }
    }
  });

  test('orchestrator access values match servers.json', () => {
    const main = loadJson('servers.json');
    const orch = loadJson('servers.orchestrator.json');

    const mainById = new Map(realServers(main.servers).map((s) => [s.id as string, s]));

    for (const entry of realServers(orch.servers)) {
      const id = entry.id as string;
      const mainEntry = mainById.get(id);
      if (!mainEntry) continue; // covered by the ID-existence test above

      assert.strictEqual(
        entry.access,
        mainEntry.access,
        `access mismatch for '${id}': orchestrator has "${entry.access}", servers.json has "${mainEntry.access}"`,
      );
    }
  });

  test('orchestrator category values match servers.json', () => {
    const main = loadJson('servers.json');
    const orch = loadJson('servers.orchestrator.json');

    const mainById = new Map(realServers(main.servers).map((s) => [s.id as string, s]));

    for (const entry of realServers(orch.servers)) {
      const id = entry.id as string;
      const mainEntry = mainById.get(id);
      if (!mainEntry) continue;

      assert.strictEqual(
        entry.category,
        mainEntry.category,
        `category mismatch for '${id}': orchestrator has "${entry.category}", servers.json has "${mainEntry.category}"`,
      );
    }
  });
});
