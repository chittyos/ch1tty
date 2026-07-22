import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recentLog } from '../src/recent-log.ts';
import type { Channel, CommsDispatch, MessagesProvider, OwnerIdentity } from '../src/types.ts';
import { quoProvider, gmailProvider } from '../src/providers.ts';
import { validateRecentLogOutput, assertValid } from './ajv-harness.ts';

const OWNER: OwnerIdentity = {
  identifiers: ['+13125551212', 'nick@nevershitty.com', 'nick@chitty.cc'],
  displayName: 'Nick',
  chittyId: '03-1-USA-5537-P-2602-0-38',
};

// Production-shaped rows returned per backend tool (DI of REAL shapes, not a mock).
const QUO_ROWS = [
  {
    message_id: '16884', external_id: 'OPdf1a2b3c4d5e6f7a8b9c0d1e2f3a4b5',
    external_thread_id: 'OPthreadAAAA1111', direction: 'inbound',
    body_text: 'Hey, are we still meeting Thursday?', sent_at: '2026-06-10T15:42:03Z',
    parties: [{ role: 'sender', identifier: '+13122186717' }, { role: 'recipient', identifier: '+13125551212' }],
    source: 'openphone',
  },
  {
    message_id: '16885', external_id: 'OPaa11bb22cc33dd44ee55ff6600112233',
    external_thread_id: 'OPthreadAAAA1111', direction: 'outbound',
    body_text: 'Yes, 2pm.', sent_at: '2026-06-10T15:50:11Z',
    parties: [{ role: 'sender', identifier: '+13125551212' }, { role: 'recipient', identifier: '+13122186717' }],
    source: 'openphone',
  },
];

const GMAIL_THREADS = [
  {
    id: '18f2a9c4b7e1d600',
    messages: [
      {
        id: '18f2a9c4b7e1d6a3', date: '2026-06-09T09:12:44Z',
        sender: 'Maria Bianchi <maria.bianchi@example-law.com>',
        toRecipients: ['nick@nevershitty.com'], subject: 'Closing disclosure',
        snippet: 'Attached is the revised closing disclosure.', labelIds: ['INBOX'],
      },
    ],
  },
];

/** A CommsDispatch that returns real-shaped rows per (server, tool). DI, not a mock. */
function dispatchReturning(map: Record<string, unknown>, fail?: Set<string>): CommsDispatch {
  return {
    async call(mcpServerId, tool) {
      const key = `${mcpServerId}/${tool}`;
      if (fail?.has(mcpServerId)) throw new Error(`backend ${mcpServerId} is down`);
      if (key in map) return map[key];
      return [];
    },
  };
}

const HAPPY_MAP = {
  'chittyagent-quo/quo_recent_messages_local': QUO_ROWS,
  'chittyagent-google/search_threads': GMAIL_THREADS,
};

function providers(...ps: MessagesProvider[]): Map<Channel, MessagesProvider> {
  const m = new Map<Channel, MessagesProvider>();
  for (const p of ps) m.set(p.channel, p);
  return m;
}

// Deterministic window bracketing the fixture dates (2026-06-09/10) — explicit
// since/until so these tests do not depend on the current wall-clock date.
const WIN = { since: '2026-06-01T00:00:00Z', until: '2026-06-30T00:00:00Z' } as const;

describe('recentLog combo', () => {
  it('merges quo + email, time-ordered desc, and validates the whole Output', async () => {
    const out = await recentLog(
      { identifier: '+13122186717', channels: ['quo', 'email'], ...WIN },
      { dispatch: dispatchReturning(HAPPY_MAP), owner: OWNER, providers: providers(quoProvider, gmailProvider) },
    );
    assertValid(validateRecentLogOutput, out, 'happy output');
    assert.equal(out.entries.length, 3);
    // desc: most recent first (quo 15:50 > quo 15:42 > gmail 06-09)
    assert.equal(out.entries[0].providerMessageId, 'OPaa11bb22cc33dd44ee55ff6600112233');
    assert.equal(out.entries[2].channel, 'email');
    assert.equal(out.metadata.channelsQueried.length, 2);
    assert.ok(out.metadata.channelsQueried.every((c) => c.ok));
  });

  it('honors asc order', async () => {
    const out = await recentLog(
      { identifier: '+13122186717', channels: ['quo', 'email'], order: 'asc', ...WIN },
      { dispatch: dispatchReturning(HAPPY_MAP), owner: OWNER, providers: providers(quoProvider, gmailProvider) },
    );
    assert.equal(out.entries[0].channel, 'email'); // oldest first
  });

  it('applies limit and sets truncated + totalBeforeLimit', async () => {
    const out = await recentLog(
      { identifier: '+13122186717', channels: ['quo', 'email'], limit: 2, ...WIN },
      { dispatch: dispatchReturning(HAPPY_MAP), owner: OWNER, providers: providers(quoProvider, gmailProvider) },
    );
    assertValid(validateRecentLogOutput, out, 'limited output');
    assert.equal(out.entries.length, 2);
    assert.equal(out.metadata.totalBeforeLimit, 3);
    assert.equal(out.metadata.truncated, true);
  });

  it('degrades a failing channel to ok:false while others still return (no silent fallback)', async () => {
    const out = await recentLog(
      { identifier: '+13122186717', channels: ['quo', 'email'], ...WIN },
      {
        dispatch: dispatchReturning(HAPPY_MAP, new Set(['chittyagent-quo'])),
        owner: OWNER,
        providers: providers(quoProvider, gmailProvider),
      },
    );
    assertValid(validateRecentLogOutput, out, 'degraded output');
    const quo = out.metadata.channelsQueried.find((c) => c.channel === 'quo')!;
    const email = out.metadata.channelsQueried.find((c) => c.channel === 'email')!;
    assert.equal(quo.ok, false);
    assert.match(quo.error ?? '', /down/);
    assert.equal(quo.count, 0);
    assert.equal(email.ok, true);
    assert.ok(out.entries.length >= 1, 'email entries still present');
  });

  it('default channels include imessage, which is UNBOUND → ok:false while quo+email succeed', async () => {
    const out = await recentLog(
      { identifier: '+13122186717', ...WIN }, // default channels ['quo','imessage','email']
      { dispatch: dispatchReturning(HAPPY_MAP), owner: OWNER, providers: providers(quoProvider, gmailProvider) },
    );
    assertValid(validateRecentLogOutput, out, 'default-channels output');
    const im = out.metadata.channelsQueried.find((c) => c.channel === 'imessage')!;
    assert.equal(im.ok, false);
    assert.match(im.error ?? '', /imessage|relation|column/i);
    assert.ok(out.metadata.channelsQueried.find((c) => c.channel === 'quo')!.ok);
    assert.ok(out.metadata.channelsQueried.find((c) => c.channel === 'email')!.ok);
  });

  it('reports honest resolvedContact (chittyId null for a raw identifier)', async () => {
    const out = await recentLog(
      { identifier: '+13122186717', channels: ['quo'], ...WIN },
      { dispatch: dispatchReturning(HAPPY_MAP), owner: OWNER, providers: providers(quoProvider) },
    );
    assert.equal(out.metadata.resolvedContact.chittyId, null);
    assert.deepEqual(out.metadata.resolvedContact.identifiers, ['+13122186717']);
  });

  it('reshapedBy is honest ("none") — reshapers are hand-bound, not codemode-regenerated', async () => {
    const out = await recentLog(
      { identifier: '+13122186717', channels: ['quo'], ...WIN },
      { dispatch: dispatchReturning(HAPPY_MAP), owner: OWNER, providers: providers(quoProvider) },
    );
    assert.equal(out.metadata.channelsQueried[0].reshapedBy, 'none');
  });
});
