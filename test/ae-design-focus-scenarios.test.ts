/**
 * Workstream W — design focus profile scenarios.
 *
 * Validates the design focus profile:
 *  - playwright/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves UI/browser automation intents to playwright/ tools
 *  - out-of-focus tools remain reachable when design focus is active
 *  - multi-step browser workflow executes correctly via fixture backend
 *
 * Note: design profile targets category 'desktop' + servers browser-rendering, playwright, cowork.
 * Only playwright is present in the fixture; browser-rendering and cowork are enabled:false in
 * servers.json, so this test validates the fixture-present server (playwright) is boosted.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const DESIGN_FOCUS_PROFILES = {
  profiles: {
    design: {
      description: 'UI design and browser automation — screenshot, navigate, fill forms, extract page content.',
      categories: ['desktop' as const],
      servers: ['playwright', 'browser-rendering'],
      boost: 0.5,
    },
    code: {
      description: 'Software development',
      categories: ['code' as const],
      servers: ['github', 'neon'],
      boost: 0.5,
    },
  },
};

const FIXTURE_CONFIGS: ServerConfig[] = [
  { id: 'playwright', name: 'Playwright', type: 'local', access: 'readwrite', category: 'desktop', command: 'node', args: ['./playwright'] },
  { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.github' },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
];

type SearchResult = { tools?: Array<{ tool: string; score?: number; inFocus?: boolean }>; focus?: string };
type CastResult = Record<string, unknown>;

function parseSearch(result: { content: Array<{ type: string; text?: string }> }): SearchResult {
  return JSON.parse(result.content[0]?.text ?? '{}') as SearchResult;
}

function parseCast(result: { content: Array<{ type: string; text?: string }> }): CastResult {
  return JSON.parse(result.content[0]?.text ?? '{}') as CastResult;
}

function buildAggregator(focus?: string): { aggregator: Aggregator; fixture: FixtureBackend } {
  const fixture = new FixtureBackend();
  for (const [id, def] of Object.entries(FIXTURE_SERVERS)) {
    fixture.defineServer(id, def);
  }
  const aggregator = new Aggregator(FIXTURE_CONFIGS, {
    focusProfiles: DESIGN_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('design focus: search "screenshot page" ranks playwright/ tools first', async () => {
  const { aggregator } = buildAggregator('design');

  const result = await aggregator.callTool('ch1tty/search', { query: 'screenshot page browser', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const pwIdx = tools.findIndex((r) => r.tool.startsWith('playwright/'));
  const outIdx = tools.findIndex((r) => !r.tool.startsWith('playwright/'));

  assert.ok(pwIdx !== -1, 'playwright/ tools should appear for screenshot query');
  if (outIdx !== -1) {
    assert.ok(pwIdx < outIdx, 'playwright/ tools should rank above out-of-focus tools');
  }
  assert.equal(parsed.focus, 'design', 'search response should report design focus');
});

test('design focus: out-of-focus tools (github) remain reachable', async () => {
  const { aggregator } = buildAggregator('design');

  const result = await aggregator.callTool('ch1tty/search', { query: 'pull request code commit', limit: 15 });
  assert.equal(result.isError, undefined, 'search should not error with design focus');

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('github/')), 'github/ tools must remain reachable under design focus');
});

test('design focus: cast "take a screenshot" resolves to playwright/ tool', async () => {
  const { aggregator } = buildAggregator('design');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'take a screenshot of the homepage to verify the latest design changes',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(
    resolved.tool.startsWith('playwright/'),
    `cast should resolve to playwright/, got: ${resolved.tool}`,
  );
  assert.equal(cast.focus, 'design', 'cast response should report active focus');
});

test('design focus: execute playwright/screenshot succeeds', async () => {
  const { aggregator } = buildAggregator('design');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'playwright/screenshot',
    args: { url: 'https://ch1tty.chitty.cc' },
  });
  assert.equal(result.isError, undefined, 'playwright/screenshot should succeed under design focus');
});

test('design focus: status reports active focus as design', async () => {
  const { aggregator } = buildAggregator('design');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'design', 'status must report design as active focus');
});
