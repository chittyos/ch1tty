import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function load(rel: string): Record<string, unknown> {
  const full = resolve(import.meta.dirname, '..', rel);
  return JSON.parse(readFileSync(full, 'utf8'));
}

type CompilerOptions = Record<string, unknown>;

function opts(path: string): CompilerOptions {
  const cfg = load(path) as { compilerOptions: CompilerOptions };
  assert.ok(cfg.compilerOptions, `${path}: missing compilerOptions`);
  return cfg.compilerOptions;
}

const MANDATORY: Array<[string, unknown]> = [
  ['target', 'ES2022'],
  ['module', 'Node16'],
  ['moduleResolution', 'Node16'],
  ['strict', true],
  ['esModuleInterop', true],
  ['skipLibCheck', true],
  ['forceConsistentCasingInFileNames', true],
];

const TSCONFIGS = [
  'tsconfig.json',
  'packages/shared-logger/tsconfig.json',
  'packages/shared-mcp/tsconfig.json',
  'packages/shared-types/tsconfig.json',
  'apps/comms-mcp/tsconfig.json',
  'apps/evidence-mcp/tsconfig.json',
  'apps/ledger-mcp/tsconfig.json',
  'apps/session-coordinator-mcp/tsconfig.json',
  'apps/tasks-mcp/tsconfig.json',
];

const PACKAGE_TSCONFIGS = [
  'packages/shared-logger/tsconfig.json',
  'packages/shared-mcp/tsconfig.json',
  'packages/shared-types/tsconfig.json',
];

const APP_TSCONFIGS = [
  'apps/comms-mcp/tsconfig.json',
  'apps/evidence-mcp/tsconfig.json',
  'apps/ledger-mcp/tsconfig.json',
  'apps/session-coordinator-mcp/tsconfig.json',
  'apps/tasks-mcp/tsconfig.json',
];

describe('tsconfig cross-package consistency drift guard', () => {
  for (const path of TSCONFIGS) {
    describe(path, () => {
      const co = opts(path);

      for (const [field, expected] of MANDATORY) {
        it(`${field} === ${JSON.stringify(expected)}`, () => {
          assert.equal(
            co[field],
            expected,
            `${path}: compilerOptions.${field} must be ${JSON.stringify(expected)}`,
          );
        });
      }

      it('rootDir is set', () => {
        assert.ok(typeof co.rootDir === 'string' && co.rootDir.length > 0, `${path}: rootDir must be set`);
      });

      it('outDir is set', () => {
        assert.ok(typeof co.outDir === 'string' && co.outDir.length > 0, `${path}: outDir must be set`);
      });
    });
  }

  describe('packages: declaration must be true', () => {
    for (const path of PACKAGE_TSCONFIGS) {
      it(`${path}: declaration === true`, () => {
        const co = opts(path);
        assert.equal(co.declaration, true, `${path}: packages must emit declaration files`);
      });
    }
  });

  describe('apps: typeRoots must point to workspace @types', () => {
    for (const path of APP_TSCONFIGS) {
      it(`${path}: typeRoots includes ../../node_modules/@types`, () => {
        const co = opts(path);
        const roots = co.typeRoots as string[] | undefined;
        assert.ok(Array.isArray(roots), `${path}: typeRoots must be an array`);
        assert.ok(
          roots.includes('../../node_modules/@types'),
          `${path}: typeRoots must include ../../node_modules/@types`,
        );
      });
    }
  });

  describe('apps: include and exclude must be set', () => {
    for (const path of APP_TSCONFIGS) {
      it(`${path}: include contains src/**/*`, () => {
        const cfg = load(path) as { include?: string[] };
        assert.ok(Array.isArray(cfg.include), `${path}: include must be an array`);
        assert.ok(cfg.include.includes('src/**/*'), `${path}: include must contain src/**/*`);
      });

      it(`${path}: exclude contains dist`, () => {
        const cfg = load(path) as { exclude?: string[] };
        assert.ok(Array.isArray(cfg.exclude), `${path}: exclude must be an array`);
        assert.ok(cfg.exclude.includes('dist'), `${path}: exclude must contain dist`);
      });
    }
  });
});
