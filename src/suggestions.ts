// Ported from src/suggestions.ts — the pure scoring logic (scoreCombo,
// scorePrompt, getSuggestionsForFocus) is kept verbatim. The Node fs loader
// (loadSuggestionsCatalog/readFileSync against the 1.3MB focus-suggestions.json)
// is dropped: bundling 1.3MB into the isolate is wasteful and the catalog is
// optional cast enrichment. The catalog is supplied as an in-memory object
// (empty by default; can be hydrated from KV/assets later — see DO ctor).
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

function scoreCombo(combo: SuggestedCombo, terms: string[]): number {
  const haystack = `${combo.name} ${combo.accomplishes} ${combo.chain.join(' ')}`.toLowerCase();
  return terms.filter((t) => haystack.includes(t)).length / terms.length;
}

function scorePrompt(prompt: SuggestedPrompt, terms: string[]): number {
  const haystack = `${prompt.text} ${prompt.resolves_to}`.toLowerCase();
  return terms.filter((t) => haystack.includes(t)).length / terms.length;
}

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

  const comboScores = profile.combos.map((c) => (terms.length > 0 ? scoreCombo(c, terms) : 0));
  const combos = profile.combos
    .map((c, i) => ({ c, score: comboScores[i]!, i }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.c.verified ? 1 : 0) - (a.c.verified ? 1 : 0) ||
        a.i - b.i,
    )
    .map(({ c }) => c);

  const promptScores = profile.prompts.map((p) => (terms.length > 0 ? scorePrompt(p, terms) : 0));
  const prompts = profile.prompts
    .map((p, i) => ({ p, score: promptScores[i]!, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ p }) => p);

  return {
    combos: combos.slice(0, maxCombos),
    prompts: prompts.slice(0, maxPrompts),
  };
}
