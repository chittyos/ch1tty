/**
 * CW — focus-suggestions.json drift detection.
 *
 * Verifies that focus-suggestions.json stays in sync with the authoritative
 * focus-profiles.json and that the catalog's internal structure is consistent.
 *
 * Coverage:
 *   - Every profile in focus-suggestions.json must appear in focus-profiles.json
 *     (no orphaned suggestion entries that reference a deleted focus profile).
 *   - Profile count must match exactly between focus-suggestions.json and
 *     focus-profiles.json (bidirectional parity with suggestions.test.ts which
 *     checks the forward direction: every focus profile has a suggestion entry).
 *   - Combo names must be unique within each profile (duplicate names silently
 *     shadow the earlier entry in some consumer implementations).
 *   - Every profile has a non-empty string description.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const focusProfilesJson = JSON.parse(
  readFileSync(join(ROOT, 'focus-profiles.json'), 'utf-8'),
) as { profiles: Record<string, unknown> };

const focusSuggestionsJson = JSON.parse(
  readFileSync(join(ROOT, 'focus-suggestions.json'), 'utf-8'),
) as {
  profiles: Record<string, {
    description: string;
    combos: Array<{ name: string; chain: string[]; accomplishes: string }>;
    prompts: Array<{ text: string; resolves_to: string }>;
  }>;
};

const suggestionProfileNames = Object.keys(focusSuggestionsJson.profiles);
const focusProfileNames = new Set(Object.keys(focusProfilesJson.profiles));

// ── Bidirectional profile-name parity ─────────────────────────────────────────

describe('focus-suggestions.json ↔ focus-profiles.json parity', () => {
  test('every focus-suggestions profile appears in focus-profiles.json', () => {
    for (const name of suggestionProfileNames) {
      assert.ok(
        focusProfileNames.has(name),
        `focus-suggestions.json has profile '${name}' that is not in focus-profiles.json`,
      );
    }
  });

  test('profile counts match between focus-suggestions.json and focus-profiles.json', () => {
    const suggestionsCount = suggestionProfileNames.length;
    const focusCount = focusProfileNames.size;
    assert.strictEqual(
      suggestionsCount,
      focusCount,
      `profile count mismatch: focus-suggestions.json has ${suggestionsCount}, focus-profiles.json has ${focusCount}`,
    );
  });
});

// ── Internal consistency: combo name uniqueness ───────────────────────────────

describe('focus-suggestions.json internal consistency', () => {
  test('combo names are unique within each profile', () => {
    for (const [profileName, profile] of Object.entries(focusSuggestionsJson.profiles)) {
      const seen = new Set<string>();
      for (const combo of profile.combos) {
        assert.ok(
          !seen.has(combo.name),
          `profile '${profileName}': duplicate combo name '${combo.name}'`,
        );
        seen.add(combo.name);
      }
    }
  });

  test('every profile has a non-empty string description', () => {
    for (const [profileName, profile] of Object.entries(focusSuggestionsJson.profiles)) {
      assert.ok(
        typeof profile.description === 'string' && profile.description.trim().length > 0,
        `profile '${profileName}': missing or empty description`,
      );
    }
  });
});
