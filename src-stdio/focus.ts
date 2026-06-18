import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ServerCategory } from './types.js';
import { log } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mirror the VALID_CATEGORIES set in config.ts — focus profiles reference the
// same category vocabulary as servers.json.
const VALID_CATEGORIES: Set<string> = new Set([
  'ecosystem', 'code', 'search', 'reasoning', 'desktop', 'documents', 'communication',
]);

const PROFILE_KEYS = new Set(['description', 'categories', 'servers', 'boost']);
const DEFAULT_BOOST = 0.5;

/**
 * A focus profile is a named lens over the registry. It names a set of relevant
 * categories and/or server ids; in-focus tools get an additive scoring boost in
 * search + cast. It is a lens, not a gate — out-of-focus tools stay reachable.
 */
export interface FocusProfile {
  description?: string;
  categories: ServerCategory[];
  servers: string[];
  boost: number;
}

export interface FocusProfiles {
  profiles: Record<string, FocusProfile>;
}

/** A tool's focus-relevant fields — the minimal shape applyFocusBias needs. */
export interface FocusableTool {
  serverId: string;
  category: ServerCategory;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertStringArray(value: unknown, fieldPath: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${fieldPath} must be an array of strings`);
  }
  return value as string[];
}

function validateProfile(name: string, raw: unknown): FocusProfile {
  const prefix = `profiles.${name}`;
  if (!isRecord(raw)) {
    throw new Error(`${prefix} must be an object`);
  }

  for (const key of Object.keys(raw)) {
    if (!PROFILE_KEYS.has(key)) {
      throw new Error(`${prefix}.${key} is not a recognized field`);
    }
  }

  let description: string | undefined;
  if (raw.description !== undefined) {
    if (typeof raw.description !== 'string') {
      throw new Error(`${prefix}.description must be a string`);
    }
    description = raw.description;
  }

  const categories = raw.categories === undefined ? [] : assertStringArray(raw.categories, `${prefix}.categories`);
  for (const c of categories) {
    if (!VALID_CATEGORIES.has(c)) {
      throw new Error(`${prefix}.categories contains invalid category "${c}". Must be one of: ${[...VALID_CATEGORIES].join(', ')}`);
    }
  }

  // Server ids are intentionally NOT validated against servers.json — a profile
  // may reference disabled or not-yet-shipped servers; they simply won't match.
  const servers = raw.servers === undefined ? [] : assertStringArray(raw.servers, `${prefix}.servers`);

  if (categories.length === 0 && servers.length === 0) {
    throw new Error(`${prefix} must declare at least one category or server`);
  }

  let boost = DEFAULT_BOOST;
  if (raw.boost !== undefined) {
    if (typeof raw.boost !== 'number' || !Number.isFinite(raw.boost) || raw.boost < 0) {
      throw new Error(`${prefix}.boost must be a non-negative number`);
    }
    boost = raw.boost;
  }

  return {
    description,
    categories: categories as ServerCategory[],
    servers,
    boost,
  };
}

export function validateFocusProfiles(raw: unknown): FocusProfiles {
  if (!isRecord(raw)) {
    throw new Error('Focus profiles root must be an object');
  }
  const { profiles } = raw;
  if (!isRecord(profiles)) {
    throw new Error('Focus profiles root must include a "profiles" object');
  }

  const out: Record<string, FocusProfile> = {};
  for (const [name, value] of Object.entries(profiles)) {
    out[name] = validateProfile(name, value);
  }
  return { profiles: out };
}

export function resolveFocusProfilesPath(): string {
  return process.env.CH1TTY_FOCUS_PROFILES || resolve(__dirname, '..', 'focus-profiles.json');
}

/**
 * Load + validate the focus profiles file. Returns an empty profile set if the
 * file is absent — focus is optional, and its absence must never break startup.
 * A malformed file still throws (a present-but-broken config is a real error).
 */
export function loadFocusProfilesFromPath(path: string): FocusProfiles {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return { profiles: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    throw new Error(`Invalid JSON in focus profiles at ${path}: ${String(err)}`);
  }

  try {
    return validateFocusProfiles(parsed);
  } catch (err) {
    throw new Error(`Invalid focus profiles at ${path}: ${String(err)}`);
  }
}

/** Resolve a focus name to its profile, or undefined (with a warning) if unknown. */
export function resolveFocus(profiles: FocusProfiles, name: string | undefined): FocusProfile | undefined {
  if (!name) return undefined;
  const profile = profiles.profiles[name];
  if (!profile) {
    // Soft: unknown focus is a no-op lens, not a hard error (lens, not gate).
    log.warn(`Unknown focus profile "${name}" — ignoring (no focus applied). Known: ${Object.keys(profiles.profiles).join(', ') || '(none)'}`);
    return undefined;
  }
  return profile;
}

/** True if a tool falls within the focus lens (by category or server id). */
export function isInFocus(profile: FocusProfile, tool: FocusableTool): boolean {
  return profile.categories.includes(tool.category) || profile.servers.includes(tool.serverId);
}

/**
 * Apply a focus profile as a soft additive bias over scored tools, then re-sort.
 *
 * Pure: in-focus tools get `+profile.boost` to their score; out-of-focus tools
 * are unchanged and remain present (never filtered). Re-sorts descending by the
 * biased score. Scores from both the v1 keyword path and the v2 brain confidence
 * path are 0–1ish, so a boost of ~0.5 reliably lifts in-focus matches without
 * erasing strong out-of-focus matches.
 */
export function applyFocusBias<T extends FocusableTool & { score: number }>(
  profile: FocusProfile,
  scored: T[],
): T[] {
  return scored
    .map((t) => (isInFocus(profile, t) ? { ...t, score: t.score + profile.boost } : t))
    .sort((a, b) => b.score - a.score);
}
