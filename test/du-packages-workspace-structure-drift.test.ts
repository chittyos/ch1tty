/**
 * DU — packages/* workspace structure drift guard.
 *
 * Freezes the structural invariants of the three shared packages under
 * packages/: their directory presence, required source files, package.json
 * fields, workspace linkage in the root package.json, and cross-package
 * version consistency. CI fails the moment any of these invariants drift —
 * a package directory disappears, a required export file is removed, a
 * package.json field is hollowed out, or a workspace reference breaks.
 *
 * Frozen roster (2026-09-19):
 *   packages/shared-logger/  → @ch1tty/shared-logger
 *   packages/shared-mcp/     → @ch1tty/shared-mcp
 *   packages/shared-types/   → @ch1tty/shared-types
 *
 * Coverage:
 *   - Each package directory exists under packages/
 *   - Required files present per package (package.json, src/index.ts, and
 *     package-specific extras for shared-mcp)
 *   - package.json required fields: name, version (semver), type ("module"),
 *     scripts.build, exports["."] entry
 *   - Package name matches "@ch1tty/<dir>" convention
 *   - All three packages share the same version (version consistency)
 *   - Root package.json workspaces array includes "packages/*"
 *   - Root dependencies reference all three packages as workspace:*
 *   - Root workspaces and root deps are in bidirectional sync for the
 *     @ch1tty/ scope (no undeclared or stale references)
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Package roster ────────────────────────────────────────────────────────────

type PkgEntry = {
  npmName: string;
  extraSrcFiles?: string[];
};

const PACKAGES: Record<string, PkgEntry> = {
  'shared-logger': {
    npmName: '@ch1tty/shared-logger',
  },
  'shared-mcp': {
    npmName: '@ch1tty/shared-mcp',
    extraSrcFiles: ['bearer-auth.ts', 'session-manager.ts'],
  },
  'shared-types': {
    npmName: '@ch1tty/shared-types',
  },
};

const PKG_DIRS = Object.keys(PACKAGES) as (keyof typeof PACKAGES)[];

// ── Root package.json (parsed once) ──────────────────────────────────────────

const rootPkg = JSON.parse(
  readFileSync(join(ROOT, 'package.json'), 'utf-8'),
) as {
  workspaces?: string[];
  dependencies?: Record<string, string>;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function readPkg(pkgDir: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(ROOT, 'packages', pkgDir, 'package.json'), 'utf-8'),
  ) as Record<string, unknown>;
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DU: packages/* directory presence', () => {
  for (const pkgDir of PKG_DIRS) {
    test(`packages/${pkgDir}/ exists`, () => {
      assert.ok(
        existsSync(join(ROOT, 'packages', pkgDir)),
        `Expected packages/${pkgDir}/ to exist`,
      );
    });
  }
});

describe('DU: packages/* required files', () => {
  for (const pkgDir of PKG_DIRS) {
    const { extraSrcFiles = [] } = PACKAGES[pkgDir]!;
    const requiredFiles = ['package.json', 'src/index.ts', ...extraSrcFiles.map(f => `src/${f}`)];

    for (const file of requiredFiles) {
      test(`packages/${pkgDir}/${file} exists`, () => {
        assert.ok(
          existsSync(join(ROOT, 'packages', pkgDir, file)),
          `Expected packages/${pkgDir}/${file} to exist`,
        );
      });
    }
  }
});

describe('DU: packages/* package.json — required fields', () => {
  for (const pkgDir of PKG_DIRS) {
    const { npmName } = PACKAGES[pkgDir]!;
    const pkg = readPkg(pkgDir);

    test(`packages/${pkgDir}: name is "${npmName}"`, () => {
      assert.strictEqual(pkg['name'], npmName, `packages/${pkgDir}/package.json name mismatch`);
    });

    test(`packages/${pkgDir}: version is a semver string`, () => {
      assert.ok(
        typeof pkg['version'] === 'string' && SEMVER_RE.test(pkg['version']),
        `packages/${pkgDir}/package.json version must be semver, got ${JSON.stringify(pkg['version'])}`,
      );
    });

    test(`packages/${pkgDir}: type is "module"`, () => {
      assert.strictEqual(
        pkg['type'],
        'module',
        `packages/${pkgDir}/package.json type must be "module"`,
      );
    });

    test(`packages/${pkgDir}: scripts.build is "tsc"`, () => {
      const scripts = pkg['scripts'] as Record<string, unknown> | undefined;
      assert.ok(
        typeof scripts === 'object' && scripts !== null,
        `packages/${pkgDir}/package.json must have a scripts object`,
      );
      assert.strictEqual(
        scripts['build'],
        'tsc',
        `packages/${pkgDir}/package.json scripts.build must be "tsc"`,
      );
    });

    test(`packages/${pkgDir}: exports["."] entry exists`, () => {
      const exports = pkg['exports'] as Record<string, unknown> | undefined;
      assert.ok(
        typeof exports === 'object' && exports !== null && '.' in exports,
        `packages/${pkgDir}/package.json must have an exports["."] entry`,
      );
    });

    test(`packages/${pkgDir}: main field is "dist/index.js"`, () => {
      assert.strictEqual(
        pkg['main'],
        'dist/index.js',
        `packages/${pkgDir}/package.json main must be "dist/index.js"`,
      );
    });
  }
});

describe('DU: packages/* name convention', () => {
  for (const pkgDir of PKG_DIRS) {
    test(`packages/${pkgDir}: name matches @ch1tty/${pkgDir}`, () => {
      const pkg = readPkg(pkgDir);
      assert.strictEqual(
        pkg['name'],
        `@ch1tty/${pkgDir}`,
        `packages/${pkgDir}/package.json name should be @ch1tty/${pkgDir}`,
      );
    });
  }
});

describe('DU: packages/* cross-package version consistency', () => {
  test('all packages share the same version string', () => {
    const versions = PKG_DIRS.map(pkgDir => {
      const pkg = readPkg(pkgDir);
      return { pkgDir, version: pkg['version'] as string };
    });

    const unique = new Set(versions.map(v => v.version));
    assert.strictEqual(
      unique.size,
      1,
      `All packages must share the same version. Found: ${versions.map(v => `${v.pkgDir}@${v.version}`).join(', ')}`,
    );
  });

  test('all packages are at a valid semver version', () => {
    for (const pkgDir of PKG_DIRS) {
      const pkg = readPkg(pkgDir);
      assert.ok(
        typeof pkg['version'] === 'string' && SEMVER_RE.test(pkg['version']),
        `packages/${pkgDir} version is not valid semver: ${JSON.stringify(pkg['version'])}`,
      );
    }
  });
});

describe('DU: root package.json workspaces includes packages/*', () => {
  test('workspaces array exists', () => {
    assert.ok(
      Array.isArray(rootPkg.workspaces),
      'root package.json must have a workspaces array',
    );
  });

  test('workspaces includes "packages/*"', () => {
    assert.ok(
      Array.isArray(rootPkg.workspaces) && rootPkg.workspaces.includes('packages/*'),
      'root package.json workspaces must include "packages/*"',
    );
  });
});

describe('DU: root package.json dependencies reference all packages as workspace:*', () => {
  for (const pkgDir of PKG_DIRS) {
    const { npmName } = PACKAGES[pkgDir]!;

    test(`root dependencies["${npmName}"] is "workspace:*"`, () => {
      assert.ok(
        typeof rootPkg.dependencies === 'object' && rootPkg.dependencies !== null,
        'root package.json must have a dependencies object',
      );
      assert.strictEqual(
        rootPkg.dependencies![npmName],
        'workspace:*',
        `root package.json must reference ${npmName} as workspace:*`,
      );
    });
  }
});

describe('DU: no undeclared @ch1tty/* packages in root deps', () => {
  test('every @ch1tty/* root dependency has a matching packages/ directory', () => {
    const deps = rootPkg.dependencies ?? {};
    const chittydeps = Object.keys(deps).filter(k => k.startsWith('@ch1tty/'));
    const knownNames = new Set(PKG_DIRS.map(d => `@ch1tty/${d}`));

    for (const dep of chittydeps) {
      assert.ok(
        knownNames.has(dep),
        `Root dep "${dep}" is not in the frozen packages roster — update DU if intentional`,
      );
    }
  });

  test('no stale @ch1tty/* packages/ directories missing from root deps', () => {
    const deps = rootPkg.dependencies ?? {};
    for (const pkgDir of PKG_DIRS) {
      const npmName = `@ch1tty/${pkgDir}`;
      assert.ok(
        npmName in deps,
        `packages/${pkgDir} exists but "${npmName}" is not listed in root package.json dependencies`,
      );
    }
  });
});

describe('DU: packages/* tsconfig.json presence', () => {
  for (const pkgDir of PKG_DIRS) {
    test(`packages/${pkgDir}/tsconfig.json exists`, () => {
      assert.ok(
        existsSync(join(ROOT, 'packages', pkgDir, 'tsconfig.json')),
        `Expected packages/${pkgDir}/tsconfig.json to exist`,
      );
    });
  }
});
