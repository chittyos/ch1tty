/**
 * DY — ch1tty meta-tool parameter schema drift guard.
 *
 * Guards the CLAUDE.md architectural invariant: "Public MCP surface stays
 * fixed at exactly 5 tools." Tests exact parameter names and required-field
 * lists for all 5 meta-tools. Runs at unit speed (no subprocess, no
 * network) via Aggregator.listAllTools().
 *
 * Coverage:
 *   - Exactly 5 meta-tools in tools list
 *   - Tool names match canonical set exactly (no 6th tool, no renames)
 *   - ch1tty/search: 10 params, no required fields
 *   - ch1tty/execute: 5 params, required=['tool']
 *   - ch1tty/status: 1 param, no required fields
 *   - ch1tty/reload: no properties (empty inputSchema)
 *   - ch1tty/cast: 11 params, required=['intent']
 */

import test, { describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Aggregator } from '../src/aggregator.js';

// Canonical meta-tool names — sorted; update ONLY when intentionally changing
// the public surface (and CLAUDE.md guardrail must be amended first).
const EXPECTED_NAMES = [
  'ch1tty/cast',
  'ch1tty/execute',
  'ch1tty/reload',
  'ch1tty/search',
  'ch1tty/status',
];

// Exact parameter key sets — sorted alphabetically.
const SEARCH_PARAMS  = ['category', 'explain', 'focus', 'inFocusOnly', 'limit', 'minScore', 'offset', 'query', 'server', 'sessionId'];
const EXECUTE_PARAMS = ['args', 'dryRun', 'sessionId', 'timeout', 'tool'];
const STATUS_PARAMS  = ['short'];
const CAST_PARAMS    = ['args', 'chain', 'confirm', 'dryRun', 'explain', 'focus', 'intent', 'scope', 'sessionId', 'timeout', 'verbosity'];

type Tool = {
  name: string;
  description?: string;
  inputSchema: { type: 'object'; properties?: Record<string, object>; required?: string[] };
};

describe('DY — meta-tool parameter schema drift guard', () => {
  let tools: Tool[];

  before(async () => {
    const agg = new Aggregator([], {
      embedEnabled: false,
      ledgerDlqPath: join(tmpdir(), `ch1tty-dy-drift-${Date.now()}.jsonl`),
      // Inject empty catalogs to avoid disk reads of live files changing test expectations
      focusProfiles: { profiles: {} },
      suggestionsCatalog: {},
    });
    const result = await agg.listAllTools();
    tools = result.tools as Tool[];
  });

  // ── Count ──────────────────────────────────────────────────────────────────

  test('DY-01 exactly 5 meta-tools in tools list', () => {
    assert.equal(tools.length, 5, `expected 5 meta-tools, got ${tools.length}: ${tools.map((t) => t.name).join(', ')}`);
  });

  // ── Names ─────────────────────────────────────────────────────────────────

  test('DY-02 meta-tool names match canonical set exactly', () => {
    const actual = [...tools.map((t) => t.name)].sort();
    assert.deepEqual(actual, EXPECTED_NAMES, 'tool name roster has drifted — update CLAUDE.md guardrail first');
  });

  // ── ch1tty/search ─────────────────────────────────────────────────────────

  test('DY-03 ch1tty/search has exactly 10 parameters', () => {
    const tool = tools.find((t) => t.name === 'ch1tty/search');
    assert.ok(tool, 'ch1tty/search must be present');
    const props = Object.keys(tool.inputSchema.properties ?? {}).sort();
    assert.deepEqual(props, SEARCH_PARAMS, 'ch1tty/search parameter set has drifted');
  });

  test('DY-04 ch1tty/search has no required fields', () => {
    const tool = tools.find((t) => t.name === 'ch1tty/search')!;
    const req = tool.inputSchema.required ?? [];
    assert.deepEqual([...req].sort(), [], 'ch1tty/search must have no required fields');
  });

  // ── ch1tty/execute ────────────────────────────────────────────────────────

  test('DY-05 ch1tty/execute has exactly 5 parameters', () => {
    const tool = tools.find((t) => t.name === 'ch1tty/execute');
    assert.ok(tool, 'ch1tty/execute must be present');
    const props = Object.keys(tool.inputSchema.properties ?? {}).sort();
    assert.deepEqual(props, EXECUTE_PARAMS, 'ch1tty/execute parameter set has drifted');
  });

  test('DY-06 ch1tty/execute required=[tool]', () => {
    const tool = tools.find((t) => t.name === 'ch1tty/execute')!;
    assert.deepEqual(tool.inputSchema.required ?? [], ['tool'], 'ch1tty/execute required fields have drifted');
  });

  // ── ch1tty/status ─────────────────────────────────────────────────────────

  test('DY-07 ch1tty/status has exactly 1 parameter', () => {
    const tool = tools.find((t) => t.name === 'ch1tty/status');
    assert.ok(tool, 'ch1tty/status must be present');
    const props = Object.keys(tool.inputSchema.properties ?? {}).sort();
    assert.deepEqual(props, STATUS_PARAMS, 'ch1tty/status parameter set has drifted');
  });

  test('DY-08 ch1tty/status has no required fields', () => {
    const tool = tools.find((t) => t.name === 'ch1tty/status')!;
    const req = tool.inputSchema.required ?? [];
    assert.deepEqual([...req].sort(), [], 'ch1tty/status must have no required fields');
  });

  // ── ch1tty/reload ─────────────────────────────────────────────────────────

  test('DY-09 ch1tty/reload has no properties defined (empty schema)', () => {
    const tool = tools.find((t) => t.name === 'ch1tty/reload');
    assert.ok(tool, 'ch1tty/reload must be present');
    const props = Object.keys(tool.inputSchema.properties ?? {});
    assert.equal(props.length, 0, `ch1tty/reload must have no properties, found: ${props.join(', ')}`);
  });

  // ── ch1tty/cast ───────────────────────────────────────────────────────────

  test('DY-10 ch1tty/cast has exactly 11 parameters', () => {
    const tool = tools.find((t) => t.name === 'ch1tty/cast');
    assert.ok(tool, 'ch1tty/cast must be present');
    const props = Object.keys(tool.inputSchema.properties ?? {}).sort();
    assert.deepEqual(props, CAST_PARAMS, 'ch1tty/cast parameter set has drifted');
  });

  test('DY-11 ch1tty/cast required=[intent]', () => {
    const tool = tools.find((t) => t.name === 'ch1tty/cast')!;
    assert.deepEqual(tool.inputSchema.required ?? [], ['intent'], 'ch1tty/cast required fields have drifted');
  });
});
