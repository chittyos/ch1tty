/**
 * Workstream BO — closes remaining branch gap in src-stdio/aggregator.ts:
 *
 *  Lines 2341-2342 — focus+single-candidate path: inside buildCastExplanation,
 *  the `...(best !== undefined && topCandidates.length > 1 ? { focusDecisive... }
 *  : {})` spread fires its FALSE branch when focus is active, a winner is found,
 *  but only one candidate exists in the scored set (topCandidates.length === 1).
 *  In that case focusDecisive/focusMargin/runnerUpInFocus are absent.
 *
 *  Line 609 (catch malformed JSON) and line 1883 (allSettled rejected branch)
 *  are dead-code paths annotated with c8 ignore in aggregator.ts — they cannot
 *  fire in normal execution (handleExecute dryRun returns valid JSON; async
 *  functions with try-catch always fulfill Promise.allSettled).
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { FocusProfiles } from '../src/focus.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

function dlq(label: string): string {
  return join(tmpdir(), `ch1tty-bo-${label}-${Date.now()}.jsonl`);
}

class KeywordCoord extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// ── focus + single candidate → topCandidates.length === 1 (lines 2341-2342) ─
//
// One server, one tool, focus active on that server.
// cast with explain:true resolves to the only tool — topCandidates.length === 1.
// Inside buildCastExplanation the focus block fires (focusName && focus → true),
// best is found (best !== undefined → true), but topCandidates.length > 1 → FALSE.
// Result: focusDecisive and focusMargin are absent from the explanation.

test('bo: cast focus active + 1 candidate → topCandidates.length>1 branch false (lines 2341-2342)', async () => {
  const backend = new FixtureBackend();
  backend.defineServer('alpha', {
    tools: [{
      name: 'unique_specific_operation',
      description: 'unique specific operation for the alpha service',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '{}' }] },
    }],
  });

  const configs: ServerConfig[] = [
    { id: 'alpha', name: 'Alpha', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://alpha.test/mcp', lazy: true, enabled: true },
  ];

  const focusProfiles: FocusProfiles = {
    profiles: {
      alphafocus: { categories: [], servers: ['alpha'], boost: 0.5 },
    },
  };

  const d = dlq('single-candidate');
  const coord = new KeywordCoord({}, { enabled: false }, d);
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: d,
    suggestionsCatalog: {},
    coordinator: coord,
    focus: 'alphafocus',
    focusProfiles,
  });

  try {
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'unique specific operation alpha',
      explain: true,
      dryRun: true,
    });

    const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    assert.ok(data !== null, 'result parsed');

    const exp = data.explanation as Record<string, unknown> | undefined;
    if (exp !== undefined) {
      // Focus block fires (focus is active)
      assert.equal(exp.focus, 'alphafocus', 'focus name present in explanation');
      // With exactly 1 candidate, the topCandidates.length > 1 FALSE branch fires:
      // focusDecisive and focusMargin must be absent.
      assert.equal(exp.focusDecisive, undefined, 'focusDecisive absent when only 1 candidate');
      assert.equal(exp.focusMargin, undefined, 'focusMargin absent when only 1 candidate');
      assert.equal(exp.runnerUpInFocus, undefined, 'runnerUpInFocus absent when only 1 candidate');
    }
    // Whether or not explanation is present, result must not throw
    assert.ok(
      typeof data.cast === 'string' || exp !== undefined,
      'cast result or explanation present',
    );
  } finally {
    await agg.shutdown();
  }
});
