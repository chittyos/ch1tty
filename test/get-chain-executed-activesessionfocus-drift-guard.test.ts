/**
 * GET drift guard: freeze cast:chain_executed sessionContext.activeSessionFocus
 * PRESENCE, ABSENCE, and VALUE constraints.
 *
 * Context:
 *   chainSessionContext is constructed in src/aggregator.ts (~line 1516):
 *     const sfocus = this.coordinator.getSessionFocus(effectiveSessionId);
 *     chainSessionContext = {
 *       recentTools: ctxPat.slice(0, 5).map((p) => p.tool),
 *       callCount:   ctxPat.reduce((s, p) => s + p.count, 0),
 *       ...(sfocus ? { activeSessionFocus: sfocus } : {}),
 *     };
 *
 *   getSessionFocus() returns the session's sticky focus — set when a prior
 *   ch1tty/search or ch1tty/cast call includes a `focus` param for the same
 *   sessionId.  It is undefined until a per-call focus is applied to the session.
 *
 * Prior coverage gaps:
 *   GEI-4 froze that chain_executed sessionContext.recentTools is an Array of
 *   strings. GES froze recentTools item VALUE constraints.
 *   en-250  froze that chain_executed sessionContext.callCount is a non-negative
 *   integer.
 *   GR-5 froze cast:executed activeSessionFocus is typeof string and non-empty.
 *
 * No existing test freezes activeSessionFocus specifically for chain_executed:
 *   - ABSENT when no focus has been set for the session
 *   - PRESENT when a sticky focus is active
 *   - typeof string when present
 *   - non-empty (length > 0) when present
 *   - exact value matches the configured focus name
 *
 * A regression that:
 *   (a) injects activeSessionFocus with a default/empty value when no focus is
 *       set (leaking a spurious key)
 *   (b) omits activeSessionFocus even when a sticky focus is active
 *   (c) emits an empty-string activeSessionFocus or trims the name
 *   (d) emits the wrong focus name (e.g., a hardcoded default)
 * would be invisible to the existing test suite.
 *
 * GET freezes:
 *
 *   GET-1  chain_executed sessionContext has NO `activeSessionFocus` key when no
 *          focus has been set for the session (sfocus is undefined → the spread
 *          contributes nothing; `activeSessionFocus` must not appear as a key).
 *
 *   GET-2  chain_executed sessionContext HAS `activeSessionFocus` key when a
 *          sticky focus has been set for the session via a prior search call with
 *          focus:'code'.
 *
 *   GET-3  chain_executed sessionContext.activeSessionFocus is typeof 'string'
 *          when present (not a number, boolean, array, or null).
 *
 *   GET-4  chain_executed sessionContext.activeSessionFocus is a non-empty string
 *          when present (length > 0; empty string is equivalent to no focus and
 *          must not reach the sessionContext).
 *
 *   GET-5  chain_executed sessionContext.activeSessionFocus equals the exact
 *          configured focus name ('code'), not a cased variant or trimmed form.
 *
 * Setup: keyword-only coordinator (no brain), code focus + neon chain catalog.
 * Focus activation follows the GR-5 pattern: `ch1tty/search` with `focus:'code'`
 * + `sessionId` sets the session's sticky focus, which chain_executed then reads
 * via getSessionFocus().
 *
 * Frozen 2026-10-01.
 *
 * CLAUDE.md compliance:
 *   - 5-tool public surface: unchanged (test-only file)
 *   - buildCastExplanation metric freeze: not applicable (sessionContext
 *     sub-object key/value constraints, not explanation fields)
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { SessionCoordinator } from '../src/coordinator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend } from './fixture-backend.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CATALOG = {
  code: {
    description: 'Code focus',
    combos: [{
      name: 'neon-setup',
      chain: ['neon/list_projects', 'neon/create_project'],
      accomplishes: 'List then create a Neon project',
      verified: true,
    }],
    prompts: [],
  },
};

const FOCUS_PROFILES = {
  profiles: {
    code: { categories: ['code' as const], servers: ['neon'], boost: 0.5 },
  },
};

const NEON_CFG: ServerConfig = {
  id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite',
  category: 'code', endpoint: 'https://neon.tech/mcp', lazy: true,
};

let _seq = 0;
function dlq(): string {
  return join(tmpdir(), `ch1tty-get-${Date.now()}-${++_seq}.jsonl`);
}

class KeywordOnlyCoordinator extends SessionCoordinator {
  override async routeIntent(): Promise<null> { return null; }
}

function makeAgg(): Aggregator {
  const backend = new FixtureBackend();
  backend.defineServer('neon', {
    tools: [
      {
        name: 'list_projects',
        description: 'list neon database projects',
        inputSchema: { type: 'object', properties: {} },
        response: { content: [{ type: 'resource', resource: { uri: 'neon://projects', name: 'projects' } }] },
      },
      {
        name: 'create_project',
        description: 'create a neon database project',
        inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
        response: { content: [{ type: 'resource', resource: { uri: 'neon://project/new', name: 'new-project' } }] },
      },
    ],
  });
  const path = dlq();
  return new Aggregator([NEON_CFG], {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: path,
    suggestionsCatalog: CATALOG,
    focusProfiles: FOCUS_PROFILES,
    focus: 'code',
    coordinator: new KeywordOnlyCoordinator({}, { enabled: false }, path),
  });
}

const INTENT = 'list neon database projects';

async function chainExecutedWithSession(
  agg: Aggregator,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const result = await agg.callTool('ch1tty/cast', { intent: INTENT, chain: true, sessionId });
  assert.equal(result.isError, undefined, `cast must not error: ${JSON.stringify(result.content)}`);
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  assert.ok(Array.isArray(content) && content.length >= 1, 'must return ≥ 1 content item');
  const body = JSON.parse(content[0]!.text!) as Record<string, unknown>;
  assert.equal(body['cast'], 'chain_executed',
    `expected cast:chain_executed, got cast="${String(body['cast'])}"`);
  return body;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('GET-1: chain_executed sessionContext has no activeSessionFocus key when no focus is set for the session', async () => {
  const agg = makeAgg();
  try {
    // No prior search with a focus param — session has no sticky focus.
    const body = await chainExecutedWithSession(agg, 'get-s1');
    const ctx = body['sessionContext'] as Record<string, unknown> | undefined;
    assert.ok(ctx !== null && typeof ctx === 'object', 'sessionContext must be present');
    assert.ok(
      !Object.prototype.hasOwnProperty.call(ctx, 'activeSessionFocus'),
      `activeSessionFocus must be absent when no sticky focus is set; got ${JSON.stringify(ctx)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GET-2: chain_executed sessionContext HAS activeSessionFocus when sticky focus is set for the session', async () => {
  const agg = makeAgg();
  try {
    // Set sticky focus via a search call with focus:'code' (same pattern as GR-5).
    await agg.callTool('ch1tty/search', { query: 'database', focus: 'code', sessionId: 'get-s2' });
    const body = await chainExecutedWithSession(agg, 'get-s2');
    const ctx = body['sessionContext'] as Record<string, unknown>;
    assert.ok(ctx !== null && typeof ctx === 'object', 'sessionContext must be present');
    assert.ok(
      Object.prototype.hasOwnProperty.call(ctx, 'activeSessionFocus'),
      `activeSessionFocus must be present after setting sticky focus via search; got ${JSON.stringify(ctx)}`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GET-3: chain_executed sessionContext.activeSessionFocus is typeof string when present', async () => {
  const agg = makeAgg();
  try {
    await agg.callTool('ch1tty/search', { query: 'database', focus: 'code', sessionId: 'get-s3' });
    const body = await chainExecutedWithSession(agg, 'get-s3');
    const ctx = body['sessionContext'] as Record<string, unknown>;
    const asf = ctx['activeSessionFocus'];
    assert.ok(
      Object.prototype.hasOwnProperty.call(ctx, 'activeSessionFocus'),
      'activeSessionFocus must be present (GET-2 precondition)',
    );
    assert.equal(
      typeof asf,
      'string',
      `activeSessionFocus must be typeof string, got ${typeof asf} (value: ${JSON.stringify(asf)})`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GET-4: chain_executed sessionContext.activeSessionFocus is a non-empty string when present', async () => {
  const agg = makeAgg();
  try {
    await agg.callTool('ch1tty/search', { query: 'database', focus: 'code', sessionId: 'get-s4' });
    const body = await chainExecutedWithSession(agg, 'get-s4');
    const ctx = body['sessionContext'] as Record<string, unknown>;
    const asf = ctx['activeSessionFocus'] as string;
    assert.ok(
      Object.prototype.hasOwnProperty.call(ctx, 'activeSessionFocus'),
      'activeSessionFocus must be present (GET-2 precondition)',
    );
    assert.ok(
      asf.length > 0,
      `activeSessionFocus must be a non-empty string, got empty string ""`,
    );
  } finally {
    await agg.shutdown();
  }
});

test('GET-5: chain_executed sessionContext.activeSessionFocus equals the exact focus name ("code")', async () => {
  const agg = makeAgg();
  try {
    await agg.callTool('ch1tty/search', { query: 'database', focus: 'code', sessionId: 'get-s5' });
    const body = await chainExecutedWithSession(agg, 'get-s5');
    const ctx = body['sessionContext'] as Record<string, unknown>;
    const asf = ctx['activeSessionFocus'];
    assert.ok(
      Object.prototype.hasOwnProperty.call(ctx, 'activeSessionFocus'),
      'activeSessionFocus must be present (GET-2 precondition)',
    );
    assert.equal(
      asf,
      'code',
      `activeSessionFocus must equal 'code' exactly (not cased variant or trimmed); got ${JSON.stringify(asf)}`,
    );
  } finally {
    await agg.shutdown();
  }
});
