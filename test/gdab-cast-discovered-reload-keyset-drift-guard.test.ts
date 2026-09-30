/**
 * GDAB drift-guard: freeze cast:discovered response key set and ch1tty/reload response key set.
 *
 * Prior freeze layers:
 *   - GDAA froze cast:plan and cast:no_match key sets.
 *   - No prior test freezes cast:discovered or ch1tty/reload top-level shapes.
 *
 * GDAB closes that gap:
 *   GDAB-1  cast:discovered (resources path) — top-level key set
 *   GDAB-2  cast:discovered — resources[] item key set
 *   GDAB-3  cast:discovered (prompts path) — top-level key set
 *   GDAB-4  ch1tty/reload — success top-level key set
 *   GDAB-5  ch1tty/reload — catalog sub-object key set
 *
 * Trigger strategy for cast:discovered:
 *   Use a backend with no tools and a fixture resource/prompt whose description
 *   contains unique strings ('zorkblat', 'quuxglorp', 'testmunge') that can't
 *   appear in any suggestions-catalog entry. Intent terms match only the fixture,
 *   never suggestions or real tool descriptions.
 *
 * Frozen 2026-09-30.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only)
 *   - buildCastExplanation metric freeze: not applicable (cast:discovered/reload, not explain)
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import type { FocusProfiles } from '../src-stdio/focus.js';
import { FixtureBackend } from './fixture-backend.js';

const GUIDE_CFG: ServerConfig = {
  id: 'guide', name: 'Guide', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://guide.test/mcp', lazy: true,
};

// Unique tokens absent from any real suggestions-catalog description or tool name.
const RESOURCE_INTENT = 'zorkblat quuxglorp testmunge';
const PROMPT_INTENT   = 'zorkblat promptgorp testmunge';

const FOCUS_PROFILES: FocusProfiles = { profiles: {} };

let _seq = 0;
function makeDlq(): string {
  return join(tmpdir(), `ch1tty-gdab-${Date.now()}-${++_seq}.jsonl`);
}

function makeAgg(backend: FixtureBackend, extra: Record<string, unknown> = {}): Aggregator {
  const opts = {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: makeDlq(),
    focusProfiles: FOCUS_PROFILES,
    ...extra,
  };
  return new Aggregator([GUIDE_CFG], opts as Parameters<typeof Aggregator.prototype.callTool>[1]);
}

// ── GDAB-1: cast:discovered (resources) top-level key set ────────────────────

test('GDAB-1: cast:discovered (resources path) — top-level key set is EXACTLY {cast,hint,intent,latencyMs,resolvedBy,resources}', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('guide', {
    tools: [],
    resources: [{
      uri: 'test-resource',
      name: 'test discovery resource',
      description: 'zorkblat quuxglorp testmunge unique fixture resource',
      mimeType: 'text/plain' as unknown as undefined,
    }],
  });
  const agg = makeAgg(backend);
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: RESOURCE_INTENT });
    assert.equal(result.isError, undefined, 'cast must not error');
    const snap = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(snap.cast, 'discovered',
      `cast must be "discovered" — check that RESOURCE_INTENT matches no tools but does match the fixture resource. got "${snap.cast}"`);
    const got  = Object.keys(snap).sort();
    const want = ['cast', 'hint', 'intent', 'latencyMs', 'resolvedBy', 'resources'].sort();
    assert.deepEqual(got, want,
      `cast:discovered (resources) top-level key set mismatch.\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GDAB-2: cast:discovered resources[] item key set ─────────────────────────

test('GDAB-2: cast:discovered — resources[] item key set is EXACTLY {description,mimeType,name,score,uri}', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('guide', {
    tools: [],
    resources: [{
      uri: 'test-resource',
      name: 'test discovery resource',
      description: 'zorkblat quuxglorp testmunge unique fixture resource',
      mimeType: 'text/plain' as unknown as undefined,
    }],
  });
  const agg = makeAgg(backend);
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: RESOURCE_INTENT });
    assert.equal(result.isError, undefined, 'cast must not error');
    const snap = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(snap.cast, 'discovered', `cast must be "discovered", got "${snap.cast}"`);
    const resources = snap.resources as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(resources) && resources.length > 0,
      'resources must be a non-empty array for cast:discovered (resources path)');
    for (const r of resources) {
      const got  = Object.keys(r).sort();
      const want = ['description', 'mimeType', 'name', 'score', 'uri'];
      assert.deepEqual(got, want,
        `resources[] item key set mismatch.\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── GDAB-3: cast:discovered (prompts) top-level key set ──────────────────────

test('GDAB-3: cast:discovered (prompts path) — top-level key set is EXACTLY {cast,hint,intent,latencyMs,prompts,resolvedBy}', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('guide', {
    tools: [],
    prompts: [{
      name: 'zorkblat-promptgorp-prompt',
      description: 'zorkblat promptgorp testmunge unique fixture prompt',
    }],
  });
  const agg = makeAgg(backend);
  try {
    const result = await agg.callTool('ch1tty/cast', { intent: PROMPT_INTENT });
    assert.equal(result.isError, undefined, 'cast must not error');
    const snap = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(snap.cast, 'discovered',
      `cast must be "discovered" — check that PROMPT_INTENT matches no tools/resources but does match the fixture prompt. got "${snap.cast}"`);
    const got  = Object.keys(snap).sort();
    const want = ['cast', 'hint', 'intent', 'latencyMs', 'prompts', 'resolvedBy'].sort();
    assert.deepEqual(got, want,
      `cast:discovered (prompts) top-level key set mismatch.\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GDAB-4: ch1tty/reload success top-level key set ──────────────────────────

test('GDAB-4: ch1tty/reload — success response key set is EXACTLY {added,catalog,latencyMs,missingEnvVars,removed,reloaded,totalServers}', async () => {
  const configPath = join(tmpdir(), `ch1tty-gdab-reload-${Date.now()}-${++_seq}.json`);
  writeFileSync(configPath, JSON.stringify({
    servers: [{
      id: 'guide', name: 'Guide', type: 'remote',
      access: 'readwrite', category: 'code', endpoint: 'https://guide.test/mcp',
    }],
  }), 'utf-8');
  const backend = new FixtureBackend();
  backend.defineServer('guide', { tools: [] });
  const agg = makeAgg(backend, { configPath });
  try {
    const result = await agg.callTool('ch1tty/reload');
    assert.equal(result.isError, undefined, 'reload must not error');
    const snap = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    assert.equal(snap.reloaded, true, 'reloaded must be true');
    const got  = Object.keys(snap).sort();
    const want = ['added', 'catalog', 'latencyMs', 'missingEnvVars', 'reloaded', 'removed', 'totalServers'];
    assert.deepEqual(got, want,
      `reload top-level key set mismatch.\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
  } finally {
    await agg.shutdown();
  }
});

// ── GDAB-5: ch1tty/reload catalog sub-object key set ─────────────────────────

test('GDAB-5: ch1tty/reload — catalog sub-object key set is EXACTLY {phantomServerIds,totalCombos}', async () => {
  const configPath = join(tmpdir(), `ch1tty-gdab-reload-${Date.now()}-${++_seq}.json`);
  writeFileSync(configPath, JSON.stringify({
    servers: [{
      id: 'guide', name: 'Guide', type: 'remote',
      access: 'readwrite', category: 'code', endpoint: 'https://guide.test/mcp',
    }],
  }), 'utf-8');
  const backend = new FixtureBackend();
  backend.defineServer('guide', { tools: [] });
  const agg = makeAgg(backend, { configPath });
  try {
    const result = await agg.callTool('ch1tty/reload');
    assert.equal(result.isError, undefined, 'reload must not error');
    const snap = JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    const catalog = snap.catalog as Record<string, unknown>;
    assert.ok(catalog !== null && typeof catalog === 'object' && !Array.isArray(catalog),
      'reload.catalog must be a plain object');
    const got  = Object.keys(catalog).sort();
    const want = ['phantomServerIds', 'totalCombos'];
    assert.deepEqual(got, want,
      `reload.catalog key set mismatch.\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
    assert.ok(Array.isArray(catalog.phantomServerIds), 'catalog.phantomServerIds must be an array');
    assert.equal(typeof catalog.totalCombos, 'number', 'catalog.totalCombos must be a number');
  } finally {
    await agg.shutdown();
  }
});
