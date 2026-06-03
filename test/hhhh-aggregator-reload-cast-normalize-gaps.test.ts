/**
 * HHHH: close remaining aggregator.ts branch gaps
 *
 * 1. handleReload catch path (aggregator.ts:706) — configPath points to
 *    invalid JSON → loadConfigFromPath throws → catch returns isError.
 *
 * 2. normalizeToolName empty-string guard (aggregator.ts:1072) — callTool('')
 *    passes '' to normalizeToolName; `if (!raw) return raw` true branch fires.
 *
 * 3. handleCast short-word intent (aggregator.ts:823, 825, 837) — when the
 *    intent contains only words ≤2 chars, terms = [] after the length filter.
 *    The prompt/resource scoring map callbacks still execute (lines 823, 835)
 *    and the ternary `terms.length > 0 ? … : 0` hits its false branch (825, 837).
 *    The `description || ''` short-circuit on lines 823/835 is also exercised by
 *    supplying one entry with a description and one without.
 *
 * 4. handleCast non-string intent (aggregator.ts:716) — `typeof args.intent`
 *    is not 'string' → intent falls back to '' → empty-intent early return.
 */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { Aggregator } from '../src/aggregator.js';

// mkdtempSync is atomic — no TOCTOU race; all temp artifacts live inside it
const TEMP_DIR = mkdtempSync(join(tmpdir(), 'ch1tty-hhhh-'));
const DLQ = join(TEMP_DIR, 'ledger.dlq.jsonl');
const BAD_CONFIG = join(TEMP_DIR, 'bad-cfg.json');

after(() => { rmSync(TEMP_DIR, { recursive: true, force: true }); });

// ── 1. handleReload catch path (aggregator.ts:706) ─────────────────────────

test('ch1tty/reload catch: invalid config JSON → isError + "Reload failed"', async () => {
  writeFileSync(BAD_CONFIG, '{not valid json!!!}', 'utf-8');
  const agg = new Aggregator([], { configPath: BAD_CONFIG, ledgerDlqPath: DLQ });
  const result = await agg.callTool('ch1tty/reload');
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Reload failed/);
});

// ── 2. normalizeToolName empty-string guard (aggregator.ts:1072) ────────────

test('callTool("") → normalizeToolName empty-string branch → unknown-tool error', async () => {
  const agg = new Aggregator([], { ledgerDlqPath: DLQ });
  const result = await agg.callTool('');
  assert.equal(result.isError, true);
  // Empty string normalizes to '' which is not a known meta-tool
  assert.ok(result.content[0].text.length > 0, 'expected an error message');
});

// ── 3. handleCast short-word intent (aggregator.ts:823, 825, 837) ─────────

// Patch listAllPrompts + listAllResources to return non-empty lists so the
// scoring map callbacks execute. Intent "go" (length 2) is filtered by
// `t.length > 2` → terms = [] → ternary false branch (score = 0).
// Two entries per surface: one with a `description` (|| '' false branch)
// and one without (|| '' true branch).
test('handleCast: short-word intent → terms empty → prompt/resource map callbacks hit score=0 branch', async () => {
  const agg = new Aggregator([], { ledgerDlqPath: DLQ });

  agg.listAllPrompts = async () => ({
    prompts: [
      { name: 'fake/with-desc', description: 'a fake prompt for testing' },
      { name: 'fake/no-desc' },
    ],
  });

  agg.listAllResources = async () => ({
    resources: [
      { uri: 'fake://with-desc', name: 'Fake With Desc', description: 'a fake resource' },
      { uri: 'fake://no-desc', name: 'Fake No Desc' },
    ],
  });

  // "go" → all words are ≤2 chars → terms = [] after filter
  const result = await agg.callTool('ch1tty/cast', { intent: 'go' });
  // With terms=[] all scores are 0, everything filtered at > 0.1 → no_match
  assert.ok(!result.isError, `expected no top-level error, got: ${result.content[0].text}`);
  const data = JSON.parse(result.content[0].text);
  assert.equal(data.cast, 'no_match', `expected cast:no_match, got: ${JSON.stringify(data)}`);
});

// ── 4. handleCast non-string intent (aggregator.ts:716) ───────────────────

test('handleCast: non-string intent → falls back to "" → empty-intent isError', async () => {
  const agg = new Aggregator([], { ledgerDlqPath: DLQ });
  // Pass a number for intent — typeof 42 !== 'string' → intent = '' (false branch of line 716)
  const result = await agg.callTool('ch1tty/cast', { intent: 42 });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Missing required "intent"/);
});
