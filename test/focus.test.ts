import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  applyFocusBias,
  isInFocus,
  loadFocusProfilesFromPath,
  resolveFocus,
  validateFocusProfiles,
} from '../src/focus.js';
import type { FocusableTool } from '../src/focus.js';
import { Aggregator } from '../src/aggregator.js';
import type { ServerCategory, ServerConfig } from '../src/types.js';

// ── Schema validation ───────────────────────────────────────────

test('validateFocusProfiles accepts a valid profile set', () => {
  const profiles = validateFocusProfiles({
    profiles: {
      finance: { description: 'money', categories: ['ecosystem'], servers: ['stripe'], boost: 0.4 },
      design: { servers: ['playwright'] },
    },
  });
  assert.equal(profiles.profiles.finance.boost, 0.4);
  assert.deepEqual(profiles.profiles.finance.categories, ['ecosystem']);
  // Default boost applied when omitted
  assert.equal(profiles.profiles.design.boost, 0.5);
  // categories defaults to [] when omitted
  assert.deepEqual(profiles.profiles.design.categories, []);
});

test('validateFocusProfiles rejects unknown fields', () => {
  assert.throws(
    () => validateFocusProfiles({ profiles: { x: { servers: ['a'], wat: true } } }),
    /profiles\.x\.wat is not a recognized field/,
  );
});

test('validateFocusProfiles rejects invalid category values', () => {
  assert.throws(
    () => validateFocusProfiles({ profiles: { x: { categories: ['nope'] } } }),
    /invalid category "nope"/,
  );
});

test('validateFocusProfiles requires at least one category or server', () => {
  assert.throws(
    () => validateFocusProfiles({ profiles: { empty: { description: 'nothing' } } }),
    /must declare at least one category or server/,
  );
});

test('validateFocusProfiles rejects negative boost', () => {
  assert.throws(
    () => validateFocusProfiles({ profiles: { x: { servers: ['a'], boost: -1 } } }),
    /boost must be a non-negative number/,
  );
});

test('loadFocusProfilesFromPath returns empty set for a missing file (focus is opt-in)', () => {
  const profiles = loadFocusProfilesFromPath(join(tmpdir(), 'ch1tty-does-not-exist-focus.json'));
  assert.deepEqual(profiles.profiles, {});
});

test('loadFocusProfilesFromPath throws on a present-but-malformed file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ch1tty-focus-test-'));
  const filePath = join(dir, 'focus-profiles.json');
  try {
    writeFileSync(filePath, '{ not json', 'utf8');
    assert.throws(() => loadFocusProfilesFromPath(filePath), /Invalid JSON in focus profiles/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repo focus-profiles.json loads and defines finance/governance/design/code/communication', () => {
  const profiles = loadFocusProfilesFromPath(join(import.meta.dirname, '..', 'focus-profiles.json'));
  assert.ok(profiles.profiles.finance);
  assert.ok(profiles.profiles.governance);
  assert.ok(profiles.profiles.design);
  assert.ok(profiles.profiles.code, 'code focus profile present');
  assert.ok(profiles.profiles.communication, 'communication focus profile present');
  // Real server ids from servers.json
  assert.ok(profiles.profiles.finance.servers.includes('stripe'));
  assert.ok(profiles.profiles.design.servers.includes('playwright'));
  // apps/*-mcp backends included in appropriate profiles
  assert.ok(profiles.profiles.finance.servers.includes('ledger'), 'finance includes ledger');
  assert.ok(profiles.profiles.governance.servers.includes('session'), 'governance includes session');
  assert.ok(profiles.profiles.governance.servers.includes('ledger'), 'governance includes ledger');
  assert.ok(profiles.profiles.governance.servers.includes('chittyevidence'), 'governance pre-wires chittyevidence');
  // code profile contents
  assert.ok(profiles.profiles.code.categories.includes('code'), 'code profile covers code category');
  assert.ok(profiles.profiles.code.servers.includes('context7'), 'code profile includes context7');
  assert.ok(profiles.profiles.code.servers.includes('neon'), 'code profile includes neon');
  assert.ok(profiles.profiles.code.servers.includes('cloudflare'), 'code profile includes cloudflare');
  // communication profile contents
  assert.ok(profiles.profiles.communication.categories.includes('communication'), 'communication profile covers communication category');
  assert.ok(profiles.profiles.communication.servers.includes('notion'), 'communication profile includes notion');
  assert.ok(profiles.profiles.communication.servers.includes('chittymac'), 'communication profile includes chittymac');
  assert.ok(profiles.profiles.communication.servers.includes('imessage'), 'communication profile includes imessage');
});

// ── resolveFocus (soft / lens-not-gate) ─────────────────────────

test('resolveFocus returns undefined for unknown name without throwing', () => {
  const profiles = validateFocusProfiles({ profiles: { finance: { servers: ['stripe'] } } });
  assert.equal(resolveFocus(profiles, 'made-up'), undefined);
  assert.equal(resolveFocus(profiles, undefined), undefined);
  assert.ok(resolveFocus(profiles, 'finance'));
});

// ── applyFocusBias (pure ranking) ───────────────────────────────

function tool(serverId: string, category: ServerCategory, score: number) {
  return { serverId, category, score };
}

test('applyFocusBias ranks in-focus tools above out-of-focus for equal base score', () => {
  const profiles = validateFocusProfiles({
    profiles: { finance: { categories: ['ecosystem'], servers: ['stripe'], boost: 0.5 } },
  });
  const finance = profiles.profiles.finance;

  const scored = [
    tool('github', 'code', 0.5),        // out of focus
    tool('stripe', 'ecosystem', 0.5),   // in focus (server + category)
    tool('playwright', 'desktop', 0.5), // out of focus
    tool('neon', 'ecosystem', 0.5),     // in focus (category)
  ];

  const ranked = applyFocusBias(finance, scored);

  // In-focus tools come first
  assert.ok(isInFocus(finance, ranked[0]));
  assert.ok(isInFocus(finance, ranked[1]));
  // Out-of-focus tools are still present (lens, not gate)
  assert.equal(ranked.length, 4);
  assert.ok(ranked.some((t) => t.serverId === 'github'));
  assert.ok(ranked.some((t) => t.serverId === 'playwright'));
});

test('applyFocusBias does not erase a strong out-of-focus match', () => {
  const profiles = validateFocusProfiles({
    profiles: { finance: { categories: ['ecosystem'], boost: 0.5 } },
  });
  const finance = profiles.profiles.finance;

  // Strong out-of-focus (1.0) still beats a weak in-focus (0.1 + 0.5 = 0.6)
  const ranked = applyFocusBias(finance, [
    tool('weak-eco', 'ecosystem', 0.1),
    tool('strong-code', 'code', 1.0),
  ]);
  assert.equal(ranked[0].serverId, 'strong-code');
  assert.equal(ranked.length, 2);
});

// ── Aggregator integration ──────────────────────────────────────

// Use a nonexistent command so spawn fails with ENOENT immediately (< 1ms) rather
// than timing out waiting for the MCP connect handshake (30s). The focus tests
// only check server ordering and inFocus markers — they don't need real tool lists.
const aggConfig: ServerConfig[] = [
  { id: 'stripe', name: 'Stripe', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'ch1tty-test-no-such-server' },
  { id: 'github', name: 'GitHub', type: 'local', access: 'readwrite', category: 'code', command: 'ch1tty-test-no-such-server' },
  { id: 'playwright', name: 'Playwright', type: 'local', access: 'readwrite', category: 'desktop', command: 'ch1tty-test-no-such-server' },
];

const testProfiles = validateFocusProfiles({
  profiles: {
    finance: { categories: ['ecosystem'], servers: ['stripe'], boost: 0.5 },
    design: { categories: ['desktop'], servers: ['playwright'], boost: 0.5 },
  },
});

test('status snapshot reports the active default focus', async () => {
  const agg = new Aggregator(aggConfig, { focus: 'finance', focusProfiles: testProfiles, embedEnabled: false });
  const result = await agg.callTool('ch1tty/status');
  const status = JSON.parse(result.content[0].text);
  assert.equal(status.focus.active, 'finance');
  assert.deepEqual(status.focus.categories, ['ecosystem']);
  assert.equal(status.focus.boost, 0.5);
  assert.deepEqual(status.availableFocusProfiles.sort(), ['design', 'finance']);
});

test('status focus is null when no default focus is set', async () => {
  const agg = new Aggregator(aggConfig, { focusProfiles: testProfiles, embedEnabled: false });
  const status = JSON.parse((await agg.callTool('ch1tty/status')).content[0].text);
  assert.equal(status.focus, null);
});

test('status focus is null for an unknown default focus (soft, no throw)', async () => {
  const agg = new Aggregator(aggConfig, { focus: 'bogus', focusProfiles: testProfiles, embedEnabled: false });
  const status = JSON.parse((await agg.callTool('ch1tty/status')).content[0].text);
  assert.equal(status.focus, null);
});

test('search server summary surfaces in-focus servers first and marks them', async () => {
  const agg = new Aggregator(aggConfig, { focus: 'finance', focusProfiles: testProfiles, embedEnabled: false });
  const data = JSON.parse((await agg.callTool('ch1tty/search', {})).content[0].text);
  assert.equal(data.focus, 'finance');
  // stripe (ecosystem, in focus) ranks ahead of github/playwright (out of focus)
  assert.equal(data.servers[0].server, 'stripe');
  assert.equal(data.servers[0].inFocus, true);
  // out-of-focus servers still listed (lens, not gate)
  assert.equal(data.servers.length, 3);
  assert.ok(data.servers.some((s: { server: string }) => s.server === 'github'));
});

test('per-call focus param overrides the env/default focus', async () => {
  // Default focus is finance; per-call design must win.
  const agg = new Aggregator(aggConfig, { focus: 'finance', focusProfiles: testProfiles, embedEnabled: false });
  const data = JSON.parse((await agg.callTool('ch1tty/search', { focus: 'design' })).content[0].text);
  assert.equal(data.focus, 'design');
  // playwright (desktop) now in focus and first
  assert.equal(data.servers[0].server, 'playwright');
  assert.equal(data.servers[0].inFocus, true);
});

test('per-call focus "none" overrides the default to no focus', async () => {
  const agg = new Aggregator(aggConfig, { focus: 'finance', focusProfiles: testProfiles, embedEnabled: false });
  const data = JSON.parse((await agg.callTool('ch1tty/search', { focus: 'none' })).content[0].text);
  assert.equal(data.focus, undefined);
  // No inFocus markers when focus is explicitly off
  assert.ok(data.servers.every((s: { inFocus?: boolean }) => s.inFocus === undefined));
});
