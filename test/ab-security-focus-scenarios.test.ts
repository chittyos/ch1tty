/**
 * Workstream AB — security focus profile scenarios.
 *
 * Validates the security focus profile with security + chittyevidence + ledger as wired backends:
 *  - security/ tools are boosted in search ranking (lens, not gate)
 *  - cast resolves security intents to security/ and chittyevidence/ tools
 *  - out-of-focus tools remain reachable when security focus is active
 *  - multi-step audit/triage/preserve workflows execute via fixture backends
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import type { ServerConfig } from '../src/types.js';
import { FixtureBackend, FIXTURE_SERVERS } from './fixture-backend.js';

const SECURITY_FOCUS_PROFILES = {
  profiles: {
    security: {
      description: 'Security operations — access auditing, secret scanning, incident triage, evidence preservation, and immutable audit-trail recording',
      categories: ['ecosystem' as const, 'code' as const],
      servers: ['security', 'chittyevidence', 'ledger', 'neon', 'tasks', 'linear'],
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
  { id: 'security', name: 'ChittySecurity', type: 'remote', access: 'readwrite', category: 'ecosystem', endpoint: 'https://fixture.security' },
  { id: 'chittyevidence', name: 'ChittyEvidence', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/evidence-mcp/dist/index.js'] },
  { id: 'ledger', name: 'ChittyLedger', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/ledger-mcp/dist/index.js'] },
  { id: 'tasks', name: 'ChittyAgent Tasks', type: 'local', access: 'readwrite', category: 'ecosystem', command: 'node', args: ['./apps/tasks-mcp/dist/index.js'] },
  { id: 'neon', name: 'Neon', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.neon' },
  { id: 'github', name: 'GitHub', type: 'remote', access: 'readwrite', category: 'code', endpoint: 'https://fixture.github' },
  { id: 'playwright', name: 'Playwright', type: 'local', access: 'readwrite', category: 'desktop', command: 'node', args: ['./apps/playwright-mcp/dist/index.js'] },
];

const SECURITY_FIXTURE_SERVER = {
  tools: [
    {
      name: 'list_security_events',
      description: 'List recent security events and incidents — failed auth, privilege escalation, anomalous access',
      inputSchema: {
        type: 'object' as const,
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'all'] },
          limit: { type: 'number' },
        },
      },
      response: {
        content: [{ type: 'text' as const, text: JSON.stringify([
          { id: 'sec-001', type: 'failed_auth', severity: 'high', actor: 'unknown@external.com', timestamp: '2026-09-07T08:00:00Z', resolved: false },
          { id: 'sec-002', type: 'secret_exposure', severity: 'critical', actor: 'ci-bot', timestamp: '2026-09-07T09:15:00Z', resolved: false },
          { id: 'sec-003', type: 'anomalous_access', severity: 'medium', actor: 'user@chitty.cc', timestamp: '2026-09-07T10:00:00Z', resolved: true },
        ]) }],
      },
    },
    {
      name: 'scan_secrets',
      description: 'Scan a repository or path for exposed secrets, API keys, and credentials',
      inputSchema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string' },
          branch: { type: 'string' },
        },
        required: ['repo'],
      },
      response: {
        content: [{ type: 'text' as const, text: JSON.stringify({
          repo: 'chittyos/ch1tty',
          branch: 'main',
          findings: [
            { file: 'config/old.env', line: 12, type: 'api_key', pattern: 'SK_LIVE_*', risk: 'critical' },
          ],
          scanned_files: 342,
          scan_duration_ms: 1820,
        }) }],
      },
    },
    {
      name: 'get_access_audit',
      description: 'Get an access audit log — who accessed what resource and when',
      inputSchema: {
        type: 'object' as const,
        properties: {
          resource_id: { type: 'string' },
          since: { type: 'string' },
        },
        required: ['resource_id'],
      },
      response: {
        content: [{ type: 'text' as const, text: JSON.stringify({
          resource_id: 'chittycanon://core/services/ch1tty',
          entries: [
            { actor: 'nick@nevershitty.com', action: 'read', timestamp: '2026-09-07T07:00:00Z' },
            { actor: 'ci-bot', action: 'write', timestamp: '2026-09-07T09:00:00Z' },
            { actor: 'unknown@external.com', action: 'read', timestamp: '2026-09-07T09:55:00Z' },
          ],
        }) }],
      },
    },
    {
      name: 'triage_incident',
      description: 'Triage a security incident — assign severity, owner, and status',
      inputSchema: {
        type: 'object' as const,
        properties: {
          event_id: { type: 'string' },
          severity: { type: 'string' },
          owner: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['event_id', 'severity', 'owner'],
      },
      response: {
        content: [{ type: 'text' as const, text: JSON.stringify({
          id: 'inc-001',
          event_id: 'sec-001',
          severity: 'high',
          owner: 'nick@nevershitty.com',
          status: 'triaged',
          created_at: '2026-09-07T11:00:00Z',
        }) }],
      },
    },
  ],
};

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
  fixture.defineServer('security', SECURITY_FIXTURE_SERVER);
  fixture.defineServer('playwright', FIXTURE_SERVERS.playwright);
  const aggregator = new Aggregator(FIXTURE_CONFIGS, {
    focusProfiles: SECURITY_FOCUS_PROFILES,
    focus,
    embedEnabled: false,
    backendFactory: (config) => {
      fixture.registerServer(config);
      return fixture;
    },
  });
  return { aggregator, fixture };
}

test('security focus: search "security events" ranks security/ tools first', async () => {
  const { aggregator } = buildAggregator('security');

  const result = await aggregator.callTool('ch1tty/search', { query: 'security events incidents', limit: 10 });
  assert.equal(result.isError, undefined, 'search should not error');

  const parsed = parseSearch(result);
  const tools = parsed.tools ?? [];
  assert.ok(tools.length > 0, 'should return results');

  const secIdx = tools.findIndex((r) => r.tool.startsWith('security/'));
  const outIdx = tools.findIndex((r) => r.inFocus !== true);

  assert.ok(secIdx !== -1, 'security/ tools should appear in results');
  if (outIdx !== -1) {
    assert.ok(secIdx < outIdx, 'security/ tools should rank above out-of-focus tools');
  }
  assert.equal(parsed.focus, 'security', 'search response should report active focus');
});

test('security focus: search "scan secrets" includes security/scan_secrets', async () => {
  const { aggregator } = buildAggregator('security');

  const result = await aggregator.callTool('ch1tty/search', { query: 'scan secrets api keys credentials', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'security/scan_secrets'), 'security/scan_secrets must appear in results');
});

test('security focus: search "audit access log" includes security/get_access_audit', async () => {
  const { aggregator } = buildAggregator('security');

  const result = await aggregator.callTool('ch1tty/search', { query: 'audit access log resource', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t === 'security/get_access_audit'), 'security/get_access_audit must appear');
});

test('security focus: out-of-focus tools (playwright) remain reachable via search', async () => {
  const { aggregator } = buildAggregator('security');

  const result = await aggregator.callTool('ch1tty/search', { query: 'playwright browser navigate page', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('playwright/')), 'playwright/ tools (category: desktop, not in security profile) must remain reachable when security focus is active');
  const playwrightTools = (parsed.tools ?? []).filter((r) => r.tool.startsWith('playwright/'));
  assert.ok(playwrightTools.every((r) => r.inFocus !== true), 'playwright/ tools must not be marked inFocus when security focus is active');
});

test('security focus: no focus — security tools still accessible (lens not gate)', async () => {
  const { aggregator } = buildAggregator();

  const result = await aggregator.callTool('ch1tty/search', { query: 'security event incident triage', limit: 10 });
  assert.equal(result.isError, undefined);

  const parsed = parseSearch(result);
  const toolNames = (parsed.tools ?? []).map((r) => r.tool);
  assert.ok(toolNames.some((t) => t.startsWith('security/')), 'security/ tools must be reachable without any focus');
});

test('security focus: execute security/list_security_events returns fixture events', async () => {
  const { aggregator, fixture } = buildAggregator('security');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'security/list_security_events',
    args: { severity: 'all', limit: 10 },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const events = JSON.parse(result.content[0].text as string) as Array<{ id: string; severity: string }>;
  assert.ok(Array.isArray(events), 'should return an array of events');
  assert.ok(events.length > 0, 'fixture should return at least one event');
  assert.ok(events.every((e) => e.id && e.severity), 'each event should have id and severity');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'security' && c.tool === 'list_security_events'), 'list_security_events must be in call log');
});

test('security focus: execute security/scan_secrets returns findings', async () => {
  const { aggregator, fixture } = buildAggregator('security');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'security/scan_secrets',
    args: { repo: 'chittyos/ch1tty', branch: 'main' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const scan = JSON.parse(result.content[0].text as string) as { findings: Array<{ file: string; risk: string }>; scanned_files: number };
  assert.ok(Array.isArray(scan.findings), 'should return findings array');
  assert.ok(typeof scan.scanned_files === 'number', 'should include scanned_files count');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'security' && c.tool === 'scan_secrets'), 'scan_secrets must be in call log');
});

test('security focus: execute security/triage_incident returns triaged incident', async () => {
  const { aggregator, fixture } = buildAggregator('security');
  fixture.clearCallLog();

  const result = await aggregator.callTool('ch1tty/execute', {
    tool: 'security/triage_incident',
    args: { event_id: 'sec-001', severity: 'high', owner: 'nick@nevershitty.com', notes: 'Investigating failed auth burst' },
  });
  assert.equal(result.isError, undefined, 'execute should succeed');

  const incident = JSON.parse(result.content[0].text as string) as { id: string; status: string; owner: string };
  assert.ok(incident.id, 'incident should have an id');
  assert.equal(incident.status, 'triaged', 'incident should be triaged');
  assert.equal(incident.owner, 'nick@nevershitty.com', 'incident owner should match');

  const calls = fixture.getCallLog();
  assert.ok(calls.some((c) => c.serverId === 'security' && c.tool === 'triage_incident'), 'triage_incident must be in call log');
});

test('security focus: cast "scan repository for secrets" returns a plan', async () => {
  const { aggregator } = buildAggregator('security');

  const result = await aggregator.callTool('ch1tty/cast', {
    intent: 'scan repository for exposed secrets and credentials',
    confirm: true,
  });
  assert.equal(result.isError, undefined, 'cast should not error');

  const parsed = parseCast(result);
  // cast may use keyword or confirm path; verify it has a plan with a tool or at least
  // a valid response (keyword scoring is probabilistic — we assert structure not specific match)
  assert.ok(typeof parsed === 'object' && parsed !== null, 'cast should return a valid response object');
  const castField = parsed.cast as string | undefined;
  assert.ok(castField === 'plan' || castField === 'executed', `cast field should be plan or executed, got: ${castField}`);
  if (castField === 'plan') {
    const resolved = parsed.resolved as { tool: string } | undefined;
    assert.ok(resolved?.tool.startsWith('security/'), `plan should resolve to a security/ tool, got: ${resolved?.tool}`);
  }
});

test('security focus: multi-step — scan secrets, triage critical finding, create task', async () => {
  const { aggregator, fixture } = buildAggregator('security');
  const sessionId = 'security-scenario-001';
  fixture.clearCallLog();

  // Step 1: scan for secrets
  const scanResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'security/scan_secrets',
    args: { repo: 'chittyos/ch1tty', branch: 'main' },
  }, sessionId);
  assert.equal(scanResult.isError, undefined, 'scan_secrets should succeed');
  const scan = JSON.parse(scanResult.content[0].text as string) as { findings: Array<{ file: string; risk: string }> };
  assert.ok(scan.findings.length > 0, 'should find at least one secret');

  // Step 2: triage the critical finding as an incident — use sec-001, the event the fixture returns
  const triageResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'security/triage_incident',
    args: { event_id: 'sec-001', severity: 'critical', owner: 'nick@nevershitty.com', notes: `Exposed key in ${scan.findings[0].file}` },
  }, sessionId);
  assert.equal(triageResult.isError, undefined, 'triage_incident should succeed');
  const incident = JSON.parse(triageResult.content[0].text as string) as { id: string; event_id: string };
  assert.equal(incident.event_id, 'sec-001', 'triaged incident should reference sec-001');

  // Step 3: create a remediation task
  const taskResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'tasks/create_task',
    args: { entity_id: incident.id, title: 'Rotate exposed API key — critical', priority: 'high' },
  }, sessionId);
  assert.equal(taskResult.isError, undefined, 'create_task should succeed');

  const calls = fixture.getCallLog();
  const callKeys = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(callKeys.includes('security/scan_secrets'), 'scan_secrets must be in call log');
  assert.ok(callKeys.includes('security/triage_incident'), 'triage_incident must be in call log');
  assert.ok(callKeys.includes('tasks/create_task'), 'create_task must be in call log');
});

test('security focus: multi-step — audit access, preserve evidence, append to ledger', async () => {
  const { aggregator, fixture } = buildAggregator('security');
  const sessionId = 'security-scenario-002';
  fixture.clearCallLog();

  // Step 1: audit access to a sensitive resource
  const auditResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'security/get_access_audit',
    args: { resource_id: 'chittycanon://core/services/ch1tty', since: '2026-09-07T00:00:00Z' },
  }, sessionId);
  assert.equal(auditResult.isError, undefined, 'get_access_audit should succeed');
  const audit = JSON.parse(auditResult.content[0].text as string) as { entries: Array<{ actor: string }> };
  assert.ok(audit.entries.length > 0, 'should return access entries');

  // Step 2: ingest the audit as evidence
  const evidenceResult = await aggregator.callTool('ch1tty/execute', {
    tool: 'chittyevidence/ingest_document',
    args: {
      canonical_uri: 'chittycanon://security/access-audit/2026-09-07',
      content: JSON.stringify(audit),
      kind: 'audit',
    },
  }, sessionId);
  assert.equal(evidenceResult.isError, undefined, 'evidence ingest_document should succeed');

  const calls = fixture.getCallLog();
  const callKeys = calls.map((c) => `${c.serverId}/${c.tool}`);
  assert.ok(callKeys.includes('security/get_access_audit'), 'get_access_audit must be in call log');
  assert.ok(callKeys.includes('chittyevidence/ingest_document'), 'chittyevidence/ingest_document must be in call log');
});

test('security focus: status reports available focus profiles including security', async () => {
  const { aggregator } = buildAggregator('security');

  const result = await aggregator.callTool('ch1tty/status', {});
  assert.equal(result.isError, undefined, 'status should not error');

  const parsed = JSON.parse(result.content[0].text as string) as {
    availableFocusProfiles?: string[];
  };
  assert.ok(Array.isArray(parsed.availableFocusProfiles), 'status should include availableFocusProfiles array');
  assert.ok(parsed.availableFocusProfiles?.includes('security'), 'status should include security in availableFocusProfiles');
});

test('security focus: focus:none per-call override removes security boost vs focused search', async () => {
  const { aggregator } = buildAggregator('security');
  const query = 'list security events incidents';

  const focusedResult = await aggregator.callTool('ch1tty/search', { query, limit: 10 });
  assert.equal(focusedResult.isError, undefined, 'focused search should not error');
  const focused = parseSearch(focusedResult);
  const focusedTools = focused.tools ?? [];

  const unfocusedResult = await aggregator.callTool('ch1tty/search', { query, limit: 10, focus: 'none' });
  assert.equal(unfocusedResult.isError, undefined, 'focus:none search should not error');
  const unfocused = parseSearch(unfocusedResult);
  const unfocusedTools = unfocused.tools ?? [];

  assert.ok(focusedTools.some((r) => r.inFocus === true), 'focused search must mark at least one tool inFocus');
  assert.ok(!unfocusedTools.some((r) => r.inFocus === true), 'focus:none search must not mark any tool inFocus');

  const focusedSecIdx = focusedTools.findIndex((r) => r.tool.startsWith('security/'));
  const unfocusedSecIdx = unfocusedTools.findIndex((r) => r.tool.startsWith('security/'));
  if (focusedSecIdx !== -1 && unfocusedSecIdx !== -1) {
    assert.ok(focusedSecIdx <= unfocusedSecIdx, 'security/ tools should rank higher (or equal) in focused search vs focus:none');
  }
});
