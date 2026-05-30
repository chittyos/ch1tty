import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from './logger.js';

export interface SuggestedCombo {
  name: string;
  chain: string[];
  accomplishes: string;
  verified: boolean;
  notes?: string;
}

export interface SuggestedPrompt {
  text: string;
  resolves_to: string;
}

export interface FocusSuggestions {
  description: string;
  combos: SuggestedCombo[];
  prompts: SuggestedPrompt[];
}

interface SuggestionsCatalogFile {
  _comment?: string;
  generatedFrom?: unknown;
  profiles: Record<string, FocusSuggestions>;
}

let _cached: Record<string, FocusSuggestions> | null = null;
let _catalogPath: string | null = null;

export function resolveSuggestionsCatalogPath(): string {
  return resolve(process.cwd(), 'focus-suggestions.json');
}

export function loadSuggestionsCatalog(path?: string): Record<string, FocusSuggestions> {
  const catalogPath = path ?? resolveSuggestionsCatalogPath();
  if (_cached && _catalogPath === catalogPath) return _cached;
  if (!existsSync(catalogPath)) {
    log.debug(`suggestions catalog not found at ${catalogPath} — suggestions disabled`);
    return {};
  }
  try {
    const raw = readFileSync(catalogPath, 'utf-8');
    const parsed = JSON.parse(raw) as SuggestionsCatalogFile;
    if (!parsed.profiles || typeof parsed.profiles !== 'object') {
      log.warn(`suggestions catalog at ${catalogPath} has no "profiles" key — ignoring`);
      return {};
    }
    _catalogPath = catalogPath;
    _cached = parsed.profiles;
    log.debug(`loaded suggestions catalog: ${Object.keys(_cached).join(', ')}`);
    return _cached;
  } catch (err) {
    log.warn(`failed to parse suggestions catalog at ${catalogPath}: ${err}`);
    return {};
  }
}

/** Clear the in-process cache (e.g. after reload). */
export function clearSuggestionsCache(): void {
  _cached = null;
  _catalogPath = null;
}

/**
 * Return the top `maxCombos` combos and `maxPrompts` prompts for a focus name.
 * Returns null when the focus has no catalog entry.
 */
export function getSuggestionsForFocus(
  focusName: string,
  catalog: Record<string, FocusSuggestions>,
  { maxCombos = 3, maxPrompts = 3 }: { maxCombos?: number; maxPrompts?: number } = {},
): { combos: SuggestedCombo[]; prompts: SuggestedPrompt[] } | null {
  const profile = catalog[focusName];
  if (!profile) return null;
  return {
    combos: profile.combos.slice(0, maxCombos),
    prompts: profile.prompts.slice(0, maxPrompts),
  };
}
