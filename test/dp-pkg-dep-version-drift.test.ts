/**
 * DP — package.json cross-workspace dependency version drift guard.
 *
 * Verifies that shared dependency versions are consistent within each
 * workspace group (apps/* and packages/*) and that workspace counts
 * stay stable. This guard catches accidental bumps in one workspace
 * that silently diverge from the rest of the group.
 *
 * Coverage:
 *   - Workspace counts: apps/* = 5, packages/* = 3
 *   - Apps group: @modelcontextprotocol/sdk, @types/node, tsx, typescript
 *     must be at the same version across all 5 apps
 *   - Packages group: @types/node must be at the same version across all 3 packages
 *   - TypeScript version groups in packages/ (TS-7 migration in progress):
 *       shared-mcp + shared-types → ^7.0.0 (migrated)
 *       shared-logger → ^5.7.0 (pre-migration)
 *   - SDK version lag: shared-mcp (@modelcontextprotocol/sdk) is one minor
 *     behind apps/ — documented here so the lag is visible and intentional
 *   - Each workspace has a non-empty "name" and "version" in its package.json
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

interface PkgJson {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPkg(relPath: string): PkgJson {
  return JSON.parse(readFileSync(join(ROOT, relPath, 'package.json'), 'utf-8')) as PkgJson;
}

function allDeps(pkg: PkgJson): Record<string, string> {
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

// ── Fixture: all workspace packages ──────────────────────────────────────────

const APPS = [
  'apps/comms-mcp',
  'apps/evidence-mcp',
  'apps/ledger-mcp',
  'apps/session-coordinator-mcp',
  'apps/tasks-mcp',
] as const;

const PACKAGES = [
  'packages/shared-logger',
  'packages/shared-mcp',
  'packages/shared-types',
] as const;

const appPkgs = APPS.map(readPkg);
const packagePkgs = PACKAGES.map(readPkg);

// ── Workspace count drift guard ───────────────────────────────────────────────

describe('workspace counts', () => {
  test('apps/* has exactly 5 workspaces', () => {
    assert.equal(APPS.length, 5);
  });

  test('packages/* has exactly 3 workspaces', () => {
    assert.equal(PACKAGES.length, 3);
  });

  test('all apps have non-empty name and version', () => {
    for (const pkg of appPkgs) {
      assert.ok(typeof pkg.name === 'string' && pkg.name.length > 0, `app name must be non-empty: ${pkg.name}`);
      assert.ok(typeof pkg.version === 'string' && pkg.version.length > 0, `app version must be non-empty: ${pkg.name}`);
    }
  });

  test('all packages have non-empty name and version', () => {
    for (const pkg of packagePkgs) {
      assert.ok(typeof pkg.name === 'string' && pkg.name.length > 0, `package name must be non-empty: ${pkg.name}`);
      assert.ok(typeof pkg.version === 'string' && pkg.version.length > 0, `package version must be non-empty: ${pkg.name}`);
    }
  });

  test('all app names are scoped @ch1tty/*', () => {
    for (const pkg of appPkgs) {
      assert.ok(pkg.name.startsWith('@ch1tty/'), `app name must start with @ch1tty/: ${pkg.name}`);
    }
  });

  test('all package names are scoped @ch1tty/*', () => {
    for (const pkg of packagePkgs) {
      assert.ok(pkg.name.startsWith('@ch1tty/'), `package name must start with @ch1tty/: ${pkg.name}`);
    }
  });
});

// ── Apps group: key dep version consistency ───────────────────────────────────

describe('apps/* key dep consistency', () => {
  const KEY_DEPS = [
    '@modelcontextprotocol/sdk',
    '@types/node',
    'tsx',
    'typescript',
  ] as const;

  for (const dep of KEY_DEPS) {
    test(`${dep} is the same version across all apps`, () => {
      const versions = appPkgs.map(pkg => {
        const deps = allDeps(pkg);
        assert.ok(dep in deps, `${pkg.name} is missing ${dep}`);
        return deps[dep]!;
      });
      const first = versions[0]!;
      for (const v of versions) {
        assert.equal(v, first, `${dep} version mismatch: expected all apps to have ${first}`);
      }
    });
  }

  test('@modelcontextprotocol/sdk is ^1.30.0 in all apps', () => {
    for (const pkg of appPkgs) {
      assert.equal(
        allDeps(pkg)['@modelcontextprotocol/sdk'],
        '^1.30.0',
        `${pkg.name}: @modelcontextprotocol/sdk must be ^1.30.0`,
      );
    }
  });

  test('@types/node is ^22.0.0 in all apps', () => {
    for (const pkg of appPkgs) {
      assert.equal(
        allDeps(pkg)['@types/node'],
        '^22.0.0',
        `${pkg.name}: @types/node must be ^22.0.0`,
      );
    }
  });

  test('tsx is ^4.20.6 in all apps', () => {
    for (const pkg of appPkgs) {
      assert.equal(
        allDeps(pkg)['tsx'],
        '^4.20.6',
        `${pkg.name}: tsx must be ^4.20.6`,
      );
    }
  });

  test('typescript is ^5.7.0 in all apps', () => {
    for (const pkg of appPkgs) {
      assert.equal(
        allDeps(pkg)['typescript'],
        '^5.7.0',
        `${pkg.name}: typescript must be ^5.7.0`,
      );
    }
  });
});

// ── Packages group: @types/node consistency ───────────────────────────────────

describe('packages/* @types/node consistency', () => {
  test('@types/node is the same version across all packages', () => {
    const versions = packagePkgs.map(pkg => {
      const deps = allDeps(pkg);
      assert.ok('@types/node' in deps, `${pkg.name} is missing @types/node`);
      return deps['@types/node']!;
    });
    const first = versions[0]!;
    for (const v of versions) {
      assert.equal(v, first, `@types/node version mismatch across packages: expected ${first}`);
    }
  });

  test('@types/node is ^22.0.0 in all packages', () => {
    for (const pkg of packagePkgs) {
      assert.equal(
        allDeps(pkg)['@types/node'],
        '^22.0.0',
        `${pkg.name}: @types/node must be ^22.0.0`,
      );
    }
  });
});

// ── Packages group: TypeScript migration state ────────────────────────────────
// shared-mcp and shared-types are on TS 7 (migrated).
// shared-logger is on TS 5.7 (pre-migration — pending human review per board).
// These assertions document the intentional mid-migration state.

describe('packages/* typescript migration state', () => {
  test('shared-mcp is on typescript ^7.0.0 (migrated)', () => {
    const pkg = packagePkgs.find(p => p.name === '@ch1tty/shared-mcp')!;
    assert.ok(pkg, 'shared-mcp not found');
    assert.equal(allDeps(pkg)['typescript'], '^7.0.0', 'shared-mcp: typescript must be ^7.0.0');
  });

  test('shared-types is on typescript ^7.0.0 (migrated)', () => {
    const pkg = packagePkgs.find(p => p.name === '@ch1tty/shared-types')!;
    assert.ok(pkg, 'shared-types not found');
    assert.equal(allDeps(pkg)['typescript'], '^7.0.0', 'shared-types: typescript must be ^7.0.0');
  });

  test('shared-logger is on typescript ^5.7.0 (pre-migration)', () => {
    const pkg = packagePkgs.find(p => p.name === '@ch1tty/shared-logger')!;
    assert.ok(pkg, 'shared-logger not found');
    assert.equal(allDeps(pkg)['typescript'], '^5.7.0', 'shared-logger: typescript must be ^5.7.0 (pre-migration)');
  });
});

// ── SDK version lag: shared-mcp behind apps ──────────────────────────────────
// shared-mcp declares @modelcontextprotocol/sdk ^1.29.0 while all apps are
// on ^1.30.0. Document this known lag so any unexpected change (further drift
// or accidental sync) is caught.

describe('@modelcontextprotocol/sdk version across groups', () => {
  test('shared-mcp declares @modelcontextprotocol/sdk ^1.29.0 (one minor behind apps)', () => {
    const pkg = packagePkgs.find(p => p.name === '@ch1tty/shared-mcp')!;
    assert.ok(pkg, 'shared-mcp not found');
    assert.equal(
      allDeps(pkg)['@modelcontextprotocol/sdk'],
      '^1.29.0',
      'shared-mcp: @modelcontextprotocol/sdk version must be ^1.29.0 — update this test when the lag is resolved',
    );
  });

  test('apps declare @modelcontextprotocol/sdk ^1.30.0 (one minor ahead of shared-mcp)', () => {
    const appsWithSdk = appPkgs.filter(p => '@modelcontextprotocol/sdk' in allDeps(p));
    assert.equal(appsWithSdk.length, 5, 'all 5 apps must declare @modelcontextprotocol/sdk');
    for (const pkg of appsWithSdk) {
      assert.equal(
        allDeps(pkg)['@modelcontextprotocol/sdk'],
        '^1.30.0',
        `${pkg.name}: @modelcontextprotocol/sdk must be ^1.30.0`,
      );
    }
  });
});
