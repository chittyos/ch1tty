/**
 * scoreIntent arithmetic tests.
 *
 * scoreIntent is a private method on Aggregator, but its output is observable
 * through cast(confirm:true): the `resolved.score` field carries the exact
 * computed score for the winning tool. All prior tests check relative ordering
 * ("neon first", "fs wins") but never assert exact numeric values.
 *
 * Formula (aggregator.ts:996–1012):
 *   terms      = intent tokens with length > 2  (3+ chars; keyword fraction)
 *   shortTerms = intent tokens with length === 2 (2-char; name-bonus only)
 *   keywordScore  = matchCount / terms.length   (0 when terms.length === 0)
 *   affinityScore = 0.2 * exp(-Δt / 600000)    (0 when no session affinity)
 *   nameBonus     = 0.3 if any term/shortTerm exactly matches tool.name or tool.serverId
 *   score         = Math.round((kw + aff + name) * 100) / 100
 *   filter        = score > 0.1
 *
 * All Aggregator instances use KeywordOnlyCoordinator (routeIntent → null) so
 * tests are hermetic under CH1TTY_USE_OLLAMA_BRAIN=1 or any other brain env var.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type {
  Backend,
  BackendStatus,
  ContentItem,
  PromptEntry,
  ResourceEntry,
  ResourceTemplateEntry,
  ServerConfig,
  ToolCallResult,
  ToolEntry,
} from '../src/types.js';

// Always returns null from routeIntent so keyword scoring is the only path
// exercised, regardless of CH1TTY_USE_OLLAMA_BRAIN or embed env vars.
class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function dlq(label: string): string {
  return join(tmpdir(), `ch1tty-arith-${label}-${Date.now()}.jsonl`);
}

// ── Minimal in-process backend for exact-arithmetic fixtures ─────────────────

class ArithBackend implements Backend {
  private readonly store = new Map<string, ToolEntry[]>();

  set(serverId: string, tools: ToolEntry[]): void {
    this.store.set(serverId, tools);
  }

  registerServer(_config: ServerConfig): void {}
  isRegistered(serverId: string): boolean { return this.store.has(serverId); }
  getStatus(serverId: string): BackendStatus {
    return { connected: true, toolCount: this.store.get(serverId)?.length ?? 0, toolCacheAge: 0 };
  }
  async listTools(serverId: string): Promise<ToolEntry[]> {
    return this.store.get(serverId) ?? [];
  }
  async callTool(_s: string, _t: string): Promise<ToolCallResult> {
    return { content: [{ type: 'text', text: 'ok' }] };
  }
  async listResources(_s: string): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> {
    return { resources: [], templates: [] };
  }
  async readResource(_s: string, uri: string): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string }> }> {
    return { contents: [{ uri, text: 'fixture' }] };
  }
  async listPrompts(_s: string): Promise<PromptEntry[]> { return []; }
  async getPrompt(_s: string, name: string): Promise<{ description?: string; messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> {
    return { messages: [{ role: 'user', content: { type: 'text', text: name } }] };
  }
  async shutdown(): Promise<void> {}
}

function cfg(id: string, name: string, category: string): ServerConfig {
  return { id, name, type: 'remote', access: 'readwrite', category, endpoint: 'https://unused.invalid/mcp', lazy: false };
}

function makeAgg(b: ArithBackend, configs: ServerConfig[], label: string): Aggregator {
  const path = dlq(label);
  return new Aggregator(configs, {
    backendFactory: () => b,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: {},
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

function tool(name: string, description: string): ToolEntry {
  return { name, description, inputSchema: {} };
}

async function castPlan(agg: Aggregator, intent: string) {
  const r = await agg.callTool('ch1tty/cast', { intent, confirm: true });
  return JSON.parse((r.content[0] as { type: string; text: string }).text);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('scoreIntent arithmetic — keyword fraction', () => {
  it('single-term full match → score 1.00', async () => {
    // terms: ["execute"] (7 chars), matchCount: 1, keywordScore: 1/1 = 1.0, nameBonus: 0
    // haystack: "alpha/run_job execute background operations alpha server ecosystem"
    const b = new ArithBackend();
    b.set('alpha', [tool('run_job', 'execute background operations')]);
    const agg = makeAgg(b, [cfg('alpha', 'Alpha Server', 'ecosystem')], 'kw-full');
    try {
      const body = await castPlan(agg, 'execute');
      assert.equal(body.cast, 'plan', `expected plan, got ${JSON.stringify(body)}`);
      assert.equal(body.resolved.score, 1.0, `expected score 1.0, got ${body.resolved.score}`);
    } finally {
      await agg.shutdown();
    }
  });

  it('1-of-2 terms matched → score 0.50', async () => {
    // Intent: "fetch spreadsheets" — "fetch" (5 chars) matches, "spreadsheets" (12 chars) does not.
    // keywordScore: 1/2 = 0.5, nameBonus: 0 ("fetch_data" ≠ "fetch"; "beta" ≠ "fetch")
    const b = new ArithBackend();
    b.set('beta', [tool('fetch_data', 'fetch database records')]);
    const agg = makeAgg(b, [cfg('beta', 'Beta Server', 'data')], 'kw-partial');
    try {
      const body = await castPlan(agg, 'fetch spreadsheets');
      assert.equal(body.cast, 'plan');
      assert.equal(body.resolved.score, 0.5, `expected 0.5, got ${body.resolved.score}`);
    } finally {
      await agg.shutdown();
    }
  });

  it('1-of-3 terms matched → score rounds to 0.33', async () => {
    // Intent: "alpha beta gamma" — only "alpha" appears in haystack.
    // keywordScore: 1/3 = 0.3333… → Math.round(33.33) / 100 = 0.33
    // haystack: "delta/alpha_tool run alpha operations delta server ops"
    const b = new ArithBackend();
    b.set('delta', [tool('alpha_tool', 'run alpha operations')]);
    const agg = makeAgg(b, [cfg('delta', 'Delta Server', 'ops')], 'kw-round');
    try {
      const body = await castPlan(agg, 'alpha beta gamma');
      assert.equal(body.cast, 'plan');
      assert.equal(body.resolved.score, 0.33, `expected 0.33, got ${body.resolved.score}`);
    } finally {
      await agg.shutdown();
    }
  });
});

describe('scoreIntent arithmetic — name bonus', () => {
  it('tool.name exact match adds 0.3 bonus on top of keyword score', async () => {
    // "search database": both terms match for gamma/search; nameBonus = 0.3 (name "search" === "search")
    // gamma/query only matches "database" (kwScore 0.5) with no nameBonus → score 0.5
    const b = new ArithBackend();
    b.set('gamma', [
      tool('search', 'search database records'),
      tool('query', 'query database entries'),
    ]);
    const agg = makeAgg(b, [cfg('gamma', 'Gamma Server', 'database')], 'name-bonus');
    try {
      const body = await castPlan(agg, 'search database');
      assert.equal(body.cast, 'plan');
      assert.equal(body.resolved.tool, 'gamma/search', `name-bonus winner should be gamma/search`);
      assert.equal(body.resolved.score, 1.3, `expected 1.3 (1.0 kw + 0.3 name), got ${body.resolved.score}`);
      // alternative has lower score (no name bonus)
      assert.ok(
        body.alternatives.length > 0 && body.alternatives[0].score < 1.3,
        `alternative score should be lower than 1.3`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  it('tool.serverId exact match adds 0.3 bonus on top of keyword score', async () => {
    // serverId "neon" matches intent term "neon" → nameBonus = 0.3
    // tool.name is "alpha_proc" which doesn't match → bonus comes from serverId only
    // haystack: "neon/alpha_proc execute queries neon db database"
    // terms: ["neon", "execute"] → both match → keywordScore 1.0 + nameBonus 0.3 = 1.3
    const b = new ArithBackend();
    b.set('neon', [tool('alpha_proc', 'execute queries against the database')]);
    const agg = makeAgg(b, [cfg('neon', 'Neon DB', 'database')], 'serverid-bonus');
    try {
      const body = await castPlan(agg, 'neon execute');
      assert.equal(body.cast, 'plan');
      assert.equal(body.resolved.score, 1.3, `expected 1.3 (serverId bonus), got ${body.resolved.score}`);
    } finally {
      await agg.shutdown();
    }
  });

  it('neither name nor serverId match → no bonus, score is pure keyword fraction', async () => {
    // Intent "execute data" — "zeta" serverId and "process_records" name neither match any term
    // Both terms in haystack → keywordScore 1.0, nameBonus 0 → score 1.0
    const b = new ArithBackend();
    b.set('zeta', [tool('process_records', 'execute and process data operations')]);
    const agg = makeAgg(b, [cfg('zeta', 'Zeta Service', 'data')], 'no-bonus');
    try {
      const body = await castPlan(agg, 'execute data');
      assert.equal(body.cast, 'plan');
      assert.equal(body.resolved.score, 1.0, `expected 1.0 (no nameBonus), got ${body.resolved.score}`);
    } finally {
      await agg.shutdown();
    }
  });
});

describe('scoreIntent arithmetic — term length filtering', () => {
  it('2-char term excluded from keyword fraction denominator (keywordScore 0 not 1)', async () => {
    // Intent: "fs" — "fs" is 2 chars → goes to shortTerms, NOT terms.
    // terms = [] → keywordScore = 0 (terms.length === 0 branch)
    // nameBonus = 0.3 (shortTerms ["fs"] and serverId "fs" === "fs")
    // score = Math.round((0 + 0 + 0.3) * 100) / 100 = 0.3
    //
    // If "fs" were (wrongly) placed in terms: keywordScore = 1/1 = 1.0 → score = 1.3
    // The 0.3 ≠ 1.3 distinction proves 2-char exclusion from fraction denominator.
    const b = new ArithBackend();
    b.set('fs', [tool('list_files', 'shows all files in the directory')]);
    const agg = makeAgg(b, [cfg('fs', 'Filesystem', 'desktop')], 'shortterm');
    try {
      const body = await castPlan(agg, 'fs');
      assert.equal(body.cast, 'plan');
      assert.equal(
        body.resolved.score,
        0.3,
        `2-char "fs" excluded from keyword fraction → score 0.3 (nameBonus only), got ${body.resolved.score}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  it('1-char and 2-char-only intent with no 3+ terms → both terms arrays empty → no_match', async () => {
    // Intent: "a b" — "a" is 1 char (too short even for shortTerms), "b" is 1 char.
    // terms = [], shortTerms = [] → scoreIntent returns [] immediately → cast: no_match
    const b = new ArithBackend();
    b.set('omega', [tool('do_something', 'does something useful')]);
    const agg = makeAgg(b, [cfg('omega', 'Omega', 'ecosystem')], 'nomatch');
    try {
      const r = await agg.callTool('ch1tty/cast', { intent: 'a b', confirm: true });
      const body = JSON.parse((r.content[0] as { type: string; text: string }).text);
      assert.equal(body.cast, 'no_match', `all-short intent should produce no_match, got ${JSON.stringify(body)}`);
    } finally {
      await agg.shutdown();
    }
  });
});

describe('scoreIntent arithmetic — threshold and sort', () => {
  it('tool with score 0 (no match) filtered out — absent from cast alternatives', async () => {
    // "execute": matches alpha/run_job (score 1.0); beta/fetch_data has no match → score 0 → excluded.
    // Only alpha in results → alternatives empty (only 1 tool passed filter).
    const b = new ArithBackend();
    b.set('alpha', [tool('run_job', 'execute background operations')]);
    b.set('beta', [tool('fetch_data', 'retrieve stored records from database')]);
    const agg = makeAgg(b, [cfg('alpha', 'Alpha', 'ecosystem'), cfg('beta', 'Beta', 'data')], 'threshold');
    try {
      const body = await castPlan(agg, 'execute');
      assert.equal(body.cast, 'plan');
      assert.equal(body.resolved.tool, 'alpha/run_job', 'alpha/run_job should be resolved');
      // beta/fetch_data scored 0 → filtered; alternatives contains only higher-scored tools
      const altNames = (body.alternatives ?? []).map((a: { tool: string }) => a.tool);
      assert.ok(
        !altNames.includes('beta/fetch_data'),
        `beta/fetch_data with score 0 should be absent from alternatives, got: ${JSON.stringify(altNames)}`,
      );
    } finally {
      await agg.shutdown();
    }
  });

  it('tools sorted descending by score: highest-scoring tool resolves first', async () => {
    // Two tools: "list_tasks" and "execute_job".
    // Intent "tasks execute list" — 3 terms.
    // list_tasks: haystack has "tasks" and "list" (2/3 match) but name "list_tasks" ≠ any term → kwScore 0.67, no bonus
    // execute_job: haystack has "execute" (1/3 match), name "execute_job" ≠ any full term → kwScore 0.33, no bonus
    // list_tasks (0.67) > execute_job (0.33) → list_tasks resolves first
    const b = new ArithBackend();
    b.set('svc', [
      tool('list_tasks', 'list and manage tasks for the project'),
      tool('execute_job', 'run a background job in the queue'),
    ]);
    const agg = makeAgg(b, [cfg('svc', 'Service', 'ecosystem')], 'sort');
    try {
      const body = await castPlan(agg, 'tasks execute list');
      assert.equal(body.cast, 'plan');
      assert.equal(body.resolved.tool, 'svc/list_tasks', 'higher-scoring tool resolves first');
      assert.ok(
        body.resolved.score > body.alternatives[0]?.score,
        `resolved score ${body.resolved.score} should exceed alternative score ${body.alternatives[0]?.score}`,
      );
    } finally {
      await agg.shutdown();
    }
  });
});
