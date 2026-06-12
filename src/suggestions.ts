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

/** Score a combo against non-empty intent terms. Fraction of terms found in name+accomplishes+chain. */
function scoreCombo(combo: SuggestedCombo, terms: string[]): number {
  const haystack = `${combo.name} ${combo.accomplishes} ${combo.chain.join(' ')}`.toLowerCase();
  return terms.filter((t) => haystack.includes(t)).length / terms.length;
}

/** Score a prompt against non-empty intent terms. Fraction of terms found in text+resolves_to. */
function scorePrompt(prompt: SuggestedPrompt, terms: string[]): number {
  const haystack = `${prompt.text} ${prompt.resolves_to}`.toLowerCase();
  return terms.filter((t) => haystack.includes(t)).length / terms.length;
}

/**
 * Return the top `maxCombos` combos and `maxPrompts` prompts for a focus name.
 * Returns null when the focus has no catalog entry.
 *
 * When `intent` is provided, combos and prompts are ranked by keyword relevance
 * to the intent (3+ char terms matched against name/accomplishes/chain/text).
 * Equal-scoring entries preserve catalog order (stable sort). When intent is
 * absent or all scores are zero, catalog order is preserved exactly.
 */
export function getSuggestionsForFocus(
  focusName: string,
  catalog: Record<string, FocusSuggestions>,
  { maxCombos = 3, maxPrompts = 3, intent }: { maxCombos?: number; maxPrompts?: number; intent?: string } = {},
): { combos: SuggestedCombo[]; prompts: SuggestedPrompt[] } | null {
  const profile = catalog[focusName];
  if (!profile) return null;

  const terms = intent
    ? intent.toLowerCase().split(/\s+/).filter((t) => t.length > 2)
    : [];

  // Rank combos: intent score (primary) → verified (tiebreaker) → catalog order (stable)
  const comboScores = profile.combos.map((c) =>
    terms.length > 0 ? scoreCombo(c, terms) : 0,
  );
  const combos = profile.combos
    .map((c, i) => ({ c, score: comboScores[i], i }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.c.verified ? 1 : 0) - (a.c.verified ? 1 : 0) ||
        a.i - b.i,
    )
    .map(({ c }) => c);

  // Rank prompts: intent score (primary) → catalog order (stable)
  const promptScores = profile.prompts.map((p) =>
    terms.length > 0 ? scorePrompt(p, terms) : 0,
  );
  const prompts = profile.prompts
    .map((p, i) => ({ p, score: promptScores[i], i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ p }) => p);

  return {
    combos: combos.slice(0, maxCombos),
    prompts: prompts.slice(0, maxPrompts),
  };
}

/**
 * Find the first catalog combo whose chain starts with the given tool name.
 * Returns null when no match or the focus has no catalog entry.
 *
 * Used by cast: executed / cast: plan to annotate the response when the
 * resolved tool is the entry-point of a curated workflow in the active focus.
 */
export function findCatalogCombo(
  toolName: string,
  focusName: string,
  catalog: Record<string, FocusSuggestions>,
): SuggestedCombo | null {
  const profile = catalog[focusName];
  if (!profile) return null;
  return profile.combos.find((c) => c.chain[0] === toolName) ?? null;
}
