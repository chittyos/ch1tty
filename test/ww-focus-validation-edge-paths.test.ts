/**
 * WW: focus.ts validateFocusProfiles / validateProfile / assertStringArray edge paths.
 *
 * Six branches in the pure validation layer that are NOT covered by focus.test.ts:
 *  1. Root value is not a Record  → "Focus profiles root must be an object"
 *  2. `profiles` field is not a Record (e.g. array) → "must include a \"profiles\" object"
 *  3. Profile `description` is present but not a string → throws
 *  4. Profile `boost` is NaN  → fails isFinite check → throws
 *  5. Profile `boost` is Infinity → fails isFinite check → throws
 *  6. `categories` array contains a non-string element → assertStringArray throws
 *
 * All tests are pure (no I/O, no network).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFocusProfiles } from '../src/focus.js';

test('validateFocusProfiles: root null → throws "Focus profiles root must be an object"', () => {
  assert.throws(
    () => validateFocusProfiles(null),
    /Focus profiles root must be an object/,
  );
});

test('validateFocusProfiles: profiles field is an array → throws "must include a \\"profiles\\" object"', () => {
  assert.throws(
    () => validateFocusProfiles({ profiles: ['not', 'an', 'object'] }),
    /Focus profiles root must include a "profiles" object/,
  );
});

test('validateProfile: description present but not a string → throws', () => {
  assert.throws(
    () => validateFocusProfiles({ profiles: { x: { servers: ['a'], description: 42 } } }),
    /profiles\.x\.description must be a string/,
  );
});

test('validateProfile: boost is NaN → fails isFinite → throws', () => {
  assert.throws(
    () => validateFocusProfiles({ profiles: { x: { servers: ['a'], boost: NaN } } }),
    /profiles\.x\.boost must be a non-negative number/,
  );
});

test('validateProfile: boost is Infinity → fails isFinite → throws', () => {
  assert.throws(
    () => validateFocusProfiles({ profiles: { x: { servers: ['a'], boost: Infinity } } }),
    /profiles\.x\.boost must be a non-negative number/,
  );
});

test('assertStringArray: categories contains non-string element → throws', () => {
  assert.throws(
    () => validateFocusProfiles({ profiles: { x: { categories: ['code', 99] } } }),
    /profiles\.x\.categories must be an array of strings/,
  );
});
