/**
 * test(XX): suggestions.ts uncovered edge paths
 *
 * Covers 6 branches not exercised by suggestions.test.ts or suggestion-ranking.test.ts:
 *
 *   loadSuggestionsCatalog:
 *     1. Catalog file does not exist → returns {}
 *     2. File exists, valid JSON, no "profiles" key → warns + returns {}
 *     3. File exists, valid JSON, profiles is null → warns + returns {}
 *     4. File exists, invalid JSON → catches parse error + returns {}
 *
 *   getSuggestionsForFocus scoring split:
 *     5. anyComboScored=true, anyPromptScored=false → combos sorted by score, prompts in catalog order
 *     6. anyComboScored=false, anyPromptScored=true → combos in catalog order, prompts sorted by score
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test, after } from 'node:test';
import {
  loadSuggestionsCatalog,
  clearSuggestionsCache,
  getSuggestionsForFocus,
} from '../src/suggestions.js';
import type { FocusSuggestions } from '../src/suggestions.js';

const tempDir = mkdtempSync(join(tmpdir(), 'ch1tty-xx-sugg-'));
after(() => rmSync(tempDir, { recursive: true, force: true }));

function writeTmp(filename: string, content: string): string {
  const p = join(tempDir, filename);
  writeFileSync(p, content, 'utf-8');
  return p;
}

// ── loadSuggestionsCatalog edge paths ─────────────────────────────────────────

describe('loadSuggestionsCatalog — uncovered load paths', () => {
  test('returns {} when catalog file does not exist', () => {
    clearSuggestionsCache();
    const missing = join(tempDir, 'nonexistent-catalog.json');
    const result = loadSuggestionsCatalog(missing);
    assert.deepEqual(result, {}, 'should return empty object for missing file');
  });

  test('returns {} when file has valid JSON but no "profiles" key', () => {
    clearSuggestionsCache();
    const p = writeTmp('no-profiles-key.json', JSON.stringify({ _comment: 'no profiles here', generatedFrom: 'test' }));
    const result = loadSuggestionsCatalog(p);
    assert.deepEqual(result, {}, 'should return {} when profiles key is absent');
  });

  test('returns {} when profiles value is null', () => {
    clearSuggestionsCache();
    const p = writeTmp('null-profiles.json', JSON.stringify({ profiles: null }));
    const result = loadSuggestionsCatalog(p);
    assert.deepEqual(result, {}, 'should return {} when profiles is null');
  });

  test('returns {} when file contains invalid JSON', () => {
    clearSuggestionsCache();
    const p = writeTmp('invalid.json', '{not: valid, json}');
    const result = loadSuggestionsCatalog(p);
    assert.deepEqual(result, {}, 'should return {} on JSON parse error');
  });
});

// ── getSuggestionsForFocus split scoring ──────────────────────────────────────
//
// Vocabulary is deliberately disjoint so terms hit exactly one side (combos OR prompts):
//
//   COMBO_A  "sql-artifact-store"  — chain: neon/run_sql; accomplishes: Execute database query
//   COMBO_B  "cf-sentry-wiring"    — chain: cloudflare/worker_deploy; accomplishes: Deploy cloudflare edge worker
//
//   Catalog combo order: [COMBO_A, COMBO_B]  (A before B)
//
//   PROMPT_B "Schedule quarterly review for governance committee" resolves_to: "cf-sentry-wiring"
//   PROMPT_A "List pending invoices awaiting client approval"    resolves_to: "sql-artifact-store"
//
//   Catalog prompt order: [PROMPT_B, PROMPT_A]  (B before A)
//
// Test 5 — intent "cloudflare edge deploy monitoring":
//   • These terms hit COMBO_B's chain/accomplishes ("cloudflare/worker_deploy", "edge worker",
//     "deploy", "monitoring") but NOT COMBO_A's haystack  → anyComboScored=true
//   • Neither term appears in PROMPT_A or PROMPT_B text, and resolves_to values
//     ("sql-artifact-store", "cf-sentry-wiring") contain none of them → anyPromptScored=false
//   ⇒ combos sorted (COMBO_B to front, displacing COMBO_A), prompts in catalog order (PROMPT_B first)
//
// Test 6 — intent "invoices pending approval":
//   • These terms only appear in PROMPT_A's text ("List pending invoices awaiting client approval")
//     and resolves_to "sql-artifact-store" contains none of them → anyPromptScored=true
//   • Neither term appears in COMBO_A or COMBO_B haystacks         → anyComboScored=false
//   ⇒ combos in catalog order (COMBO_A first), prompts sorted (PROMPT_A to front)

const COMBO_A: FocusSuggestions['combos'][0] = {
  name: 'sql-artifact-store',
  chain: ['neon/run_sql', 'github/create_release'],
  accomplishes: 'Execute database query and publish artifact release',
  verified: true,
};

const COMBO_B: FocusSuggestions['combos'][0] = {
  name: 'cf-sentry-wiring',
  chain: ['cloudflare/worker_deploy', 'sentry/create_alert'],
  accomplishes: 'Deploy cloudflare edge worker and configure monitoring',
  verified: false,
};

const PROMPT_A: FocusSuggestions['prompts'][0] = {
  text: 'List pending invoices awaiting client approval',
  resolves_to: 'sql-artifact-store',
};

const PROMPT_B: FocusSuggestions['prompts'][0] = {
  text: 'Schedule quarterly review for governance committee',
  resolves_to: 'cf-sentry-wiring',
};

const SPLIT_PROFILE: FocusSuggestions = {
  description: 'Split scoring test',
  combos: [COMBO_A, COMBO_B],    // A before B in catalog
  prompts: [PROMPT_B, PROMPT_A], // B before A in catalog
};

const SPLIT_CATALOG = { split: SPLIT_PROFILE };

describe('getSuggestionsForFocus — split scoring paths', () => {
  test('anyComboScored=true, anyPromptScored=false → combos sorted, prompts in catalog order', () => {
    // "cloudflare", "edge", "deploy", "monitoring" match COMBO_B's chain + accomplishes; COMBO_A scores 0.
    // Neither term appears in PROMPT_A or PROMPT_B text or resolves_to ("sql-artifact-store"/"cf-sentry-wiring").
    const result = getSuggestionsForFocus('split', SPLIT_CATALOG, { intent: 'cloudflare edge deploy monitoring' });
    assert.ok(result, 'result should not be null');
    // combos sorted: COMBO_B (score 1.0) → first; COMBO_A (score 0) → second
    assert.equal(result.combos[0].name, 'cf-sentry-wiring', 'COMBO_B sorted to first by score');
    assert.equal(result.combos[1].name, 'sql-artifact-store', 'COMBO_A demoted to second');
    // prompts: all score 0 → catalog order preserved → PROMPT_B first
    assert.equal(result.prompts[0].resolves_to, 'cf-sentry-wiring', 'prompts stay in catalog order (PROMPT_B first)');
    assert.equal(result.prompts[1].resolves_to, 'sql-artifact-store', 'PROMPT_A stays second');
  });

  test('anyComboScored=false, anyPromptScored=true → combos in catalog order, prompts sorted', () => {
    // "invoices", "pending", "approval" match only PROMPT_A's text; PROMPT_B scores 0.
    // None of these terms appear in COMBO_A or COMBO_B haystacks (names, chains, accomplishes).
    const result = getSuggestionsForFocus('split', SPLIT_CATALOG, { intent: 'invoices pending approval' });
    assert.ok(result, 'result should not be null');
    // combos: all score 0 → catalog order preserved → COMBO_A first
    assert.equal(result.combos[0].name, 'sql-artifact-store', 'combos stay in catalog order (COMBO_A first)');
    assert.equal(result.combos[1].name, 'cf-sentry-wiring', 'COMBO_B stays second');
    // prompts sorted: PROMPT_A (score 1.0) → first; PROMPT_B (score 0) → second
    assert.equal(result.prompts[0].resolves_to, 'sql-artifact-store', 'PROMPT_A sorted to first by score');
    assert.equal(result.prompts[1].resolves_to, 'cf-sentry-wiring', 'PROMPT_B demoted to second');
  });
});
