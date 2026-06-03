/**
 * WWW batch — 4 previously untested branches:
 *
 *   1. aggregator.ts:786 — `if (added >= 5) break` in the brain-route focus
 *      augmentation loop: when brain routes AND focus is active, the loop adds
 *      keyword-scored in-focus tools up to a cap of 5. Prior tests only exercise
 *      paths where fewer than 5 in-focus tools exist (zero augmentation in VVV,
 *      or single-digit counts in scenario.test.ts). This test has 6 qualifying
 *      in-focus tools so `added` reaches 5 and the break fires before the 6th.
 *
 *   2. ledger.ts:132 — `if (tool && !tools.includes(tool))` false branch: when
 *      the same tool is appended to an existing tool_call_batch, the dedup check
 *      `tools.includes(tool)` returns true and the duplicate is silently dropped.
 *      Existing tests (ledger-flush.test.ts) only add DISTINCT tools to batches.
 *
 *   3. aggregator.ts:909 — `focusSuggestions = null` when focus is active but
 *      `suggestionsCatalog` has no entry for the focus name: `getSuggestionsForFocus`
 *      returns null and `suggestions` is absent from the cast plan. Prior tests
 *      either use the real catalog (non-null) or have no focus at all (null trivially).
 *
 *   4. gpt-actions.ts:28 — `if (!raw) return {}` in `readBody`: fires when the
 *      HTTP POST body is completely empty (zero bytes). Prior tests send non-empty
 *      bodies (valid JSON or malformed bytes). With no body, `raw` is `""` (falsy)
 *      and `readBody` returns `{}` before reaching `JSON.parse`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';
import { HttpMcpServer } from '../src/http-server.js';
import { LedgerClient } from '../src/ledger.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { RoutedTool, ToolCandidate } from '../src/ollama-brain.js';
import type { Backend, BackendStatus, ContentItem, PromptEntry, ResourceEntry, ResourceTemplateEntry, ServerConfig, ToolCallResult, ToolEntry } from '../src/types.js';

// ── Shared helpers ───────────────────────────────────────────────────────────

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-www-${process.pid}-${++_seq}.dlq.jsonl`);
}

class StubCoordinator extends SessionCoordinator {
  private readonly results: RoutedTool[];
  constructor(results: RoutedTool[]) {
    super({}, { enabled: false });
    this.results = results;
  }
  override async routeIntent(_q: string, _c: ToolCandidate[]): Promise<RoutedTool[]> {
    return this.results;
  }
}

/** Minimal in-process backend for exact-fixture tests. */
class InMemBackend implements Backend {
  private readonly store = new Map<string, ToolEntry[]>();

  set(serverId: string, tools: ToolEntry[]): void { this.store.set(serverId, tools); }

  registerServer(_c: ServerConfig): void {}
  isRegistered(id: string): boolean { return this.store.has(id); }
  getStatus(id: string): BackendStatus {
    return { connected: true, toolCount: this.store.get(id)?.length ?? 0, toolCacheAge: 0 };
  }
  async listTools(id: string): Promise<ToolEntry[]> { return this.store.get(id) ?? []; }
  async callTool(): Promise<ToolCallResult> { return { content: [{ type: 'text', text: 'ok' }] }; }
  async listResources(): Promise<{ resources: ResourceEntry[]; templates: ResourceTemplateEntry[] }> {
    return { resources: [], templates: [] };
  }
  async readResource(_s: string, uri: string): Promise<{ contents: Array<{ uri: string; text?: string }> }> {
    return { contents: [{ uri, text: 'fixture' }] };
  }
  async listPrompts(): Promise<PromptEntry[]> { return []; }
  async getPrompt(_s: string, name: string): Promise<{ messages: Array<{ role: 'user' | 'assistant'; content: ContentItem }> }> {
    return { messages: [{ role: 'user', content: { type: 'text', text: name } }] };
  }
  async shutdown(): Promise<void> {}
}

function cfg(id: string, category: ServerConfig['category']): ServerConfig {
  return { id, name: id, type: 'remote', access: 'readwrite', category, endpoint: `https://${id}.invalid/mcp` };
}

// ── 1. augmentation loop `added >= 5` break ──────────────────────────────────

test('cast: brain route + focus active + 6 in-focus keyword tools → added >= 5 break fires, resolvedBy:keyword', async () => {
  // Brain picks 'brain_svc/brain_tool' (category 'code', NOT in-focus for 'exec' which covers ecosystem).
  // 6 ecosystem servers (svc0-5) all keyword-match "execute".
  // Augmentation loop: adds svc0-4 (added reaches 5), fires break before svc5.
  // Focus bias (+0.5) pushes the 5 augmented ecosystem tools above the brain pick.
  // Winner is from the keyword-augmented set → resolvedBy: 'keyword'.
  const b = new InMemBackend();

  // Brain's server (code category — not in exec focus)
  b.set('brain_svc', [{ name: 'brain_tool', description: 'execute and run tasks', inputSchema: {} }]);

  // 6 in-focus ecosystem servers — all match "execute" via description
  for (let i = 0; i <= 5; i++) {
    b.set(`svc${i}`, [{ name: 'do_job', description: 'execute background operations', inputSchema: {} }]);
  }

  const configs: ServerConfig[] = [
    cfg('brain_svc', 'code'),
    ...Array.from({ length: 6 }, (_, i) => cfg(`svc${i}`, 'ecosystem')),
  ];

  const brainResults: RoutedTool[] = [{
    tool: { namespacedName: 'brain_svc/brain_tool', description: 'execute and run tasks', category: 'code' },
    confidence: 0.95,
    reason: 'stub',
  }];

  const dlqPath = dlq();
  const coordinator = new StubCoordinator(brainResults);
  const agg = new Aggregator(configs, {
    backendFactory: () => b,
    embedEnabled: false,
    coordinator,
    ledgerDlqPath: dlqPath,
    suggestionsCatalog: {},
    focus: 'exec',
    focusProfiles: {
      profiles: {
        exec: { description: 'Execution focus', categories: ['ecosystem'], servers: [], boost: 0.5 },
      },
    },
  });

  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'execute', confirm: true });
    assert.equal(r.isError, undefined, 'cast must not error');
    const cast = JSON.parse(r.content[0]?.text ?? '{}') as {
      cast: string;
      resolvedBy: string;
      focus: string;
      resolved: { tool: string; score: number };
      alternatives: Array<{ tool: string }>;
    };

    assert.equal(cast.cast, 'plan', `expected plan, got: ${cast.cast}`);
    assert.equal(cast.focus, 'exec', 'active focus must be reported');
    // An ecosystem augmented tool wins (focus bias +0.5 lifts score above brain pick)
    assert.equal(cast.resolvedBy, 'keyword', 'augmented in-focus tool must win → resolvedBy:keyword');
    // The brain's code-category tool is pushed below augmented ecosystem tools
    assert.notEqual(cast.resolved.tool, 'brain_svc/brain_tool', 'brain pick must not win when focus bias elevates augmented tools');
  } finally {
    await agg.shutdown();
    rmSync(dlqPath, { force: true });
  }
});

// ── 2. ledger duplicate tool silently skipped in existing batch ──────────────

test('ledger: duplicate tool in tool_call_batch silently skipped — count stays at 2, not 3', () => {
  // Record: neon/run_sql → github/list_repos (upgrades to batch, count=2)
  // Record: neon/run_sql again → same tool already in batch, !tools.includes = false → skipped
  // Assert: count stays 2 (not 3), tools array still has 2 entries, batch not duplicated.
  const dlqPath = dlq();
  const client = new LedgerClient(dlqPath);

  try {
    client.record('sess-dedup', 'tool_call', { tool: 'neon/run_sql' });
    client.record('sess-dedup', 'tool_call', { tool: 'github/list_repos' }); // upgrades to batch
    client.record('sess-dedup', 'tool_call', { tool: 'neon/run_sql' });      // duplicate → skipped

    const stats = client.getStats();
    assert.equal(stats.buffered, 1, 'three rapid tool_calls: duplicate skipped → still 1 batch entry');

    const buf = (client as unknown as {
      buffer: Array<{ event_type: string; metadata: { tools: string[]; count: number } }>;
    }).buffer;

    assert.equal(buf[0].event_type, 'tool_call_batch', 'entry must be a batch');
    assert.equal(buf[0].metadata.count, 2, 'count must remain 2 after duplicate is silently skipped');
    assert.deepEqual(
      buf[0].metadata.tools,
      ['neon/run_sql', 'github/list_repos'],
      'tools array must not grow when duplicate is appended',
    );
  } finally {
    rmSync(dlqPath, { force: true });
  }
});

// ── 3. focus active + no catalog entry → focusSuggestions null → no suggestions field ──

test('cast:plan with focus active but no catalog entry → getSuggestionsForFocus returns null → suggestions absent', async () => {
  // Focus 'ops' is active and the focus profile is valid, but suggestionsCatalog = {}
  // (no 'ops' entry). getSuggestionsForFocus('ops', {}) returns null.
  // Cast plan must include `focus: 'ops'` but NOT `suggestions`.
  const b = new InMemBackend();
  b.set('opsvc', [{ name: 'deploy', description: 'deploy application to infrastructure', inputSchema: {} }]);

  const dlqPath = dlq();
  const agg = new Aggregator([cfg('opsvc', 'ecosystem')], {
    backendFactory: () => b,
    embedEnabled: false,
    ledgerDlqPath: dlqPath,
    focus: 'ops',
    focusProfiles: {
      profiles: {
        ops: { description: 'Operations and deployment', categories: ['ecosystem'], servers: [], boost: 0.5 },
      },
    },
    suggestionsCatalog: {},  // no entry for 'ops' → getSuggestionsForFocus returns null
  });

  try {
    const r = await agg.callTool('ch1tty/cast', { intent: 'deploy', confirm: true });
    assert.equal(r.isError, undefined, 'cast must not error');
    const cast = JSON.parse(r.content[0]?.text ?? '{}') as {
      cast: string;
      focus?: string;
      suggestions?: unknown;
      resolved: { tool: string };
    };

    assert.equal(cast.cast, 'plan', `expected plan, got: ${cast.cast}`);
    assert.equal(cast.focus, 'ops', 'focus name must appear in plan even without catalog entry');
    assert.equal(cast.suggestions, undefined, 'suggestions must be absent when catalog has no entry for active focus');
    assert.equal(cast.resolved.tool, 'opsvc/deploy', 'correct tool resolved');
  } finally {
    await agg.shutdown();
    rmSync(dlqPath, { force: true });
  }
});

// ── 4. gpt-actions POST with empty body → readBody `if (!raw) return {}` ────

test('gpt-actions: POST with empty body → readBody if(!raw) fires → {} → mapArgs({}) → 200', async () => {
  // When fetch sends a POST with no body at all, the Node.js server receives
  // zero bytes. `readBody` concatenates chunks into raw="". `!raw` is true →
  // returns {} without reaching JSON.parse. mapArgs({}) still produces valid
  // (if semantically empty) args and the gpt-actions call returns HTTP 200.
  const dlqPath = dlq();
  const agg = new Aggregator([], { ledgerDlqPath: dlqPath, embedEnabled: false });
  const server = new HttpMcpServer(agg, { port: 0, bindAddress: '127.0.0.1' });
  await server.start();
  const baseUrl = `http://127.0.0.1:${server.getPort()}`;

  try {
    // No `body` property in fetch options → zero-byte POST body
    const res = await fetch(`${baseUrl}/gpt-actions/session/get`, {
      method: 'POST',
    });

    assert.equal(res.status, 200, 'empty-body POST must return 200 — gpt-actions has no required-field guard');
    const body = await res.json() as { ok: boolean; result: unknown; chitty_id: string | null };
    assert.equal(body.ok, true, 'ok:true — gpt-actions facade handles empty body gracefully');
    assert.equal(body.chitty_id, null, 'chitty_id is null: conversation_id absent from empty body');
  } finally {
    await server.stop();
    await agg.shutdown();
    rmSync(dlqPath, { force: true });
  }
});
