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
  cloudflare: 'ecosystem',
  'cloudflare-builds': 'ecosystem',
  fs: 'ecosystem',
  'browser-rendering': 'desktop',
  playwright: 'desktop',
  cowork: 'desktop',
  github: 'code',
  linear: 'code',
  context7: 'documents',
  pdf: 'documents',
  chittymac: 'communication',
  imessage: 'communication',
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
    expect: 'context7/query-docs',
    note: 'near-miss: notion/query_database (query + documents); context7 is in-focus via code profile servers list',
  },
  {
    id: 'code.linear-search-issues',
    focus: 'code',
    intent: 'search Linear for open issues assigned to me in this sprint',
    expect: 'linear/list_issues',
    note: 'linear is in-focus via code profile servers list; near-miss: github/create_issue (issue keyword)',
  },

  // ── communication focus ──────────────────────────────────────────────────────
  {
    id: 'comm.send-message',
    focus: 'communication',
    intent: 'send a direct sms or text message to a contact',
    expect: 'imessage/send_message',
    note: 'near-miss: imessage/search_messages (same server, search vs send); sms/text/contact trio uniquely scores send_message over any orchestrator or ops tool',
  },
  {
    id: 'comm.search-notes',
    focus: 'communication',
    intent: 'search my Apple Notes for the design review meeting notes',
    expect: 'chittymac/search_notes',
    note: 'near-miss: imessage/search_messages (search keyword, same focus); Apple Notes specificity wins',
  },
  {
    id: 'comm.create-doc',
    focus: 'communication',
    intent: 'create a new Notion page to document the team meeting',
    expect: 'notion/create_page',
    note: 'near-miss: chittymac/create_note (create + note keyword, same focus); Notion specificity wins',
  },
  {
    id: 'comm.create-task',
    focus: 'communication',
    intent: 'create a follow-up task to track the deployment issue from the team message',
    expect: 'tasks/create_task',
    note: 'near-miss: imessage/send_message (message keyword), notion/create_page (create keyword); tasks in communication profile via servers list',
  },

  // ── ops journey ──────────────────────────────────────────────
  {
    id: 'ops.deploy-worker',
    focus: 'ops',
    intent: 'deploy the cloudflare worker script to production',
    expect: 'cloudflare/deploy_worker',
    note: 'near-misses: orchestrator/skill_execute (execute keyword), fs/write_file (write/deploy keyword)',
  },
  {
    id: 'ops.list-workers',
    focus: 'ops',
    intent: 'list all deployed cloudflare workers and their status',
    expect: 'cloudflare/list_workers',
    note: 'near-misses: tasks/list_tasks (list keyword), orchestrator/agent_list (list keyword)',
  },
  {
    id: 'ops.skill-search',
    focus: 'ops',
    intent: 'search for a skill to run a scheduled database backup job',
    expect: 'orchestrator/skill_search',
    note: 'near-misses: neon/run_sql (run+database), orchestrator/agent_search (search+orchestrator but agent not skill)',
  },
  {
    id: 'ops.list-agents',
    focus: 'ops',
    intent: 'list all orchestrator agents for incident triage and status check',
    expect: 'orchestrator/agent_list',
    note: 'near-misses: tasks/list_tasks (list+tasks keyword), orchestrator/skill_list (list+orchestrator but skills not agents)',
  },
  {
    // REORDER probe: cross-focus near-miss. Without focus, chittymac/list_notes
    // (communication, OOF for ops) wins on raw keyword score — "list notes folder" = 3/4 = 0.75.
    // With the ops focus, fs/list_directory gains +0.50 boost — "list filesystem" = 2/4 + 0.50 = 1.00
    // — and flips to win. Confirms focus boost re-ranks an OOF leader without hiding it.
    id: 'ops.listdir-reorder',
    focus: 'ops',
    intent: 'list notes in filesystem folder',
    expect: 'fs/list_directory',
    note: 'REORDER: without ops focus chittymac/list_notes wins (0.75); with ops focus fs/list_directory wins (1.00)',
  },
  {
    id: 'ops.build-status',
    focus: 'ops',
    intent: 'list recent build runs and check build status for the cloudflare workers builds pipeline',
    expect: 'cloudflare-builds/workers_builds_list_builds',
    note: 'near-misses: cloudflare/list_workers (list+workers but not build+runs+status+timestamps), orchestrator/agent_list (list keyword). Both are ecosystem so both get ops boost; workers_builds_list_builds wins on keyword specificity.',
  },
  {
    id: 'ops.build-logs',
    focus: 'ops',
    intent: 'get the build logs for the failed cloudflare workers builds run to diagnose the deployment error',
    expect: 'cloudflare-builds/workers_builds_get_build_logs',
    note: 'near-misses: cloudflare/get_worker_logs (logs+worker+cloudflare but "build logs" not "worker logs"), cloudflare-builds/workers_builds_get_build (get+build but not logs+failed+diagnose+errors).',
  },

  // ── governance follow-up scenarios ───────────────────────────
  {
    id: 'governance.evidence-ingest',
    focus: 'governance',
    intent: 'ingest a governance document into the evidence pipeline with chain of custody tracking',
    expect: 'evidence/ingest_document',
    note: 'near-miss: chittyevidence/ingest_document (same family, ingest+document but no pipeline/chain/custody keywords)',
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

/**
 * A mis-resolution event: a scenario where the correct tool is NOT the top
 * resolution when run without focus. May or may not be corrected by applying focus.
 */
export interface MisresolutionEvent {
  id: string;
  intent: string;
  focus: string;
  expected: string;
  /** Tool that won without focus (the "intruder"). */
  noFocusTop: string | null;
  noFocusExpectedScore: number | null;
  noFocusTopScore: number | null;
  /** Whether applying focus corrects the resolution (expected tool wins). */
  correctedByFocus: boolean;
  withFocusTop: string | null;
}

/**
 * Surface mis-resolutions across all focused scenarios: run each scenario
 * without focus, identify cases where the wrong tool wins, and classify them
 * as focus-correctable or uncorrectable. Uncorrectable mis-resolutions mean
 * the correct tool loses even with focus applied — a genuine scoring bug.
 *
 * Returns ONLY scenarios that mis-resolve without focus. Focus-correct
 * resolutions (expected tool already wins without focus) are not returned —
 * they are not mis-resolutions.
 */
export async function surfaceMisresolutions(
  aggregator: Aggregator,
): Promise<MisresolutionEvent[]> {
  const events: MisresolutionEvent[] = [];
  for (const sc of SCENARIOS) {
    if (!sc.focus) continue;
    const without = await castPlan(aggregator, sc.intent, 'none');
    const noFocusTop = without.resolved?.tool ?? null;
    if (noFocusTop === sc.expect) continue; // already resolves correctly without focus
    const withF = await castPlan(aggregator, sc.intent, sc.focus);
    const withFocusTop = withF.resolved?.tool ?? null;
    events.push({
      id: sc.id,
      intent: sc.intent,
      focus: sc.focus,
      expected: sc.expect,
      noFocusTop,
      noFocusExpectedScore: scoreOf(without, sc.expect),
      noFocusTopScore: without.resolved?.score ?? null,
      correctedByFocus: withFocusTop === sc.expect,
      withFocusTop,
    });
  }
  return events;
}

// ── Failure scenarios ──────────────────────────────────────────────────────────
// Tests for execute-level error propagation and degraded-backend graceful
// degradation. These exercise the aggregator's error-handling paths, not just
// its resolution paths.

export interface FailureScenarioResult {
  id: string;
  description: string;
  pass: boolean;
  ms: number;
  detail: string;
}

/**
 * Build an Aggregator with failure injections for targeted failure testing.
 * `degradedServers` have their listTools throw (backend connectivity loss).
 * `toolErrors` (`serverId/toolName`) have their callTool return isError: true.
 */
export function buildDegradedAggregator(opts: {
  degradedServers?: string[];
  toolErrors?: string[];
}): { aggregator: Aggregator; backend: FixtureBackend } {
  const backend = new FixtureBackend();
  for (const s of opts.degradedServers ?? []) backend.setDegraded(s);
  for (const te of opts.toolErrors ?? []) {
    const sep = te.lastIndexOf('/');
    if (sep > 0) backend.setToolError(te.slice(0, sep), te.slice(sep + 1));
  }
  const aggregator = new Aggregator(fixtureConfigs(), {
    backendFactory: () => backend,
  });
  return { aggregator, backend };
}

/**
 * Execute a tool that has been injected to fail; verify isError is propagated
 * through the aggregator's execute path unchanged.
 */
export async function runExecuteErrorScenario(
  aggregator: Aggregator,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<FailureScenarioResult> {
  const id = `execute-error:${tool}`;
  const t0 = performance.now();
  const result = await aggregator.callTool('ch1tty/execute', { tool, args });
  const ms = Math.round((performance.now() - t0) * 100) / 100;
  const pass = result.isError === true;
  return {
    id,
    description: `execute ${tool} with error injection → isError propagated`,
    pass,
    ms,
    detail: pass
      ? 'isError=true propagated correctly'
      : `expected isError=true, got isError=${JSON.stringify(result.isError)}`,
  };
}

/**
 * Search with a degraded backend; verify no crash and a specific tool from a
 * working server still appears in results (lens remains, degraded tools absent).
 */
export async function runDegradedSearchScenario(
  aggregator: Aggregator,
  opts: {
    id: string;
    query: string;
    focus?: string;
    degradedServer: string;
    expectToolFromOther: string;
  },
): Promise<FailureScenarioResult> {
  const t0 = performance.now();
  try {
    const result = await aggregator.callTool('ch1tty/search', {
      query: opts.query,
      focus: opts.focus,
      limit: 50,
    });
    const ms = Math.round((performance.now() - t0) * 100) / 100;
    if (result.isError) {
      return {
        id: opts.id,
        description: `search "${opts.query}" with ${opts.degradedServer} degraded`,
        pass: false,
        ms,
        detail: `search returned isError`,
      };
    }
    const text = result.content.find((c) => c.type === 'text');
    const body = text?.type === 'text' ? text.text : '';
    const hasExpected = body.includes(opts.expectToolFromOther);
    return {
      id: opts.id,
      description: `search "${opts.query}" with ${opts.degradedServer} degraded — ${opts.expectToolFromOther} reachable`,
      pass: hasExpected,
      ms,
      detail: hasExpected
        ? `"${opts.expectToolFromOther}" found in results`
        : `"${opts.expectToolFromOther}" absent`,
    };
  } catch (err) {
    const ms = Math.round((performance.now() - t0) * 100) / 100;
    return {
      id: opts.id,
      description: `search with ${opts.degradedServer} degraded`,
      pass: false,
      ms,
      detail: `unexpected throw: ${(err as Error).message}`,
    };
  }
}

/**
 * Cast with a degraded backend; verify no crash and the resolved tool does
 * not come from the degraded server (its tools are absent from the registry).
 */
export async function runDegradedCastScenario(
  aggregator: Aggregator,
  opts: {
    id: string;
    intent: string;
    focus?: string;
    degradedServer: string;
  },
): Promise<FailureScenarioResult> {
  const t0 = performance.now();
  try {
    const plan = await castPlan(aggregator, opts.intent, opts.focus);
    const ms = Math.round((performance.now() - t0) * 100) / 100;
    const resolved = plan.resolved?.tool ?? null;
    const fromDegraded = resolved?.startsWith(`${opts.degradedServer}/`) ?? false;
    const pass = !fromDegraded;
    return {
      id: opts.id,
      description: `cast "${opts.intent.slice(0, 40)}" with ${opts.degradedServer} degraded — graceful fallback`,
      pass,
      ms,
      detail: pass
        ? `resolved to ${resolved ?? '(null)'} — degraded server excluded`
        : `resolved to ${resolved} — should not resolve to degraded ${opts.degradedServer}`,
    };
  } catch (err) {
    const ms = Math.round((performance.now() - t0) * 100) / 100;
    return {
      id: opts.id,
      description: `cast with ${opts.degradedServer} degraded`,
      pass: false,
      ms,
      detail: `unexpected throw: ${(err as Error).message}`,
    };
  }
}
