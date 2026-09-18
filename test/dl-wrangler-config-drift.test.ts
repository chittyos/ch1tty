import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function stripJsoncComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

function loadJsonc(rel: string): Record<string, unknown> {
  const full = resolve(import.meta.dirname, '..', rel);
  return JSON.parse(stripJsoncComments(readFileSync(full, 'utf8')));
}

const main = loadJsonc('wrangler.jsonc');
const harness = loadJsonc('wrangler.harness.jsonc');

type DoBinding = { name: string; class_name: string };
type Migration = { tag: string };

describe('wrangler.jsonc — structural drift guard', () => {
  it('worker name is "ch1tty"', () => {
    assert.equal(main.name, 'ch1tty');
  });

  it('main entry is src/index.ts', () => {
    assert.equal(main.main, 'src/index.ts');
  });

  it('nodejs_compat flag is present', () => {
    const flags = main.compatibility_flags as string[];
    assert.ok(Array.isArray(flags));
    assert.ok(flags.includes('nodejs_compat'), 'nodejs_compat must be in compatibility_flags');
  });

  it('global_fetch_strictly_public flag is present', () => {
    const flags = main.compatibility_flags as string[];
    assert.ok(flags.includes('global_fetch_strictly_public'));
  });

  it('durable_objects has exactly 3 bindings', () => {
    const bindings = (main.durable_objects as { bindings: DoBinding[] }).bindings;
    assert.equal(bindings.length, 3);
  });

  it('DO class names include Ch1ttyDO, Ch1ttyMcpAgent, Ch1ttyApiAgent', () => {
    const bindings = (main.durable_objects as { bindings: DoBinding[] }).bindings;
    const classes = bindings.map((b) => b.class_name);
    assert.ok(classes.includes('Ch1ttyDO'));
    assert.ok(classes.includes('Ch1ttyMcpAgent'));
    assert.ok(classes.includes('Ch1ttyApiAgent'));
  });

  it('DO class names are unique (no duplicates)', () => {
    const bindings = (main.durable_objects as { bindings: DoBinding[] }).bindings;
    const classes = bindings.map((b) => b.class_name);
    assert.equal(new Set(classes).size, classes.length);
  });

  it('migrations contain tags v1, v2, v3', () => {
    const migrations = main.migrations as Migration[];
    assert.ok(Array.isArray(migrations));
    const tags = migrations.map((m) => m.tag);
    assert.ok(tags.includes('v1'));
    assert.ok(tags.includes('v2'));
    assert.ok(tags.includes('v3'));
  });

  it('migration tags are unique', () => {
    const migrations = main.migrations as Migration[];
    const tags = migrations.map((m) => m.tag);
    assert.equal(new Set(tags).size, tags.length);
  });
});

describe('wrangler.harness.jsonc — structural drift guard', () => {
  it('worker name matches main ("ch1tty")', () => {
    assert.equal(harness.name, main.name);
  });

  it('main entry matches main (src/index.ts)', () => {
    assert.equal(harness.main, main.main);
  });

  it('nodejs_compat flag is present', () => {
    const flags = harness.compatibility_flags as string[];
    assert.ok(Array.isArray(flags));
    assert.ok(flags.includes('nodejs_compat'));
  });

  it('harness DO bindings are a subset of main DO bindings by class_name', () => {
    const mainClasses = new Set(
      (main.durable_objects as { bindings: DoBinding[] }).bindings.map((b) => b.class_name)
    );
    const harnessBindings = (harness.durable_objects as { bindings: DoBinding[] }).bindings;
    for (const b of harnessBindings) {
      assert.ok(mainClasses.has(b.class_name), `harness class ${b.class_name} not in main`);
    }
  });

  it('shared DO bindings have matching binding names in harness vs main', () => {
    const mainMap = new Map(
      (main.durable_objects as { bindings: DoBinding[] }).bindings.map((b) => [b.class_name, b.name])
    );
    const harnessBindings = (harness.durable_objects as { bindings: DoBinding[] }).bindings;
    for (const b of harnessBindings) {
      if (mainMap.has(b.class_name)) {
        assert.equal(
          b.name,
          mainMap.get(b.class_name),
          `binding name for ${b.class_name} differs between harness and main`
        );
      }
    }
  });
});
