/**
 * Workstream S — auth focus profile scenarios.
 *
 * Validates the auth focus profile:
 *  - auth/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves identity/access intents to auth/ tools
 *  - out-of-focus tools remain reachable when auth focus is active
 *  - multi-step auth workflows (token rotation, identity lookup) execute via fixture backend
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const AUTH_FOCUS_PROFILES = {
  profiles: {
    auth: {
      description: 'Identity and access management — verify tokens, issue credentials, manage sessions, and trace auth flows across ChittyID',
      categories: ['ecosystem' as const],
      servers: ['auth', 'session', 'chittyos'],
      boost: 0.6,
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
  { id: 'auth', name: 'ChittyID Auth', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.auth' },
  { id: 'session', name: 'Session Coordinator', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/session-mcp/dist/index.js'] },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'notion', name: 'Notion', type: 'remote', access: 'readwrite', category: 'documents', endpoint: 'https://fixture.notion' },
  { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.github' },
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
    focusProfiles: AUTH_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('auth focus: search "verify token" ranks auth/ tools first', async () => {
  const { aggregator } = buildAggregator('auth');

  const result = await aggregator.callTool('ch1tty/search', { query: 'verify token', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const authIdx = tools.findIndex((r) => r.tool.startsWith('auth/'));
  const otherIdx = tools.findIndex((r) => !r.tool.startsWith('auth/'));

  assert.ok(authIdx !== -1, 'auth/ tools should appear in results');
  if (otherIdx !== -1) {
    assert.ok(authIdx < otherIdx, 'auth/ tools should rank above out-of-focus tools for auth query');
  }
  assert.equal(parsed.focus, 'auth', 'search response should report active focus');
});

test('auth focus: search "create token" includes auth/create_token', async () => {
  const { aggregator } = buildAggregator('auth');

  const result = await aggregator.callTool('ch1tty/search', { query: 'create token', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'auth/create_token'), 'auth/create_token must appear in results');
});

test('auth focus: out-of-focus tools (neon) remain reachable via search', async () => {
  const { aggregator } = buildAggregator('auth');

  const result = await aggregator.callTool('ch1tty/search', { query: 'database query', limit: 20 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('neon/')), 'neon/ tools must remain reachable with auth focus active');
});

test('auth focus: no focus — auth tools still accessible (lens not gate)', async () => {
  const { aggregator } = buildAggregator(); // no focus

  const result = await aggregator.callTool('ch1tty/search', { query: 'verify token', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('auth/')), 'auth/ tools must be reachable without any focus');
});

test('auth focus: execute verify_token returns valid fixture response', async () => {
  const { aggregator, fixture } = buildAggregator('auth');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'auth/verify_token',
    args: { token: 'tok_fixture_test_abc' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const body = JSON.parse(result.content[0].text as string) as { valid: boolean; identity_id: string };
  assert.equal(body.valid, true, 'fixture should return valid:true');
  assert.ok(typeof body.identity_id === 'string', 'identity_id should be a string');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'auth' && c.tool === 'verify_token'), 'auth/verify_token must be in call log');
});

test('auth focus: execute list_tokens returns token array', async () => {
  const { aggregator } = buildAggregator('auth');

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'auth/list_tokens',
    args: { identity_id: 'chittyid-nick-001' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const tokens = JSON.parse(result.content[0].text as string) as Array<{ token_id: string; status: string }>;
  assert.ok(Array.isArray(tokens), 'should return an array of tokens');
  assert.ok(tokens.length > 0, 'fixture should return at least one token');
});

test('auth focus: multi-step — list tokens then revoke expired one', async () => {
  const { aggregator, fixture } = buildAggregator('auth');
  const sessionId = 'auth-scenario-001';
  fixture.clearCallLog();

  // Step 1: list tokens
  const listResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'auth/list_tokens',
    args: { identity_id: 'chittyid-nick-001', include_expired: true },
  }, sessionId);
  assert.equal(listResult.isError, undefined, 'list_tokens should succeed');
  const tokens = JSON.parse(listResult.content[0].text as string) as Array<{ token_id: string; status: string }>;
  const expiredToken = tokens.find((t) => t.status === 'expired');
  assert.ok(expiredToken, 'fixture should include an expired token');

  // Step 2: revoke the expired token using its token_id from the list
  const revokeResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'auth/revoke_token',
    args: { token_id: expiredToken.token_id },
  }, sessionId);
  assert.equal(revokeResult.isError, undefined, 'revoke_token should succeed');
  const revoked = JSON.parse(revokeResult.content[0].text as string) as { revoked: boolean; token_id: string };
  assert.equal(revoked.revoked, true, 'revoke response should confirm revoked:true');

  const calls = fixture.getCallLog();
  const toolNames = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(toolNames.includes('auth/list_tokens'), 'list_tokens must be in call log');
  assert.ok(toolNames.includes('auth/revoke_token'), 'revoke_token must be in call log');
});

test('auth focus: multi-step — verify token then fetch identity', async () => {
  const { aggregator, fixture } = buildAggregator('auth');
  fixture.clearCallLog();

  // Step 1: verify token
  const verifyResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'auth/verify_token',
    args: { token: 'tok_fixture_test_abc' },
  });
  assert.equal(verifyResult.isError, undefined, 'verify_token should succeed');
  const verified = JSON.parse(verifyResult.content[0].text as string) as { valid: boolean; identity_id: string };
  assert.equal(verified.valid, true);

  // Step 2: get identity for the returned identity_id
  const identityResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'auth/get_identity',
    args: { identity_id: verified.identity_id },
  });
  assert.equal(identityResult.isError, undefined, 'get_identity should succeed');
  const identity = JSON.parse(identityResult.content[0].text as string) as { identity_id: string; email: string };
  assert.equal(identity.identity_id, verified.identity_id, 'identity should match verified identity_id');
  assert.ok(typeof identity.email === 'string', 'identity should have an email');
});

test('auth focus: status reports active focus as auth', async () => {
  const { aggregator } = buildAggregator('auth');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined);

  const status = JSON.parse(result.content[0].text as string) as { focus?: { active?: string } };
  assert.equal(status.focus?.active, 'auth', 'status must report auth as active focus');
});

test('auth focus: cast "verify token" with confirm resolves to auth/verify_token', async () => {
  const { aggregator } = buildAggregator('auth');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'verify this API token',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.ok(resolved.tool.startsWith('auth/'), `cast should resolve to auth/, got: ${resolved.tool}`);
  assert.equal(cast.focus, 'auth', 'cast response should report active focus');
});

test('auth focus: cast "create a new token" resolves to auth/create_token', async () => {
  const { aggregator } = buildAggregator('auth');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'create a new API token for my identity',
    confirm: true,
  });
  assert.equal(result.isError, undefined);

  const cast = parseCast(result);
  assert.equal(cast.cast, 'plan', `cast.cast should be 'plan', got: ${String(cast.cast)}`);
  const resolved = cast.resolved as { tool: string; score: number } | undefined;
  assert.ok(resolved, 'cast should resolve a tool');
  assert.equal(
    resolved.tool,
    'auth/create_token',
    `should resolve to auth/create_token, got: ${resolved.tool}`,
  );
});
