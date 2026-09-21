/**
 * DT — focus-suggestions.json structural drift guard.
 *
 * Guards that the suggestions catalog on disk stays structurally valid and
 * in sync with the focus-profiles.json profile roster. Catches:
 *   - profiles added/removed without updating the catalog
 *   - required fields hollowed out of a combo or prompt
 *   - chain entries drifting away from "serverId/toolName" format
 *   - combos or prompts falling below the minimum count per profile
 *
 * Coverage:
 *   - File parses as valid JSON with expected top-level keys
 *   - Exactly 25 profiles; all 25 known names present
 *   - Bidirectional sync: catalog profiles ↔ focus-profiles.json profiles
 *   - Every profile has a non-empty description string
 *   - Every profile has ≥ 3 combos
 *   - Every profile has ≥ 3 prompts
 *   - Every combo has required string fields: name, chain, accomplishes, notes
 *   - Every combo.verified is a boolean
 *   - Every combo.chain is a non-empty array of "serverId/toolName" strings
 *   - Combo names are unique within each profile
 *   - Every prompt has required string fields: text, resolves_to
 *   - Every prompt.resolves_to matches "serverId/toolName" format
 *   - Prompt texts are unique within each profile
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SUGGESTIONS_RAW = JSON.parse(
  readFileSync(join(ROOT, 'focus-suggestions.json'), 'utf-8'),
) as unknown;

const FOCUS_PROFILES_RAW = JSON.parse(
  readFileSync(join(ROOT, 'focus-profiles.json'), 'utf-8'),
) as unknown;

// Snapshot of the 25 known catalog profile names.
// Update intentionally when a profile is added or removed.
const EXPECTED_PROFILES = [
  'analytics', 'auth', 'chittyevidence', 'cloud', 'code',
  'communication', 'data', 'deploy', 'design', 'devops',
  'documents', 'finance', 'google', 'governance', 'ledger',
  'legal', 'market', 'monitoring', 'ops', 'realestate',
  'search', 'security', 'session', 'tasks', 'workspace',
] as const;

// Pattern for valid "serverId/toolName" entries in chain arrays and resolves_to.
const TOOL_REF_RE = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_\-./]+$/;

// ── Type helpers (runtime-checked below) ────────────────────────────────────

interface SuggestionCombo {
  name: string;
  chain: string[];
  accomplishes: string;
  verified: boolean;
  notes: string;
}

interface SuggestionPrompt {
  text: string;
  resolves_to: string;
}

interface SuggestionProfile {
  description: string;
  combos: SuggestionCombo[];
  prompts: SuggestionPrompt[];
}

interface SuggestionsCatalog {
  profiles: Record<string, SuggestionProfile>;
}

// ── Top-level structure ──────────────────────────────────────────────────────

describe('focus-suggestions.json top-level structure', () => {
  test('parses as a non-null object', () => {
    assert.ok(SUGGESTIONS_RAW !== null && typeof SUGGESTIONS_RAW === 'object' && !Array.isArray(SUGGESTIONS_RAW));
  });

  test('has a "profiles" key that is a non-null object', () => {
    const raw = SUGGESTIONS_RAW as Record<string, unknown>;
    assert.ok('profiles' in raw, 'missing "profiles" key');
    assert.ok(raw['profiles'] !== null && typeof raw['profiles'] === 'object' && !Array.isArray(raw['profiles']));
  });
});

// ── Catalog from here on ─────────────────────────────────────────────────────

const catalog = (SUGGESTIONS_RAW as SuggestionsCatalog).profiles;
const focusProfilesProfiles = ((FOCUS_PROFILES_RAW as Record<string, unknown>)['profiles'] ?? {}) as Record<string, unknown>;

// ── Roster ───────────────────────────────────────────────────────────────────

describe('profile roster', () => {
  test('exactly 25 profiles', () => {
    assert.strictEqual(Object.keys(catalog).length, 25);
  });

  for (const name of EXPECTED_PROFILES) {
    test(`profile "${name}" is present`, () => {
      assert.ok(name in catalog, `missing profile: ${name}`);
    });
  }
});

// ── Bidirectional sync with focus-profiles.json ───────────────────────────────

describe('bidirectional sync with focus-profiles.json', () => {
  test('every focus-profiles.json profile has a catalog entry', () => {
    const missing = Object.keys(focusProfilesProfiles).filter(n => !(n in catalog));
    assert.deepEqual(missing, [], `focus-profiles entries missing from catalog: ${missing.join(', ')}`);
  });

  test('every catalog profile exists in focus-profiles.json', () => {
    const extra = Object.keys(catalog).filter(n => !(n in focusProfilesProfiles));
    assert.deepEqual(extra, [], `catalog profiles not in focus-profiles.json: ${extra.join(', ')}`);
  });
});

// ── Per-profile invariants ────────────────────────────────────────────────────

describe('per-profile description', () => {
  for (const [name, profile] of Object.entries(catalog)) {
    test(`${name}: description is a non-empty string`, () => {
      assert.ok(typeof profile.description === 'string' && profile.description.trim().length > 0,
        `${name}: description is empty or not a string`);
    });
  }
});

describe('per-profile combos minimum count', () => {
  for (const [name, profile] of Object.entries(catalog)) {
    test(`${name}: has at least 3 combos`, () => {
      assert.ok(Array.isArray(profile.combos), `${name}: combos is not an array`);
      assert.ok(profile.combos.length >= 3, `${name}: expected ≥3 combos, got ${profile.combos.length}`);
    });
  }
});

describe('per-profile prompts minimum count', () => {
  for (const [name, profile] of Object.entries(catalog)) {
    test(`${name}: has at least 3 prompts`, () => {
      assert.ok(Array.isArray(profile.prompts), `${name}: prompts is not an array`);
      assert.ok(profile.prompts.length >= 3, `${name}: expected ≥3 prompts, got ${profile.prompts.length}`);
    });
  }
});

// ── Combo structure ───────────────────────────────────────────────────────────

describe('combo required string fields', () => {
  for (const [name, profile] of Object.entries(catalog)) {
    test(`${name}: every combo has name, accomplishes, notes as non-empty strings`, () => {
      for (const combo of profile.combos) {
        assert.ok(typeof combo.name === 'string' && combo.name.length > 0,
          `${name}: combo missing non-empty name`);
        assert.ok(typeof combo.accomplishes === 'string' && combo.accomplishes.length > 0,
          `${name}: combo "${combo.name}" missing non-empty accomplishes`);
        assert.ok(typeof combo.notes === 'string',
          `${name}: combo "${combo.name}" notes is not a string`);
      }
    });
  }
});

describe('combo.verified is boolean', () => {
  for (const [name, profile] of Object.entries(catalog)) {
    test(`${name}: every combo.verified is a boolean`, () => {
      for (const combo of profile.combos) {
        assert.ok(typeof combo.verified === 'boolean',
          `${name}: combo "${combo.name}" verified is ${typeof combo.verified}, expected boolean`);
      }
    });
  }
});

describe('combo.chain format', () => {
  for (const [name, profile] of Object.entries(catalog)) {
    test(`${name}: every combo.chain is a non-empty array of "serverId/toolName" strings`, () => {
      for (const combo of profile.combos) {
        assert.ok(Array.isArray(combo.chain) && combo.chain.length > 0,
          `${name}: combo "${combo.name}" chain is empty or not an array`);
        for (const entry of combo.chain) {
          assert.ok(typeof entry === 'string' && TOOL_REF_RE.test(entry),
            `${name}: combo "${combo.name}" chain entry "${entry}" does not match serverId/toolName format`);
        }
      }
    });
  }
});

describe('combo name uniqueness within profile', () => {
  for (const [name, profile] of Object.entries(catalog)) {
    test(`${name}: combo names are unique`, () => {
      const names = profile.combos.map(c => c.name);
      const dupes = names.filter((n, i) => names.indexOf(n) !== i);
      assert.deepEqual(dupes, [], `${name}: duplicate combo names: ${dupes.join(', ')}`);
    });
  }
});

// ── Prompt structure ──────────────────────────────────────────────────────────

describe('prompt required fields', () => {
  for (const [name, profile] of Object.entries(catalog)) {
    test(`${name}: every prompt has non-empty text and resolves_to`, () => {
      for (const prompt of profile.prompts) {
        assert.ok(typeof prompt.text === 'string' && prompt.text.trim().length > 0,
          `${name}: prompt missing non-empty text`);
        assert.ok(typeof prompt.resolves_to === 'string' && prompt.resolves_to.length > 0,
          `${name}: prompt "${prompt.text.slice(0, 40)}" missing resolves_to`);
      }
    });
  }
});

describe('prompt.resolves_to format', () => {
  for (const [name, profile] of Object.entries(catalog)) {
    test(`${name}: every prompt.resolves_to is a valid tool ref or chain of tool refs`, () => {
      for (const prompt of profile.prompts) {
        // resolves_to may be a single "serverId/toolName" or a chain "a/b → c/d → e/f"
        const steps = prompt.resolves_to.split(' → ');
        for (const step of steps) {
          assert.ok(TOOL_REF_RE.test(step.trim()),
            `${name}: prompt resolves_to step "${step.trim()}" in "${prompt.resolves_to}" does not match serverId/toolName format`);
        }
      }
    });
  }
});

describe('prompt text uniqueness within profile', () => {
  for (const [name, profile] of Object.entries(catalog)) {
    test(`${name}: prompt texts are unique`, () => {
      const texts = profile.prompts.map(p => p.text);
      const dupes = texts.filter((t, i) => texts.indexOf(t) !== i);
      assert.deepEqual(dupes, [], `${name}: duplicate prompt texts: ${dupes.join(', ')}`);
    });
  }
});
