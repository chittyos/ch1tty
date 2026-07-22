import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recentLog } from '../src/recent-log.ts';
import { McpClientDispatch } from '../src/dispatch.ts';
import { quoProvider, gmailProvider } from '../src/providers.ts';
import type { Channel, MessagesProvider, OwnerIdentity } from '../src/types.ts';
import { validateRecentLogOutput, assertValid } from './ajv-harness.ts';

// LIVE integration: constructs the REAL MCP-client dispatch and calls quo+gmail
// against live backends. Gate-skipped when creds are absent (env endpoints not
// set) with a LOUD console message, so the real-infra path exists for when creds
// ARE present. CH1TTY_REMOTE_TIMEOUT_MS is forced low so a hanging/absent backend
// cannot stall the suite.

const QUO_ENDPOINT = process.env['COMMS_MCP_CHITTYAGENT_QUO_ENDPOINT'];
const GMAIL_ENDPOINT = process.env['COMMS_MCP_CHITTYAGENT_GOOGLE_ENDPOINT'];
const LIVE_CONTACT = process.env['COMMS_MCP_LIVE_TEST_IDENTIFIER'];
const OWNER_IDS = process.env['COMMS_MCP_OWNER_IDENTIFIERS'];

const hasCreds = Boolean((QUO_ENDPOINT || GMAIL_ENDPOINT) && LIVE_CONTACT && OWNER_IDS);

if (!hasCreds) {
  console.warn(
    '\n========================================================================\n' +
    ' [comms-mcp] LIVE INTEGRATION TEST SKIPPED — backend creds absent.\n' +
    '   Set COMMS_MCP_CHITTYAGENT_QUO_ENDPOINT and/or\n' +
    '       COMMS_MCP_CHITTYAGENT_GOOGLE_ENDPOINT (+ _TOKEN / _CF_ACCESS_*),\n' +
    '       COMMS_MCP_OWNER_IDENTIFIERS, COMMS_MCP_LIVE_TEST_IDENTIFIER\n' +
    '   to exercise the real MCP-client dispatch against live quo+gmail.\n' +
    '========================================================================\n',
  );
}

function providers(): Map<Channel, MessagesProvider> {
  const m = new Map<Channel, MessagesProvider>();
  if (QUO_ENDPOINT) m.set('quo', quoProvider);
  if (GMAIL_ENDPOINT) m.set('email', gmailProvider);
  return m;
}

describe('comms.recentLog LIVE integration', () => {
  it('fetches a real recent log via the MCP-client dispatch', { skip: !hasCreds }, async () => {
    if (!process.env['CH1TTY_REMOTE_TIMEOUT_MS']) process.env['CH1TTY_REMOTE_TIMEOUT_MS'] = '20000';
    const owner: OwnerIdentity = {
      identifiers: (OWNER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      displayName: process.env['COMMS_MCP_OWNER_DISPLAY_NAME'] ?? null,
      chittyId: process.env['COMMS_MCP_OWNER_CHITTYID'] ?? null,
    };
    const dispatch = new McpClientDispatch();
    try {
      const channels: Channel[] = [];
      if (QUO_ENDPOINT) channels.push('quo');
      if (GMAIL_ENDPOINT) channels.push('email');
      const out = await recentLog(
        { identifier: LIVE_CONTACT!, channels, days: 30, limit: 25 },
        { dispatch, owner, providers: providers() },
      );
      assertValid(validateRecentLogOutput, out, 'live output');
      assert.ok(out.metadata.channelsQueried.length === channels.length);
      console.log(`[comms-mcp] LIVE: ${out.entries.length} entries; channels=${JSON.stringify(out.metadata.channelsQueried.map((c) => ({ ch: c.channel, ok: c.ok, n: c.count })))}`);
    } finally {
      await dispatch.close();
    }
  });
});
