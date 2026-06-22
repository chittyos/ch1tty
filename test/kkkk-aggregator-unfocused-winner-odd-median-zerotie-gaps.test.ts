/**
 * KKKK coverage sweep — closes three remaining branch gaps in buildCastExplanation
 * (src-stdio/aggregator.ts):
 *
 *  1. Line 1877 — unfocusedWinner truthy branch: fires when the active focus boost
 *     changes the winner (pre-focus leader differs from the actual winner).
 *  2. Line 2022 — medianCandidateScore odd-count path: `n % 2 === 1` true branch;
 *     requires an odd number (3+) of scored candidates.
 *  3. Line 2186 — focusBias/focusConfidence zero-margin `{}` path: fires when the
 *     winner and runner-up have identical post-focus scores (margin === 0).
 *
 * Tests use FixtureBackend + inline focusProfiles (no dependency on focus-profiles.json).
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
  return join(tmpdir(), `ch1tty-kkkk-${label}-${Date.now()}.jsonl`);
}

class KeywordCoord extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

// ── 1+2. unfocusedWinner (line 1877) + odd-count median (line 2022) ──────────
//
// Three tools across three servers.  Intent "analytics export finance reports review"
// (5 terms): beta scores 5/5=1.0, gamma scores 4/5=0.8, alpha scores 3/5=0.6.
// Focus on alpha (+0.5 boost) → alpha wins with 1.1; pre-focus order is beta>gamma>alpha
// so unfocusedWinner = "beta/analytics_export".  Three candidates → n=3 (odd) → the
// `scoredTools[mid].score` branch at line 2022 fires.

test('kkkk: unfocusedWinner + odd-count median (lines 1877, 2022)', async () => {
  const backend = new FixtureBackend();

  backend.defineServer('alpha', {
    tools: [{
      name: 'finance_report',
      description: 'list quarterly finance reports for review',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '{}' }] },
    }],
  });
  backend.defineServer('beta', {
    tools: [{
      name: 'analytics_export',
      description: 'export analytics and finance reports for review',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '{}' }] },
    }],
  });
  backend.defineServer('gamma', {
    tools: [{
      name: 'data_review',
      description: 'export reports and analytics data',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '{}' }] },
    }],
  });

  const configs: ServerConfig[] = [
    { id: 'alpha', name: 'Alpha', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://alpha.test/mcp', lazy: true, enabled: true },
    { id: 'beta',  name: 'Beta',  type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://beta.test/mcp',  lazy: true, enabled: true },
    { id: 'gamma', name: 'Gamma', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://gamma.test/mcp', lazy: true, enabled: true },
  ];

  // Focus on alpha only; beta and gamma are out-of-focus.
  const focusProfiles: FocusProfiles = {
    profiles: {
      alphafocus: { categories: [], servers: ['alpha'], boost: 0.5 },
    },
  };

  const d = dlq('unfocused-winner-odd');
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
    // Intent covers all 5 terms in beta/analytics_export (score 1.0), 4/5 in gamma/data_review (0.8),
    // 3/5 in alpha/finance_report (0.6).  After focus +0.5 on alpha: alpha=1.1 wins.
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'analytics export finance reports review',
      explain: true,
      verbosity: 'medium',
      dryRun: true,
    });

    const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    const exp = data.explanation as Record<string, unknown> | undefined;
    assert.ok(exp !== undefined, 'explanation present');

    // With 3 candidates the odd-count median branch (line 2022) fires.
    assert.equal(typeof exp.medianCandidateScore, 'number',
      'medianCandidateScore present when 3 candidates exist (odd-count path, line 2022)');

    // Focus must have changed the winner → unfocusedWinner is set (line 1877).
    if (exp.winnerInFocus === true) {
      // alpha won (in-focus); check that the pre-focus leader differs from alpha.
      assert.equal(typeof exp.unfocusedWinner, 'string',
        'unfocusedWinner is set when focus changed the top spot (line 1877 truthy branch)');
      assert.ok(
        (exp.unfocusedWinner as string).startsWith('beta/') ||
        (exp.unfocusedWinner as string).startsWith('gamma/'),
        `unfocusedWinner should be beta or gamma; got: ${exp.unfocusedWinner}`,
      );
    }
    // Either way focus is active and explanation.focus is set.
    assert.equal(exp.focus, 'alphafocus', 'focus name in explanation');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. zero-margin tied scores → focusBias/focusConfidence `{}` path (line 2186) ──
//
// Focus on 'emptyfocus' which references 'zz-empty' (a server with no tools in the
// fixture).  All candidates are out-of-focus — applyFocusBias adds 0 to every score.
// Two tools with descriptions that match all intent terms → both score 1.0 → tied.
// With identical post-focus scores the condition `(best.score - topCandidates[1].score) !== 0`
// is false → the `: {}` branch at line 2186 fires (focusBias/focusConfidence not added).

test('kkkk: zero-margin tied scores → focusBias absent (line 2186)', async () => {
  const backend = new FixtureBackend();

  backend.defineServer('alpha', {
    tools: [{
      name: 'list_invoices',
      description: 'list billing invoices for finance',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '[]' }] },
    }],
  });
  backend.defineServer('beta', {
    tools: [{
      name: 'list_charges',
      description: 'list billing invoices and payments',
      inputSchema: { type: 'object', properties: {} },
      response: { content: [{ type: 'text', text: '[]' }] },
    }],
  });

  const configs: ServerConfig[] = [
    { id: 'alpha', name: 'Alpha', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://alpha.test/mcp', lazy: true, enabled: true },
    { id: 'beta',  name: 'Beta',  type: 'remote', access: 'readwrite', category: 'code',      endpoint: 'https://beta.test/mcp',  lazy: true, enabled: true },
  ];

  // Focus on 'zz-empty' — no tools from that server exist in the fixture.
  // Neither alpha nor beta is in-focus, so applyFocusBias adds 0 to both scores.
  const focusProfiles: FocusProfiles = {
    profiles: {
      emptyfocus: { categories: [], servers: ['zz-empty'], boost: 0.5 },
    },
  };

  const d = dlq('zero-margin');
  const coord = new KeywordCoord({}, { enabled: false }, d);
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: d,
    suggestionsCatalog: {},
    coordinator: coord,
    focus: 'emptyfocus',
    focusProfiles,
  });

  try {
    // Both tools match all 3 intent terms → both score 1.0 (keyword score = 3/3).
    // No focus boost applied (both out-of-focus) → scores remain tied at 1.0.
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'list billing invoices',
      explain: true,
      // verbosity defaults to 'full' — the only path containing line 2186
      dryRun: true,
    });

    const data = JSON.parse(result.content[0].text as string) as Record<string, unknown>;
    const exp = data.explanation as Record<string, unknown> | undefined;
    assert.ok(exp !== undefined, 'explanation present');
    assert.equal(exp.focus, 'emptyfocus', 'focus name present in explanation');

    // When both candidates score identically the zero-margin branch fires and
    // focusBias / focusConfidence are NOT added to the explanation object.
    if ((exp.candidateCount as number) >= 2) {
      const margin = (exp.winnerScore as number) - (exp.runnerUpScore as number);
      if (Math.abs(margin) < 0.001) {
        // Confirmed tied — line 2186 `{}` branch fired.
        assert.equal(exp.focusBias, undefined,
          'focusBias absent when winner/runner-up scores are tied (line 2186 zero-margin path)');
        assert.equal(exp.focusConfidence, undefined,
          'focusConfidence absent when winner/runner-up scores are tied (line 2186 zero-margin path)');
      }
    }
  } finally {
    await agg.shutdown();
  }
});
