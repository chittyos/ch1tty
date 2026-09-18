/**
 * DQ — focus-profiles.json structural drift guard.
 *
 * Exercises the real focus-profiles.json file against the production
 * validateFocusProfiles() validator (src-stdio/focus.ts). Guards that the JSON
 * on disk is always valid by the validator's own rules and that the known set of
 * 25 profiles has not silently shrunk, grown, or had a profile hollowed out.
 *
 * Coverage:
 *   - validateFocusProfiles() passes on the actual file (no exceptions)
 *   - Exactly 25 profiles registered
 *   - Each of the 25 known profile names is present
 *   - Every profile has a non-empty description string
 *   - Every profile has at least one category or server (validator rule)
 *   - Every profile boost is a positive finite number
 *   - Every category value is within the VALID_CATEGORIES set
 *     (re-declared here so drift in validator is also caught)
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFocusProfiles } from '../src-stdio/focus.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = JSON.parse(readFileSync(join(ROOT, 'focus-profiles.json'), 'utf-8')) as unknown;

// Snapshot of the 25 known profile names — update when a profile is intentionally
// added or removed, keeping the count assertion below in sync.
const EXPECTED_PROFILES = [
  'analytics', 'auth', 'chittyevidence', 'cloud', 'code',
  'communication', 'data', 'deploy', 'design', 'devops',
  'documents', 'finance', 'google', 'governance', 'ledger',
  'legal', 'market', 'monitoring', 'ops', 'realestate',
  'search', 'security', 'session', 'tasks', 'workspace',
] as const;

// Mirror VALID_CATEGORIES from src-stdio/focus.ts — if the source changes this
// set, this assertion will catch the mismatch against the actual JSON file.
const VALID_CATEGORIES = new Set([
  'ecosystem', 'code', 'search', 'reasoning', 'desktop', 'documents', 'communication',
]);

// ── Parse + validate via the production validator ─────────────────────────────

describe('validateFocusProfiles() against real file', () => {
  test('validator passes without throwing', () => {
    assert.doesNotThrow(() => validateFocusProfiles(RAW));
  });

  test('validated result has a profiles object', () => {
    const result = validateFocusProfiles(RAW);
    assert.ok(result.profiles !== null && typeof result.profiles === 'object');
  });
});

// ── Profile count + name roster ───────────────────────────────────────────────

describe('profile count and roster', () => {
  const result = validateFocusProfiles(RAW);
  const names = Object.keys(result.profiles);

  test('exactly 25 profiles registered', () => {
    assert.equal(names.length, 25, `expected 25 profiles, got ${names.length}: ${names.join(', ')}`);
  });

  for (const name of EXPECTED_PROFILES) {
    test(`profile "${name}" is present`, () => {
      assert.ok(name in result.profiles, `profile "${name}" is missing from focus-profiles.json`);
    });
  }
});

// ── Per-profile structural invariants ────────────────────────────────────────

describe('per-profile structural invariants', () => {
  const result = validateFocusProfiles(RAW);

  for (const [name, profile] of Object.entries(result.profiles)) {
    test(`${name}: description is a non-empty string`, () => {
      assert.ok(
        typeof profile.description === 'string' && profile.description.length > 0,
        `${name}.description must be a non-empty string; got ${JSON.stringify(profile.description)}`,
      );
    });

    test(`${name}: has at least one category or server`, () => {
      assert.ok(
        profile.categories.length > 0 || profile.servers.length > 0,
        `${name} must declare at least one category or server`,
      );
    });

    test(`${name}: boost is a positive finite number`, () => {
      assert.ok(
        typeof profile.boost === 'number' &&
          Number.isFinite(profile.boost) &&
          profile.boost > 0,
        `${name}.boost must be a positive finite number; got ${profile.boost}`,
      );
    });

    if (profile.categories.length > 0) {
      test(`${name}: all categories are in VALID_CATEGORIES`, () => {
        for (const cat of profile.categories) {
          assert.ok(
            VALID_CATEGORIES.has(cat),
            `${name}.categories contains invalid value "${cat}". Must be one of: ${[...VALID_CATEGORIES].join(', ')}`,
          );
        }
      });
    }
  }
});
