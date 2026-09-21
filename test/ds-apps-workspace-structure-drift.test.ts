/**
 * DS — apps/*-mcp workspace structure drift guard.
 *
 * Freezes the structural invariants of the five focused per-domain MCP
 * servers under apps/: their directory presence, required source files,
 * package.json fields, and servers.json registrations. CI fails the moment
 * any of these invariants drifts — an app directory disappears, a required
 * file is removed, or the server registration breaks.
 *
 * Frozen roster (2026-09-18):
 *   apps/tasks-mcp/               → servers.json id: "tasks"
 *   apps/ledger-mcp/              → servers.json id: "ledger"
 *   apps/session-coordinator-mcp/ → servers.json id: "session"
 *   apps/evidence-mcp/            → servers.json id: "chittyevidence"
 *   apps/comms-mcp/               → servers.json id: "comms"
 *
 * Each mapping is verified in four dimensions:
 *   1. App directory exists under apps/
 *   2. Required files present: package.json, tsconfig.json, src/index.ts
 *   3. package.json fields: name (@ch1tty/<dir>), version (semver), scripts.build, type
 *   4. servers.json registration: id present, type local, dist path correct, enabled
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

type AppEntry = {
  serverId: string;
  distPath: string;
};

const APP_SERVER_MAP: Record<string, AppEntry> = {
  'tasks-mcp': {
    serverId: 'tasks',
    distPath: './apps/tasks-mcp/dist/index.js',
  },
  'ledger-mcp': {
    serverId: 'ledger',
    distPath: './apps/ledger-mcp/dist/index.js',
  },
  'session-coordinator-mcp': {
    serverId: 'session',
    distPath: './apps/session-coordinator-mcp/dist/index.js',
  },
  'evidence-mcp': {
    serverId: 'chittyevidence',
    distPath: './apps/evidence-mcp/dist/index.js',
  },
  'comms-mcp': {
    serverId: 'comms',
    distPath: './apps/comms-mcp/dist/index.js',
  },
};

const APP_DIRS = Object.keys(APP_SERVER_MAP) as (keyof typeof APP_SERVER_MAP)[];

// Parse servers.json once
const serversJson = JSON.parse(readFileSync(join(ROOT, 'servers.json'), 'utf-8')) as {
  servers: Array<Record<string, unknown>>;
};
const serverById = new Map<string, Record<string, unknown>>();
for (const s of serversJson.servers) {
  if (typeof s === 'object' && s !== null && typeof s['id'] === 'string') {
    serverById.set(s['id'], s);
  }
}

describe('DS: apps/*-mcp directory presence', () => {
  for (const appDir of APP_DIRS) {
    test(`apps/${appDir}/ exists`, () => {
      assert.ok(
        existsSync(join(ROOT, 'apps', appDir)),
        `Expected apps/${appDir}/ to exist`,
      );
    });
  }
});

describe('DS: apps/*-mcp required files', () => {
  const REQUIRED_FILES = ['package.json', 'tsconfig.json', 'src/index.ts'];
  for (const appDir of APP_DIRS) {
    for (const file of REQUIRED_FILES) {
      test(`apps/${appDir}/${file} exists`, () => {
        assert.ok(
          existsSync(join(ROOT, 'apps', appDir, file)),
          `Expected apps/${appDir}/${file} to exist`,
        );
      });
    }
  }
});

describe('DS: apps/*-mcp package.json fields', () => {
  for (const appDir of APP_DIRS) {
    const pkgPath = join(ROOT, 'apps', appDir, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;

    test(`apps/${appDir}/package.json name is @ch1tty/${appDir}`, () => {
      assert.equal(
        pkg['name'],
        `@ch1tty/${appDir}`,
        `apps/${appDir}/package.json: name must be @ch1tty/${appDir}`,
      );
    });

    test(`apps/${appDir}/package.json version is semver string`, () => {
      assert.ok(
        typeof pkg['version'] === 'string' && /^\d+\.\d+\.\d+/.test(pkg['version'] as string),
        `apps/${appDir}/package.json: version must be a semver string, got ${String(pkg['version'])}`,
      );
    });

    test(`apps/${appDir}/package.json scripts.build is non-empty`, () => {
      const scripts = pkg['scripts'] as Record<string, unknown> | undefined;
      assert.ok(
        scripts !== undefined && typeof scripts['build'] === 'string' && (scripts['build'] as string).length > 0,
        `apps/${appDir}/package.json: scripts.build must be a non-empty string`,
      );
    });

    test(`apps/${appDir}/package.json type is "module"`, () => {
      assert.equal(
        pkg['type'],
        'module',
        `apps/${appDir}/package.json: type must be "module"`,
      );
    });
  }
});

describe('DS: apps/*-mcp servers.json registrations', () => {
  for (const appDir of APP_DIRS) {
    const { serverId, distPath } = APP_SERVER_MAP[appDir];

    test(`servers.json has entry for apps/${appDir} (id: "${serverId}")`, () => {
      assert.ok(
        serverById.has(serverId),
        `Expected servers.json to have an entry with id="${serverId}" for apps/${appDir}`,
      );
    });

    test(`servers.json id="${serverId}" has type "local"`, () => {
      const entry = serverById.get(serverId);
      assert.equal(
        entry?.['type'],
        'local',
        `servers.json id="${serverId}": type must be "local"`,
      );
    });

    test(`servers.json id="${serverId}" args contains "${distPath}"`, () => {
      const entry = serverById.get(serverId);
      const args = entry?.['args'] as string[] | undefined;
      assert.ok(
        Array.isArray(args) && args.includes(distPath),
        `servers.json id="${serverId}": args must contain "${distPath}", got ${JSON.stringify(args)}`,
      );
    });

    test(`servers.json id="${serverId}" is enabled`, () => {
      const entry = serverById.get(serverId);
      assert.notEqual(
        entry?.['enabled'],
        false,
        `servers.json id="${serverId}": must not be disabled (enabled: false)`,
      );
    });
  }
});

describe('DS: apps/*-mcp exact roster snapshot', () => {
  test('exactly 5 apps directories in APP_SERVER_MAP', () => {
    assert.equal(APP_DIRS.length, 5, 'Expected exactly 5 apps in the roster');
  });

  test('APP_SERVER_MAP server IDs match expected roster exactly', () => {
    const expectedIds = new Set(['tasks', 'ledger', 'session', 'chittyevidence', 'comms']);
    const actualIds = new Set(Object.values(APP_SERVER_MAP).map((e) => e.serverId));
    assert.deepEqual(
      [...actualIds].sort(),
      [...expectedIds].sort(),
      'Server ID roster has changed — update this snapshot if intentional',
    );
  });

  test('all 5 app server IDs are registered in servers.json', () => {
    for (const { serverId } of Object.values(APP_SERVER_MAP)) {
      assert.ok(
        serverById.has(serverId),
        `Server id="${serverId}" is in the roster but missing from servers.json`,
      );
    }
  });
});
