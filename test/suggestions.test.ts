import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadSuggestionsCatalog,
  clearSuggestionsCache,
  getSuggestionsForFocus,
} from '../src/suggestions.js';

const CATALOG_PATH = resolve(process.cwd(), 'focus-suggestions.json');

function freshCatalog() {
  clearSuggestionsCache();
  return loadSuggestionsCatalog(CATALOG_PATH);
}

describe('suggestions catalog', () => {
  it('loads all 6 focus profiles', () => {
    const catalog = freshCatalog();
    const keys = Object.keys(catalog).sort();
    assert.deepEqual(keys, ['code', 'communication', 'design', 'finance', 'governance', 'ops']);
  });

  it('every profile has at least 3 combos and 3 prompts', () => {
    const catalog = freshCatalog();
    for (const [name, profile] of Object.entries(catalog)) {
      assert.ok(profile.combos.length >= 3, `${name}: expected ≥3 combos, got ${profile.combos.length}`);
      assert.ok(profile.prompts.length >= 3, `${name}: expected ≥3 prompts, got ${profile.prompts.length}`);
    }
  });

  it('every combo has name, chain (non-empty), and accomplishes', () => {
    const catalog = freshCatalog();
    for (const [focus, profile] of Object.entries(catalog)) {
      for (const combo of profile.combos) {
        assert.ok(combo.name, `${focus}: combo missing name`);
        assert.ok(Array.isArray(combo.chain) && combo.chain.length >= 2,
          `${focus}/${combo.name}: chain must have ≥2 tools, got ${JSON.stringify(combo.chain)}`);
        assert.ok(combo.accomplishes, `${focus}/${combo.name}: missing accomplishes`);
        for (const tool of combo.chain) {
          assert.ok(tool.includes('/'), `${focus}/${combo.name}: chain tool "${tool}" is not namespaced (serverId/toolName)`);
        }
      }
    }
  });

  it('every prompt has text and resolves_to', () => {
    const catalog = freshCatalog();
    for (const [focus, profile] of Object.entries(catalog)) {
      for (const prompt of profile.prompts) {
        assert.ok(prompt.text, `${focus}: prompt missing text`);
        assert.ok(prompt.resolves_to, `${focus}: prompt missing resolves_to`);
      }
    }
  });

  it('getSuggestionsForFocus returns null for unknown focus', () => {
    const catalog = freshCatalog();
    assert.equal(getSuggestionsForFocus('nonexistent', catalog), null);
  });

  it('getSuggestionsForFocus returns top N combos and prompts', () => {
    const catalog = freshCatalog();
    const result = getSuggestionsForFocus('code', catalog, { maxCombos: 2, maxPrompts: 2 });
    assert.ok(result !== null);
    assert.equal(result.combos.length, 2);
    assert.equal(result.prompts.length, 2);
  });

  it('getSuggestionsForFocus defaults to top 3 combos and prompts', () => {
    const catalog = freshCatalog();
    const result = getSuggestionsForFocus('governance', catalog);
    assert.ok(result !== null);
    assert.equal(result.combos.length, 3);
    assert.equal(result.prompts.length, 3);
  });

  it('catalog JSON is valid and parses cleanly', () => {
    const raw = readFileSync(CATALOG_PATH, 'utf-8');
    assert.doesNotThrow(() => JSON.parse(raw), 'focus-suggestions.json is not valid JSON');
  });

  it('focus-suggestions profiles are a superset of focus-profiles profiles', () => {
    const catalogProfiles = new Set(Object.keys(freshCatalog()));
    const focusProfilesRaw = readFileSync(resolve(process.cwd(), 'focus-profiles.json'), 'utf-8');
    const focusProfiles: { profiles: Record<string, unknown> } = JSON.parse(focusProfilesRaw);
    for (const name of Object.keys(focusProfiles.profiles)) {
      assert.ok(catalogProfiles.has(name),
        `focus profile "${name}" has no entry in focus-suggestions.json`);
    }
  });

  it('cache returns same object on repeated loads', () => {
    clearSuggestionsCache();
    const a = loadSuggestionsCatalog(CATALOG_PATH);
    const b = loadSuggestionsCatalog(CATALOG_PATH);
    assert.equal(a, b, 'expected cached reference to be identical');
  });

  it('clearSuggestionsCache forces re-read', () => {
    const a = loadSuggestionsCatalog(CATALOG_PATH);
    clearSuggestionsCache();
    const b = loadSuggestionsCatalog(CATALOG_PATH);
    assert.notEqual(a, b, 'expected fresh object after cache clear');
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
  });

  it('code profile combos reference code-relevant backends', () => {
    const catalog = freshCatalog();
    const codeServers = new Set(['context7', 'neon', 'fs', 'github', 'notion', 'serena', 'cloudflare', 'cloudflare-builds', 'linear']);
    for (const combo of catalog['code'].combos) {
      const servers = combo.chain.map((t) => t.split('/')[0]);
      const relevant = servers.some((s) => codeServers.has(s));
      assert.ok(relevant, `code/${combo.name}: no code-relevant server in chain ${JSON.stringify(combo.chain)}`);
    }
  });

  it('communication profile combos reference communication-relevant backends', () => {
    const catalog = freshCatalog();
    const commServers = new Set(['notion', 'chittymac', 'imessage', 'tasks', 'thinking']);
    for (const combo of catalog['communication'].combos) {
      const servers = combo.chain.map((t) => t.split('/')[0]);
      const relevant = servers.some((s) => commServers.has(s));
      assert.ok(relevant, `communication/${combo.name}: no comm-relevant server in chain ${JSON.stringify(combo.chain)}`);
    }
  });
});

describe('cast plan includes suggestions', () => {
  it('cast confirm=true with active focus includes suggestions field', async () => {
    const { Aggregator } = await import('../src/aggregator.js');
    const { FixtureBackend } = await import('./fixture-backend.js');

    const fixture = new FixtureBackend();
    fixture.defineServer('context7', {
      tools: [
        {
          name: 'query-docs',
          description: 'get library documentation for a package',
          inputSchema: {},
          response: { content: [{ type: 'text', text: 'docs result' }] },
        },
        {
          name: 'resolve-library-id',
          description: 'resolve library name to documentation id',
          inputSchema: {},
          response: { content: [{ type: 'text', text: 'library id resolved' }] },
        },
      ],
    });

    const agg = new Aggregator(
      [{ id: 'context7', name: 'context7', type: 'remote', access: 'read', category: 'code', endpoint: 'https://unused.invalid/mcp', lazy: false }],
      {
        backendFactory: () => fixture,
        embedEnabled: false,
        focusProfiles: {
          profiles: {
            code: { description: 'code', categories: ['code'], servers: ['context7'], boost: 0.5 },
          },
        },
        suggestionsCatalog: {
          code: {
            description: 'code suggestions',
            combos: [
              { name: 'test-combo', chain: ['context7/query-docs', 'neon/run_sql'], accomplishes: 'test', verified: false },
            ],
            prompts: [
              { text: 'Look up library docs', resolves_to: 'test-combo' },
            ],
          },
        },
      },
    );

    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'get library documentation',
        confirm: true,
        focus: 'code',
      }, 'test-session');

      assert.equal(result.isError, undefined);
      const body = JSON.parse((result.content[0] as { type: string; text: string }).text);
      assert.equal(body.cast, 'plan', `expected plan, got: ${JSON.stringify(body)}`);
      assert.ok(body.suggestions, 'cast:plan should include suggestions when focus is active');
      assert.ok(Array.isArray(body.suggestions.combos), 'suggestions.combos should be an array');
      assert.ok(Array.isArray(body.suggestions.prompts), 'suggestions.prompts should be an array');
      assert.equal(body.suggestions.combos[0].name, 'test-combo');
      assert.equal(body.suggestions.prompts[0].text, 'Look up library docs');
    } finally {
      await agg.shutdown();
    }
  });

  it('cast confirm=true without focus has no suggestions field', async () => {
    const { Aggregator } = await import('../src/aggregator.js');
    const { FixtureBackend } = await import('./fixture-backend.js');

    const fixture = new FixtureBackend();
    fixture.defineServer('context7', {
      tools: [
        {
          name: 'query-docs',
          description: 'get library documentation for a package',
          inputSchema: {},
          response: { content: [{ type: 'text', text: 'docs result' }] },
        },
      ],
    });

    const agg = new Aggregator(
      [{ id: 'context7', name: 'context7', type: 'remote', access: 'read', category: 'code', endpoint: 'https://unused.invalid/mcp', lazy: false }],
      {
        backendFactory: () => fixture,
        embedEnabled: false,
        suggestionsCatalog: {
          code: {
            description: 'code suggestions',
            combos: [
              { name: 'test-combo', chain: ['context7/query-docs', 'neon/run_sql'], accomplishes: 'test', verified: false },
            ],
            prompts: [{ text: 'Look up library docs', resolves_to: 'test-combo' }],
          },
        },
      },
    );

    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'get library documentation',
        confirm: true,
      }, 'test-session-2');

      assert.equal(result.isError, undefined);
      const body = JSON.parse((result.content[0] as { type: string; text: string }).text);
      assert.equal(body.cast, 'plan', `expected plan, got: ${JSON.stringify(body)}`);
      assert.equal(body.suggestions, undefined, 'cast:plan without focus should not include suggestions');
    } finally {
      await agg.shutdown();
    }
  });

  it('cast confirm=true with focus and empty catalog has no suggestions field', async () => {
    const { Aggregator } = await import('../src/aggregator.js');
    const { FixtureBackend } = await import('./fixture-backend.js');

    const fixture = new FixtureBackend();
    fixture.defineServer('context7', {
      tools: [
        {
          name: 'query-docs',
          description: 'get library documentation for a package',
          inputSchema: {},
          response: { content: [{ type: 'text', text: 'docs result' }] },
        },
      ],
    });

    const agg = new Aggregator(
      [{ id: 'context7', name: 'context7', type: 'remote', access: 'read', category: 'code', endpoint: 'https://unused.invalid/mcp', lazy: false }],
      {
        backendFactory: () => fixture,
        embedEnabled: false,
        focusProfiles: {
          profiles: {
            code: { description: 'code', categories: ['code'], servers: ['context7'], boost: 0.5 },
          },
        },
        suggestionsCatalog: {},
      },
    );

    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'get library documentation',
        confirm: true,
        focus: 'code',
      }, 'test-session-3');

      assert.equal(result.isError, undefined);
      const body = JSON.parse((result.content[0] as { type: string; text: string }).text);
      assert.equal(body.cast, 'plan', `expected plan, got: ${JSON.stringify(body)}`);
      assert.equal(body.suggestions, undefined, 'empty catalog should produce no suggestions');
    } finally {
      await agg.shutdown();
    }
  });
});

describe('cast executed includes suggestions', () => {
  it('cast without confirm + active focus includes suggestions in executed response', async () => {
    const { Aggregator } = await import('../src/aggregator.js');
    const { FixtureBackend } = await import('./fixture-backend.js');

    const fixture = new FixtureBackend();
    fixture.defineServer('context7', {
      tools: [
        {
          name: 'query-docs',
          description: 'get library documentation for a package',
          inputSchema: {},
          response: { content: [{ type: 'text', text: 'docs result' }] },
        },
      ],
    });

    const agg = new Aggregator(
      [{ id: 'context7', name: 'context7', type: 'remote', access: 'read', category: 'code', endpoint: 'https://unused.invalid/mcp', lazy: false }],
      {
        backendFactory: () => fixture,
        embedEnabled: false,
        focusProfiles: {
          profiles: {
            code: { description: 'code', categories: ['code'], servers: ['context7'], boost: 0.5 },
          },
        },
        suggestionsCatalog: {
          code: {
            description: 'code suggestions',
            combos: [
              { name: 'exec-combo', chain: ['context7/query-docs', 'neon/run_sql'], accomplishes: 'exec test', verified: false },
            ],
            prompts: [
              { text: 'Search library docs', resolves_to: 'exec-combo' },
            ],
          },
        },
      },
    );

    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'get library documentation',
        focus: 'code',
      }, 'test-exec-session-1');

      assert.equal(result.isError, undefined);
      const body = JSON.parse((result.content[0] as { type: string; text: string }).text);
      assert.equal(body.cast, 'executed', `expected executed, got: ${JSON.stringify(body)}`);
      assert.ok(body.suggestions, 'cast:executed should include suggestions when focus is active');
      assert.ok(Array.isArray(body.suggestions.combos), 'suggestions.combos should be an array');
      assert.ok(Array.isArray(body.suggestions.prompts), 'suggestions.prompts should be an array');
      assert.equal(body.suggestions.combos[0].name, 'exec-combo');
      assert.equal(body.suggestions.prompts[0].text, 'Search library docs');
    } finally {
      await agg.shutdown();
    }
  });

  it('cast without confirm + no focus has no suggestions in executed response', async () => {
    const { Aggregator } = await import('../src/aggregator.js');
    const { FixtureBackend } = await import('./fixture-backend.js');

    const fixture = new FixtureBackend();
    fixture.defineServer('context7', {
      tools: [
        {
          name: 'query-docs',
          description: 'get library documentation for a package',
          inputSchema: {},
          response: { content: [{ type: 'text', text: 'docs result' }] },
        },
      ],
    });

    const agg = new Aggregator(
      [{ id: 'context7', name: 'context7', type: 'remote', access: 'read', category: 'code', endpoint: 'https://unused.invalid/mcp', lazy: false }],
      {
        backendFactory: () => fixture,
        embedEnabled: false,
        suggestionsCatalog: {
          code: {
            description: 'code suggestions',
            combos: [{ name: 'exec-combo', chain: ['context7/query-docs'], accomplishes: 'test', verified: false }],
            prompts: [{ text: 'Search library docs', resolves_to: 'exec-combo' }],
          },
        },
      },
    );

    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'get library documentation',
      }, 'test-exec-session-2');

      assert.equal(result.isError, undefined);
      const body = JSON.parse((result.content[0] as { type: string; text: string }).text);
      assert.equal(body.cast, 'executed', `expected executed, got: ${JSON.stringify(body)}`);
      assert.equal(body.suggestions, undefined, 'cast:executed without focus should not include suggestions');
    } finally {
      await agg.shutdown();
    }
  });

  it('cast without confirm + focus and empty catalog has no suggestions in executed response', async () => {
    const { Aggregator } = await import('../src/aggregator.js');
    const { FixtureBackend } = await import('./fixture-backend.js');

    const fixture = new FixtureBackend();
    fixture.defineServer('context7', {
      tools: [
        {
          name: 'query-docs',
          description: 'get library documentation for a package',
          inputSchema: {},
          response: { content: [{ type: 'text', text: 'docs result' }] },
        },
      ],
    });

    const agg = new Aggregator(
      [{ id: 'context7', name: 'context7', type: 'remote', access: 'read', category: 'code', endpoint: 'https://unused.invalid/mcp', lazy: false }],
      {
        backendFactory: () => fixture,
        embedEnabled: false,
        focusProfiles: {
          profiles: {
            code: { description: 'code', categories: ['code'], servers: ['context7'], boost: 0.5 },
          },
        },
        suggestionsCatalog: {},
      },
    );

    try {
      const result = await agg.callTool('ch1tty/cast', {
        intent: 'get library documentation',
        focus: 'code',
      }, 'test-exec-session-3');

      assert.equal(result.isError, undefined);
      const body = JSON.parse((result.content[0] as { type: string; text: string }).text);
      assert.equal(body.cast, 'executed', `expected executed, got: ${JSON.stringify(body)}`);
      assert.equal(body.suggestions, undefined, 'empty catalog should produce no suggestions in executed response');
    } finally {
      await agg.shutdown();
    }
  });
});
