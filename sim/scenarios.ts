/**
 * Simulation scenarios + harness for the ch1tty gateway.
 *
 * Each scenario issues a realistic `cast` intent (confirm-mode, so we inspect the
 * resolution plan without executing) under a given focus, and asserts which tool
 * the gateway resolved as best — plus that focus actually reorders candidates and
 * that out-of-focus tools stay reachable.
 *
 * The seam: a real Aggregator wired to in-process FixtureBackends (real Backend
 * implementations, not module mocks) using the PRODUCTION focus-profiles.json, so
 * results reflect how the real lenses bias the real scoring path. The brain path
 * is null here (no Ollama), so cast falls back to the deterministic keyword
 * scoreIntent — exactly the path we want to characterize.
 */
// NOTE: This sim characterizes the DETERMINISTIC keyword-fallback resolution path
// (no live Ollama). The embedding brain must be disabled via CH1TTY_EMBED_ENABLED=false
// in the ENVIRONMENT before this module's imports load — embedding-brain.ts reads the
// flag into a module-level const at import time, so setting it here (after imports
// hoist) is too late. The `npm run sim` script and the CI test set it on the command.
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FIXTURE_TOOLS, FixtureBackend } from './fixture-backend.js';

/** Build fixture configs from the fixture catalog, using real categories. */
const CATEGORY_BY_SERVER: Record<string, ServerConfig['category']> = {
  stripe: 'ecosystem',
  tasks: 'ecosystem',
  ledger: 'ecosystem',
  session: 'ecosystem',
  chittyos: 'ecosystem',
  evidence: 'search',
  chittyevidence: 'search',
  neon: 'ecosystem',
  notion: 'documents',
  orchestrator: 'ecosystem',
  'browser-rendering': 'desktop',
  playwright: 'desktop',
  cowork: 'desktop',
  github: 'code',
  context7: 'documents',
  pdf: 'documents',
};

export function fixtureConfigs(): ServerConfig[] {
  return Object.keys(FIXTURE_TOOLS).map((id): ServerConfig => ({
    id,
    name: id,
    type: 'remote',
    access: 'readwrite',
    category: CATEGORY_BY_SERVER[id] ?? 'ecosystem',
    endpoint: `https://${id}.example.invalid/mcp`,
  }));
}

/**
 * Build an Aggregator over the fixture backends using the PRODUCTION focus
 * profiles. A single shared FixtureBackend instance is reused for every config so
 * the harness can inspect recorded calls if needed.
 */
export function buildSimAggregator(): { aggregator: Aggregator; backend: FixtureBackend } {
  const backend = new FixtureBackend();
  const aggregator = new Aggregator(fixtureConfigs(), {
    backendFactory: () => backend,
    // focusProfiles intentionally NOT overridden — uses real focus-profiles.json.
  });
  return { aggregator, backend };
}

export interface Scenario {
  id: string;
  focus?: string;
  intent: string;
  /** Namespaced tool we expect cast to resolve as best (serverId/toolName). */
  expect: string;
  note?: string;
}

/**
 * Scenarios per focus. Each focus has a multi-step user journey, plus targeted
 * probes where the "right answer" is unambiguous BECAUSE a near-miss exists in a
 * different server (resolution, not enumeration).
 */
export const SCENARIOS: Scenario[] = [
  // ── FINANCE journey ──────────────────────────────────────────
  {
    id: 'finance.invoice',
    focus: 'finance',
    intent: 'create an invoice for the customer with line items',
    expect: 'stripe/create_invoice',
    note: 'near-misses: notion/create_invoice_page, tasks/record_billing_event',
  },
  {
    id: 'finance.find-customer',
    focus: 'finance',
    intent: 'find the stripe customer by their email address',
    expect: 'stripe/find_customer',
  },
  {
    id: 'finance.charge',
    focus: 'finance',
    intent: 'record a payment charge against the customer',
    expect: 'stripe/record_charge',
  },
  // apps/ledger-mcp in finance profile — append_entry vs billing/payment near-misses
  {
    id: 'finance.ledger-append',
    focus: 'finance',
    intent: 'append billing entry to ledger for payment audit',
    expect: 'ledger/append_entry',
    note: 'near-misses: tasks/record_billing_event (billing but task not ledger), stripe/record_charge (payment but not ledger)',
  },

  // ── GOVERNANCE journey ───────────────────────────────────────
  {
    id: 'governance.registry',
    focus: 'governance',
    intent: 'query the service registry for registered services',
    expect: 'chittyos/query_registry',
    note: 'near-miss: evidence/search_fact_registry',
  },
  {
    id: 'governance.verify-fact',
    focus: 'governance',
    intent: 'verify this fact in the evidence governance lifecycle',
    expect: 'evidence/verify_fact',
  },
  {
    id: 'governance.ledger',
    focus: 'governance',
    intent: 'check the chittyledger for a recorded entry hash',
    expect: 'chittyos/check_ledger',
  },
  // apps/ledger-mcp tools — append_entry vs check_ledger (chittyos) and list_entries
  {
    id: 'governance.ledger-append',
    focus: 'governance',
    intent: 'append immutable ledger entry',
    expect: 'ledger/append_entry',
    note: 'near-misses: ledger/list_entries (same server, entry but no append), chittyos/check_ledger (ledger but read-only check)',
  },
  // apps/session-coordinator-mcp — create_session vs cowork/start_session
  {
    id: 'governance.session-create',
    focus: 'governance',
    intent: 'create new cross-agent coordination session for workflow tracking',
    expect: 'session/create_session',
    note: 'near-miss: cowork/start_session (also has "session" but for desktop collaboration, not cross-agent coordination)',
  },
  // apps/evidence-mcp (chittyevidence) vs evidence remote — full-text search discrimination
  {
    id: 'governance.evidence-search',
    focus: 'governance',
    intent: 'full-text search over evidence document corpus for audit records',
    expect: 'chittyevidence/search_documents',
    note: 'near-miss: evidence/search_fact_registry (same family, fact registry not corpus full-text)',
  },

  // ── DESIGN journey ───────────────────────────────────────────
  {
    id: 'design.render',
    focus: 'design',
    intent: 'render this web page to pdf via headless browser',
    expect: 'browser-rendering/render_page',
    note: 'near-miss: playwright/render_to_pdf',
  },
  {
    id: 'design.screenshot',
    focus: 'design',
    intent: 'capture a screenshot of the rendered web page',
    expect: 'browser-rendering/capture_screenshot',
    note: 'near-miss: playwright/screenshot',
  },
  {
    // REORDER probe: cross-focus near-miss. Without focus, pdf/render_pdf (documents,
    // out of the design lens) is a strong literal match. With the design focus, the
    // +0.5 boost must lift the in-focus browser-rendering tool above it.
    id: 'design.render-document-reorder',
    focus: 'design',
    intent: 'render a web page document to a pdf file',
    expect: 'browser-rendering/render_page',
    note: 'cross-focus near-miss: pdf/render_pdf (documents) should win WITHOUT focus, lose WITH design focus',
  },

  // ── code focus ───────────────────────────────────────────────────────────────
  {
    id: 'code.create-pr',
    focus: 'code',
    intent: 'create a pull request to merge my feature branch',
    expect: 'github/create_pull_request',
    note: 'near-miss: tasks/create_task (create keyword), notion/create_page (create keyword)',
  },
  {
    id: 'code.create-issue',
    focus: 'code',
    intent: 'open a GitHub issue for the bug I found in the repository',
    expect: 'github/create_issue',
    note: 'near-miss: tasks/create_task (create keyword)',
  },
  {
    id: 'code.lookup-docs',
    focus: 'code',
    intent: 'get the library documentation and code examples for this package',
    expect: 'context7/get-library-docs',
    note: 'near-miss: notion/query_database (query + documents); context7 is in-focus via code profile servers list',
  },
];

export interface CastPlan {
  cast: string;
  resolved?: { tool: string; server: string; category: string; score: number };
  alternatives?: Array<{ tool: string; score: number; description?: string }>;
}

/** Run cast in confirm mode and parse the resolution plan. */
export async function castPlan(
  aggregator: Aggregator,
  intent: string,
  focus?: string,
): Promise<CastPlan> {
  const args: Record<string, unknown> = { intent, confirm: true };
  if (focus !== undefined) args.focus = focus;
  const result = await aggregator.callTool('ch1tty/cast', args);
  const text = result.content.find((c) => c.type === 'text');
  if (!text || text.type !== 'text') {
    throw new Error('cast returned no text content');
  }
  return JSON.parse(text.text) as CastPlan;
}

export interface ScenarioResult {
  id: string;
  focus?: string;
  intent: string;
  expected: string;
  actual: string | null;
  actualScore: number | null;
  alternatives: Array<{ tool: string; score: number }>;
  pass: boolean;
  ms: number;
  note?: string;
}

/** Execute one scenario and capture timing + resolution detail. */
export async function runScenario(aggregator: Aggregator, sc: Scenario): Promise<ScenarioResult> {
  const t0 = performance.now();
  const plan = await castPlan(aggregator, sc.intent, sc.focus);
  const ms = Math.round((performance.now() - t0) * 100) / 100;
  const actual = plan.resolved?.tool ?? null;
  return {
    id: sc.id,
    focus: sc.focus,
    intent: sc.intent,
    expected: sc.expect,
    actual,
    actualScore: plan.resolved?.score ?? null,
    alternatives: (plan.alternatives ?? []).map((a) => ({ tool: a.tool, score: a.score })),
    pass: actual === sc.expect,
    ms,
    note: sc.note,
  };
}

/**
 * Probe: does focus actually reorder candidates? Run the same intent with and
 * without focus; report whether the top resolution and/or top score changed, and
 * whether the expected in-focus tool moved up.
 */
export interface FocusBiasProbe {
  id: string;
  intent: string;
  focus: string;
  expected: string;
  noFocusTop: string | null;
  noFocusExpectedScore: number | null;
  withFocusTop: string | null;
  withFocusExpectedScore: number | null;
  reordered: boolean;
  boosted: boolean;
}

function scoreOf(plan: CastPlan, tool: string): number | null {
  if (plan.resolved?.tool === tool) return plan.resolved.score;
  const alt = (plan.alternatives ?? []).find((a) => a.tool === tool);
  return alt ? alt.score : null;
}

export async function runFocusBiasProbe(aggregator: Aggregator, sc: Scenario): Promise<FocusBiasProbe> {
  const without = await castPlan(aggregator, sc.intent, 'none');
  const withF = await castPlan(aggregator, sc.intent, sc.focus);
  const noScore = scoreOf(without, sc.expect);
  const yesScore = scoreOf(withF, sc.expect);
  return {
    id: sc.id,
    intent: sc.intent,
    focus: sc.focus!,
    expected: sc.expect,
    noFocusTop: without.resolved?.tool ?? null,
    noFocusExpectedScore: noScore,
    withFocusTop: withF.resolved?.tool ?? null,
    withFocusExpectedScore: yesScore,
    reordered: (without.resolved?.tool ?? null) !== (withF.resolved?.tool ?? null),
    boosted: noScore !== null && yesScore !== null && yesScore > noScore,
  };
}

/**
 * Reachability probe: an out-of-focus tool must still be discoverable via search
 * even when a focus is active (lens, not gate).
 */
export async function outOfFocusReachable(
  aggregator: Aggregator,
  query: string,
  focus: string,
  expectTool: string,
): Promise<boolean> {
  const result = await aggregator.callTool('ch1tty/search', { query, focus, limit: 50 });
  const text = result.content.find((c) => c.type === 'text');
  if (!text || text.type !== 'text') return false;
  return text.text.includes(expectTool);
}
