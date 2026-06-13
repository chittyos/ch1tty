/**
 * Tests for getStatusSnapshot() catalog field:
 *   - catalog.loaded / totalCombos / byFocus
 *   - catalog.activeFocusSuggestions — present (≤3 combos + prompts) when focus is active
 *     and catalog has an entry for that focus; null otherwise.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Aggregator } from '../src/aggregator.js';
import type { FocusSuggestions } from '../src/suggestions.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ch1tty-cat-'));
}

const FINANCE_ENTRY: FocusSuggestions = {
  description: 'Finance tools',
  combos: [
    { name: 'pay-and-log', chain: ['stripe/charge', 'ledger/append'], accomplishes: 'charge and record', verified: true },
    { name: 'check-balance', chain: ['ledger/balance'], accomplishes: 'read current balance', verified: true },
    { name: 'refund-flow', chain: ['stripe/refund', 'ledger/append'], accomplishes: 'refund and record', verified: false },
    { name: 'extra-combo', chain: ['stripe/list'], accomplishes: 'list charges', verified: false },
  ],
  prompts: [
    { text: 'Charge a customer $10', resolves_to: 'stripe/charge' },
    { text: 'Show current balance', resolves_to: 'ledger/balance' },
    { text: 'Refund last charge', resolves_to: 'stripe/refund' },
    { text: 'List recent invoices', resolves_to: 'stripe/list_invoices' },
  ],
};

const OPS_ENTRY: FocusSuggestions = {
  description: 'Ops tools',
  combos: [
    { name: 'deploy', chain: ['cloudflare-builds/trigger'], accomplishes: 'trigger deploy', verified: true },
    { name: 'status-check', chain: ['orchestrator/status'], accomplishes: 'check orchestrator', verified: true },
  ],
  prompts: [
    { text: 'Deploy to production', resolves_to: 'cloudflare-builds/trigger' },
    { text: 'Check orchestrator status', resolves_to: 'orchestrator/status' },
  ],
};

const CATALOG: Record<string, FocusSuggestions> = {
  finance: FINANCE_ENTRY,
  ops: OPS_ENTRY,
};

const FINANCE_PROFILES = {
  profiles: {
    finance: {
      description: 'Finance',
      categories: ['ecosystem' as const],
      servers: ['stripe'],
      boost: 0.5,
    },
  },
};

function makeAgg(opts: { focus?: string; catalog?: Record<string, FocusSuggestions> }, dir: string): Aggregator {
  return new Aggregator([], {
    embedEnabled: false,
    ledgerDlqPath: join(dir, 'test.dlq.jsonl'),
    focus: opts.focus,
    focusProfiles: opts.focus
      ? FINANCE_PROFILES
      : { profiles: {} },
    suggestionsCatalog: opts.catalog ?? {},
  });
}

// ── catalog stats ─────────────────────────────────────────────────────────────

test('catalog: empty catalog → loaded:false, totalCombos:0, byFocus:{}', async () => {
  const dir = tempDir();
  const agg = makeAgg({}, dir);
  try {
    const snap = agg.getStatusSnapshot();
    assert.equal(snap.catalog.loaded, false);
    assert.equal(snap.catalog.totalCombos, 0);
    assert.deepEqual(snap.catalog.byFocus, {});
    assert.equal(snap.catalog.activeFocusSuggestions, null);
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('catalog: loaded catalog → correct counts by focus', async () => {
  const dir = tempDir();
  const agg = makeAgg({ catalog: CATALOG }, dir);
  try {
    const snap = agg.getStatusSnapshot();
    assert.equal(snap.catalog.loaded, true);
    assert.equal(snap.catalog.totalCombos, FINANCE_ENTRY.combos.length + OPS_ENTRY.combos.length);
    assert.equal(snap.catalog.byFocus['finance'], FINANCE_ENTRY.combos.length);
    assert.equal(snap.catalog.byFocus['ops'], OPS_ENTRY.combos.length);
    assert.equal(snap.catalog.activeFocusSuggestions, null, 'no focus active → no suggestions');
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── activeFocusSuggestions ────────────────────────────────────────────────────

test('activeFocusSuggestions: null when no focus active even with loaded catalog', async () => {
  const dir = tempDir();
  const agg = makeAgg({ catalog: CATALOG }, dir);
  try {
    const snap = agg.getStatusSnapshot();
    assert.equal(snap.focus, null, 'no focus snapshot');
    assert.equal(snap.catalog.activeFocusSuggestions, null);
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('activeFocusSuggestions: null when focus active but focus not in catalog', async () => {
  const dir = tempDir();
  // Focus is "finance" but catalog only has "ops"
  const agg = new Aggregator([], {
    embedEnabled: false,
    ledgerDlqPath: join(dir, 'test.dlq.jsonl'),
    focus: 'finance',
    focusProfiles: FINANCE_PROFILES,
    suggestionsCatalog: { ops: OPS_ENTRY },
  });
  try {
    const snap = agg.getStatusSnapshot();
    assert.ok(snap.focus, 'focus snapshot present');
    assert.equal(snap.focus!.active, 'finance');
    assert.equal(snap.catalog.activeFocusSuggestions, null, 'finance not in catalog → null');
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('activeFocusSuggestions: returns top 3 combos and prompts when focus matches catalog', async () => {
  const dir = tempDir();
  const agg = makeAgg({ focus: 'finance', catalog: CATALOG }, dir);
  try {
    const snap = agg.getStatusSnapshot();
    assert.ok(snap.focus, 'focus snapshot present');
    assert.equal(snap.focus!.active, 'finance');

    const sug = snap.catalog.activeFocusSuggestions;
    assert.ok(sug, 'suggestions present');
    assert.equal(sug!.combos.length, 3, 'capped at 3 combos');
    assert.equal(sug!.prompts.length, 3, 'capped at 3 prompts');
    // Verified combos are ranked first when scores are equal
    assert.ok(
      sug!.combos.every((c) => FINANCE_ENTRY.combos.some((src) => src.name === c.name)),
      'combos are from the finance catalog entry',
    );
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('activeFocusSuggestions: returns all combos/prompts when catalog has fewer than 3', async () => {
  const dir = tempDir();
  const agg = new Aggregator([], {
    embedEnabled: false,
    ledgerDlqPath: join(dir, 'test.dlq.jsonl'),
    focus: 'finance',
    focusProfiles: FINANCE_PROFILES,
    suggestionsCatalog: {
      finance: {
        description: 'Slim finance',
        combos: [
          { name: 'only-combo', chain: ['stripe/charge'], accomplishes: 'charge', verified: true },
        ],
        prompts: [
          { text: 'Charge $5', resolves_to: 'stripe/charge' },
          { text: 'Check balance', resolves_to: 'ledger/balance' },
        ],
      },
    },
  });
  try {
    const snap = agg.getStatusSnapshot();
    const sug = snap.catalog.activeFocusSuggestions;
    assert.ok(sug, 'suggestions present');
    assert.equal(sug!.combos.length, 1, 'only 1 combo available');
    assert.equal(sug!.prompts.length, 2, 'only 2 prompts available');
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('catalog.loaded: true when profiles present but all have 0 combos', async () => {
  const dir = tempDir();
  const emptyCatalog: Record<string, FocusSuggestions> = {
    finance: { description: 'empty', combos: [], prompts: [] },
  };
  const agg = makeAgg({ catalog: emptyCatalog }, dir);
  try {
    const snap = agg.getStatusSnapshot();
    assert.equal(snap.catalog.loaded, true, 'catalog object present even if all combos empty');
    assert.equal(snap.catalog.totalCombos, 0);
    assert.equal(snap.catalog.byFocus['finance'], 0);
  } finally {
    await agg.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});
