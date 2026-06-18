/**
 * test(IIII): 4 branch tests closing remaining aggregator/suggestions gaps
 *
 *   1. aggregator.ts 1582-1583 — buildSearchExplanation truncation note
 *      When allMatches.length > topResults.length (i.e. the result set was sliced
 *      by the caller's `limit`), the rationale includes "showing X of Y matches".
 *      Trigger: Aggregator with 25 matching tools + search limit:2 + explain:true.
 *
 *   2. suggestions.ts 38 — `??` right-side branch in loadSuggestionsCatalog
 *      The nullish-coalescing fallback `path ?? resolveSuggestionsCatalogPath()`
 *      is only taken when `path` is undefined (no argument supplied). All existing
 *      callers pass an explicit path, so the right side was never hit.
 *      Trigger: clearSuggestionsCache() + loadSuggestionsCatalog() (no args).
 *
 *   3. aggregator.ts 1566 — buildSearchExplanation relevanceMap ?? 0 right side
 *      When no query is supplied (only a server filter), relevanceMap is empty, so
 *      relevanceMap.get(r.tool) returns undefined → the `?? 0` fallback fires.
 *      Trigger: server-filtered search + explain:true with no query.
 *
 *   4. aggregator.ts 1568 — buildSearchExplanation recentlyUsed true branch
 *      When a session has previously executed a tool from server X, subsequent
 *      searches mark that server's tools with recentlyUsed:true. The explanation's
 *      topCandidates spread should include { recentlyUsed: true } for those tools.
 *      Trigger: execute a tool, then search with same sessionId + explain:true.
 */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { Backend, BackendStatus, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';
import {
  loadSuggestionsCatalog,
  clearSuggestionsCache,
} from '../src/suggestions.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-iiii-${label}-${Date.now()}.jsonl`);
}

/** Backend returning `count` tools all named <prefix>_N so a `prefix` query matches all. */
function makeManyToolBackend(count: number, prefix = 'widgetfoo'): Backend {
  const tools: ToolEntry[] = Array.from({ length: count }, (_, i) => ({
    name: `${prefix}_${i}`,
    description: `${prefix} tool number ${i} does widgetfoo things`,
    inputSchema: { type: 'object', properties: {} },
  }));
  return {
    registerServer: () => {},
    isRegistered: () => true,
    getStatus: (): BackendStatus => ({ connected: true, toolCount: count, toolCacheAge: 0 }),
    listTools: async (): Promise<ToolEntry[]> => tools,
    callTool: async (): Promise<ToolCallResult> => ({ content: [{ type: 'text', text: '{}' }] }),
    listResources: async () => ({ resources: [], templates: [] }),
    readResource: async (_s, uri) => ({ contents: [{ uri, text: '' }] }),
    listPrompts: async () => [],
    getPrompt: async () => ({ messages: [] }),
    shutdown: async () => {},
  };
}

// ── Test 1: aggregator.ts 1582-1583 — truncation note in explain rationale ───

test('search explain: rationale includes "showing X of Y" when limit < total matches', async () => {
  const config: ServerConfig = {
    id: 'widgets',
    name: 'Widgets',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://widgets.example.invalid/mcp',
    lazy: true,
  };
  const agg = new Aggregator([config], {
    backendFactory: () => makeManyToolBackend(25, 'widgetfoo'),
    embedEnabled: false,
    suggestionsCatalog: {},
    focusProfiles: { profiles: {} },
    ledgerDlqPath: dlqPath('search-explain'),
  });
  try {
    const result = await agg.callTool('ch1tty/search', {
      query: 'widgetfoo',
      limit: 2,
      explain: true,
    });
    const parsed = JSON.parse(result.content[0].text as string);
    // The aggregator sliced 25 matches down to 2 — rationale must mention this.
    assert.ok(
      typeof parsed.explanation?.rationale === 'string',
      'explanation.rationale should be a string',
    );
    assert.ok(
      parsed.explanation.rationale.includes('showing 2 of 25 matches'),
      `expected "showing 2 of 25 matches" in rationale, got: ${parsed.explanation.rationale}`,
    );
    // Confirm the API-visible counts are also correct.
    assert.equal(parsed.matches, 2, 'matches count should equal limit');
    assert.equal(parsed.total, 25, 'total count should reflect all matches');
  } finally {
    await agg.shutdown();
  }
});

// ── Test 2: suggestions.ts 38 — ?? right-side branch (no path argument) ──────

test('loadSuggestionsCatalog() without argument falls back to resolveSuggestionsCatalogPath()', () => {
  // Clear module cache so the next call reloads from disk via the path resolver.
  clearSuggestionsCache();
  try {
    // Call without any argument → `path` is undefined → `??` evaluates the right side.
    const catalog = loadSuggestionsCatalog();
    // The real focus-suggestions.json lives at process.cwd() = repo root.
    assert.equal(typeof catalog, 'object', 'should return an object');
    // The catalog has the 6 focus profiles.
    const profiles = Object.keys(catalog);
    assert.ok(profiles.length >= 6, `expected ≥6 profiles, got ${profiles.length}: ${profiles.join(', ')}`);
    assert.ok(profiles.includes('finance'), 'finance profile should be present');
    assert.ok(profiles.includes('ops'), 'ops profile should be present');
  } finally {
    // Reset cache so subsequent tests aren't affected by the module-level state.
    clearSuggestionsCache();
  }
});

// ── Test 3: aggregator.ts 1566 — relevanceMap ?? 0 right side (no-query search) ─

test('search explain: relevanceScore ?? 0 right-side fires when no query supplied', async () => {
  const config: ServerConfig = {
    id: 'widgets',
    name: 'Widgets',
    type: 'remote',
    access: 'readwrite',
    category: 'ecosystem',
    endpoint: 'https://widgets2.example.invalid/mcp',
    lazy: true,
  };
  const agg = new Aggregator([config], {
    backendFactory: () => makeManyToolBackend(5, 'gadget'),
    embedEnabled: false,
    suggestionsCatalog: {},
    focusProfiles: { profiles: {} },
    ledgerDlqPath: dlqPath('noquery-explain'),
  });
  try {
    // Server filter only — no query → relevanceMap stays empty.
    const result = await agg.callTool('ch1tty/search', {
      server: 'widgets',
      explain: true,
    });
    const parsed = JSON.parse(result.content[0].text as string);
    assert.ok(
      typeof parsed.explanation?.rationale === 'string',
      'explanation.rationale should be present',
    );
    // When relevanceMap is empty, every relevanceScore is 0 (from the ?? 0 fallback).
    const topCandidates = parsed.explanation?.topCandidates ?? [];
    assert.ok(topCandidates.length > 0, 'at least one topCandidate should be present');
    for (const c of topCandidates) {
      assert.equal(c.relevanceScore, 0, `relevanceScore should be 0 (from ??0), got ${c.relevanceScore}`);
    }
  } finally {
    await agg.shutdown();
  }
});

// ── Test 4: aggregator.ts 1568 — recentlyUsed true branch in topCandidates ───

test('search explain: recentlyUsed:true appears in topCandidates after executing a tool', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('neon', FIXTURE_SERVERS.neon);
  backend.defineServer('github', FIXTURE_SERVERS.github);

  const configs: ServerConfig[] = [
    {
      id: 'neon',
      name: 'Neon',
      type: 'remote',
      access: 'readwrite',
      category: 'code',
      endpoint: 'https://neon.tech/mcp',
      lazy: true,
    },
    {
      id: 'github',
      name: 'GitHub',
      type: 'remote',
      access: 'readwrite',
      category: 'code',
      endpoint: 'https://github.com/mcp',
      lazy: true,
    },
  ];

  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    suggestionsCatalog: {},
    ledgerDlqPath: dlqPath('recentlyused-explain'),
  });

  const sessionId = 'iiii-recent-explain-1';
  try {
    await agg.coordinator.onSessionStart(sessionId, 'stdio');

    // Execute a neon tool to mark it as recently used in this session.
    await agg.callTool(
      'ch1tty/execute',
      { tool: 'neon/run_sql', args: { project_id: 'p', sql: 'SELECT 1' } },
      sessionId,
    );

    // Search neon tools only with explain:true — server filter ensures Neon tools
    // always appear in topCandidates, making the recentlyUsed assertion deterministic.
    const result = await agg.callTool('ch1tty/search', {
      query: 'sql database',
      server: 'neon',
      explain: true,
    }, sessionId);

    const parsed = JSON.parse(result.content[0].text as string);
    const topCandidates: Array<{ tool: string; recentlyUsed?: boolean | { callCount: number; lastUsedMs: number } }> =
      parsed.explanation?.topCandidates ?? [];

    // At least one candidate from the neon server must carry a truthy recentlyUsed
    // (boolean true for server-level, or { callCount, lastUsedMs } for tool-level).
    const hasRecent = topCandidates.some((c) => !!c.recentlyUsed);
    assert.ok(hasRecent, `expected at least one topCandidate with truthy recentlyUsed; got: ${JSON.stringify(topCandidates)}`);
  } finally {
    await agg.shutdown();
  }
});
