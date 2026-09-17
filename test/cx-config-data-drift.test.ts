/**
 * CX — config-data.ts drift detection.
 *
 * Verifies that REMOTE_SERVERS and FOCUS_PROFILES_RAW in src/config-data.ts
 * stay in sync with the authoritative files (servers.json, focus-profiles.json).
 *
 * The Worker embeds config-data.ts instead of reading files from disk (no
 * filesystem access). Drift between these sources is a silent bug: the Worker
 * silently loses a server or focus profile without any build-time error.
 *
 * Coverage:
 *   - Every REMOTE_SERVER in config-data.ts must appear in servers.json with a
 *     matching endpoint, authTokenKey (if set), access, category, and lazy flag.
 *   - Every focus profile in focus-profiles.json must appear in
 *     FOCUS_PROFILES_RAW with a matching boost value.
 *   - Every focus profile in FOCUS_PROFILES_RAW must appear in
 *     focus-profiles.json (no config-data.ts–only profiles).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Load authoritative sources ─────────────────────────────────────────────────

const serversJson = JSON.parse(readFileSync(join(ROOT, 'servers.json'), 'utf-8')) as {
  servers: Array<Record<string, unknown>>;
};

const focusProfilesJson = JSON.parse(
  readFileSync(join(ROOT, 'focus-profiles.json'), 'utf-8'),
) as { profiles: Record<string, { boost: number; description: string }> };

// ── REMOTE_SERVERS drift ───────────────────────────────────────────────────────

describe('REMOTE_SERVERS — config-data.ts vs servers.json', () => {
  // Late-import so the test file itself loads cleanly even if config-data.ts
  // has a syntax error (the error surfaces inside the test, not at suite parse).
  let REMOTE_SERVERS: Array<Record<string, unknown>>;

  test('config-data.ts imports without error', async () => {
    const mod = await import('../src/config-data.js');
    REMOTE_SERVERS = mod.REMOTE_SERVERS as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(REMOTE_SERVERS), 'REMOTE_SERVERS must be an array');
    assert.ok(REMOTE_SERVERS.length > 0, 'REMOTE_SERVERS must not be empty');
  });

  test('every REMOTE_SERVER has a matching entry in servers.json', async () => {
    const { REMOTE_SERVERS: rs } = await import('../src/config-data.js');
    const jsonServers = serversJson.servers.filter(
      (s): s is Record<string, unknown> => typeof s === 'object' && s !== null && 'id' in s,
    );
    const byId = new Map(jsonServers.map((s) => [s.id as string, s]));

    for (const server of rs) {
      const id = server.id as string;
      const jsonEntry = byId.get(id);
      assert.ok(
        jsonEntry !== undefined,
        `REMOTE_SERVERS entry '${id}' has no matching entry in servers.json`,
      );
    }
  });

  test('every REMOTE_SERVER endpoint matches servers.json', async () => {
    const { REMOTE_SERVERS: rs } = await import('../src/config-data.js');
    const jsonServers = serversJson.servers.filter(
      (s): s is Record<string, unknown> => typeof s === 'object' && s !== null && 'id' in s,
    );
    const byId = new Map(jsonServers.map((s) => [s.id as string, s]));

    for (const server of rs) {
      const id = server.id as string;
      const jsonEntry = byId.get(id);
      if (!jsonEntry) continue; // covered by previous test

      assert.strictEqual(
        server.endpoint,
        jsonEntry.endpoint,
        `endpoint mismatch for '${id}': config-data.ts has "${server.endpoint}", servers.json has "${jsonEntry.endpoint}"`,
      );
    }
  });

  test('every REMOTE_SERVER authTokenKey matches servers.json', async () => {
    const { REMOTE_SERVERS: rs } = await import('../src/config-data.js');
    const jsonServers = serversJson.servers.filter(
      (s): s is Record<string, unknown> => typeof s === 'object' && s !== null && 'id' in s,
    );
    const byId = new Map(jsonServers.map((s) => [s.id as string, s]));

    for (const server of rs) {
      const id = server.id as string;
      const jsonEntry = byId.get(id);
      if (!jsonEntry) continue;

      assert.strictEqual(
        server.authTokenKey ?? null,
        jsonEntry.authTokenKey ?? null,
        `authTokenKey mismatch for '${id}': config-data.ts has "${server.authTokenKey}", servers.json has "${jsonEntry.authTokenKey}"`,
      );
    }
  });

  test('every REMOTE_SERVER access matches servers.json', async () => {
    const { REMOTE_SERVERS: rs } = await import('../src/config-data.js');
    const jsonServers = serversJson.servers.filter(
      (s): s is Record<string, unknown> => typeof s === 'object' && s !== null && 'id' in s,
    );
    const byId = new Map(jsonServers.map((s) => [s.id as string, s]));

    for (const server of rs) {
      const id = server.id as string;
      const jsonEntry = byId.get(id);
      if (!jsonEntry) continue;

      assert.strictEqual(
        server.access,
        jsonEntry.access,
        `access mismatch for '${id}': config-data.ts has "${server.access}", servers.json has "${jsonEntry.access}"`,
      );
    }
  });

  test('every REMOTE_SERVER category matches servers.json', async () => {
    const { REMOTE_SERVERS: rs } = await import('../src/config-data.js');
    const jsonServers = serversJson.servers.filter(
      (s): s is Record<string, unknown> => typeof s === 'object' && s !== null && 'id' in s,
    );
    const byId = new Map(jsonServers.map((s) => [s.id as string, s]));

    for (const server of rs) {
      const id = server.id as string;
      const jsonEntry = byId.get(id);
      if (!jsonEntry) continue;

      assert.strictEqual(
        server.category,
        jsonEntry.category,
        `category mismatch for '${id}': config-data.ts has "${server.category}", servers.json has "${jsonEntry.category}"`,
      );
    }
  });

  test('every REMOTE_SERVER lazy flag matches servers.json', async () => {
    const { REMOTE_SERVERS: rs } = await import('../src/config-data.js');
    const jsonServers = serversJson.servers.filter(
      (s): s is Record<string, unknown> => typeof s === 'object' && s !== null && 'id' in s,
    );
    const byId = new Map(jsonServers.map((s) => [s.id as string, s]));

    for (const server of rs) {
      const id = server.id as string;
      const jsonEntry = byId.get(id);
      if (!jsonEntry) continue;

      assert.strictEqual(
        server.lazy,
        jsonEntry.lazy ?? false,
        `lazy mismatch for '${id}': config-data.ts has ${server.lazy}, servers.json has ${jsonEntry.lazy ?? false}`,
      );
    }
  });
});

// ── FOCUS_PROFILES_RAW drift ───────────────────────────────────────────────────

describe('FOCUS_PROFILES_RAW — config-data.ts vs focus-profiles.json', () => {
  test('every focus profile in focus-profiles.json appears in FOCUS_PROFILES_RAW', async () => {
    const { FOCUS_PROFILES_RAW } = await import('../src/config-data.js');
    const rawProfiles = Object.keys(FOCUS_PROFILES_RAW.profiles);

    for (const name of Object.keys(focusProfilesJson.profiles)) {
      assert.ok(
        rawProfiles.includes(name),
        `focus profile '${name}' is in focus-profiles.json but missing from FOCUS_PROFILES_RAW in config-data.ts`,
      );
    }
  });

  test('every focus profile in FOCUS_PROFILES_RAW appears in focus-profiles.json', async () => {
    const { FOCUS_PROFILES_RAW } = await import('../src/config-data.js');
    const jsonProfileNames = new Set(Object.keys(focusProfilesJson.profiles));

    for (const name of Object.keys(FOCUS_PROFILES_RAW.profiles)) {
      assert.ok(
        jsonProfileNames.has(name),
        `focus profile '${name}' is in FOCUS_PROFILES_RAW but missing from focus-profiles.json`,
      );
    }
  });

  test('focus profile boost values match between config-data.ts and focus-profiles.json', async () => {
    const { FOCUS_PROFILES_RAW } = await import('../src/config-data.js');
    const rawProfiles = FOCUS_PROFILES_RAW.profiles as Record<string, { boost: number }>;

    for (const [name, profile] of Object.entries(rawProfiles)) {
      const jsonProfile = focusProfilesJson.profiles[name];
      if (!jsonProfile) continue; // covered by previous test

      assert.strictEqual(
        profile.boost,
        jsonProfile.boost,
        `boost mismatch for profile '${name}': config-data.ts has ${profile.boost}, focus-profiles.json has ${jsonProfile.boost}`,
      );
    }
  });

  test('focus profile counts match between config-data.ts and focus-profiles.json', async () => {
    const { FOCUS_PROFILES_RAW } = await import('../src/config-data.js');
    const rawCount = Object.keys(FOCUS_PROFILES_RAW.profiles).length;
    const jsonCount = Object.keys(focusProfilesJson.profiles).length;

    assert.strictEqual(
      rawCount,
      jsonCount,
      `profile count mismatch: config-data.ts has ${rawCount} profiles, focus-profiles.json has ${jsonCount}`,
    );
  });
});
