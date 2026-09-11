/**
 * test(AN): recent-log.ts branch gaps — 5 uncovered branches
 *
 * Targets the branches NOT covered by recent-log.test.ts, ak-reshape-edge-paths,
 * or the in-flight AJ extractRows PR:
 *
 *   1. flattenGmail — null/non-object row skip (if (!r || typeof r !== 'object') continue)
 *   2. flattenGmail — threadId from obj.threadId fallback (no obj.id field)
 *   3. fetchChannel — bound provider for unhandled channel ('twilio') → "no reshaper wired"
 *   4. recentLog — generic unbound channel (not 'imessage') → "no bound provider for channel X"
 *   5. recentLog — input.person with chittyId pattern (/-P-/ test) → resolvedContact.chittyId set
 *   6. recentLog — input.person without chittyId pattern → resolvedContact.chittyId null
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recentLog } from '../src/recent-log.ts';
import type {
  Channel,
  CommsDispatch,
  MessagesProvider,
  OwnerIdentity,
  ProviderOperation,
  RawToUnifiedDescriptor,
} from '../src/types.ts';
import { gmailProvider } from '../src/providers.ts';

const OWNER: OwnerIdentity = {
  identifiers: ['owner@example.com'],
  displayName: 'Owner',
  chittyId: null,
};

// Deterministic window
const WIN = { since: '2026-09-01T00:00:00Z', until: '2026-09-30T00:00:00Z' } as const;

function dispatch(map: Record<string, unknown>): CommsDispatch {
  return {
    async call(mcpServerId, tool) {
      const key = `${mcpServerId}/${tool}`;
      if (key in map) return map[key];
      return [];
    },
  };
}

function providerMap(...ps: MessagesProvider[]): Map<Channel, MessagesProvider> {
  const m = new Map<Channel, MessagesProvider>();
  for (const p of ps) m.set(p.channel, p);
  return m;
}

// Minimal MessagesProvider stub for a channel with no reshaper wired in fetchChannel.
const STUB_OP: ProviderOperation = { op: 'stub', inputShape: {} };
const STUB_RAW: RawToUnifiedDescriptor = {
  outputSchemaRef: 'https://schema.chitty.cc/comms/v1/unified-comms-entry.schema.json',
  fieldMap: {},
};

function boundProvider(channel: Channel, mcpServerId: string): MessagesProvider {
  return {
    capability: 'messages',
    channel,
    provider: channel,
    binding: {
      mcpServerId,
      tools: { listMessages: `${channel}_list`, resolveContact: `${channel}_resolve` },
    },
    resolveContact: STUB_OP,
    listMessages: STUB_OP,
    rawToUnified: STUB_RAW,
  };
}

// ── flattenGmail: null / non-object row skip ──────────────────────────────────

describe('recent-log — flattenGmail null-row skip', () => {
  it('skips null rows and parses valid flat message rows alongside them', async () => {
    // dispatch returns [null, validMsg] — flattenGmail must skip null and keep the message
    const flatWithNull = [
      null,
      {
        id: 'gm-valid-001',
        date: '2026-09-10T10:00:00Z',
        sender: 'alice@example.com',
        toRecipients: ['owner@example.com'],
      },
    ];
    const out = await recentLog(
      { identifier: 'alice@example.com', channels: ['email'], ...WIN },
      {
        dispatch: dispatch({ [`chittyagent-google/${gmailProvider.binding!.tools!.listMessages}`]: flatWithNull }),
        owner: OWNER,
        providers: providerMap(gmailProvider),
      },
    );
    const emailCh = out.metadata.channelsQueried.find((c) => c.channel === 'email')!;
    assert.equal(emailCh.ok, true, 'email channel should succeed');
    assert.equal(out.entries.length, 1, 'exactly one entry — null row was skipped');
    assert.equal(out.entries[0].providerMessageId, 'gm-valid-001');
  });
});

// ── flattenGmail: threadId fallback from obj.threadId ────────────────────────

describe('recent-log — flattenGmail obj.threadId fallback', () => {
  it('uses obj.threadId when obj.id is absent from a thread-wrapped row', async () => {
    // Thread object with threadId but no id — threadId should come from obj.threadId
    const threadNoId = [
      {
        // no 'id' field
        threadId: 'tid-from-field',
        messages: [
          {
            id: 'gm-msg-002',
            date: '2026-09-10T11:00:00Z',
            sender: 'bob@example.com',
            toRecipients: ['owner@example.com'],
          },
        ],
      },
    ];
    const out = await recentLog(
      { identifier: 'bob@example.com', channels: ['email'], ...WIN },
      {
        dispatch: dispatch({ [`chittyagent-google/${gmailProvider.binding!.tools!.listMessages}`]: threadNoId }),
        owner: OWNER,
        providers: providerMap(gmailProvider),
      },
    );
    assert.equal(out.entries.length, 1, 'one entry from thread-wrapped message');
    assert.equal(out.entries[0].threadRef, 'tid-from-field', 'threadRef should come from obj.threadId');
  });
});

// ── fetchChannel: bound provider for unhandled channel ───────────────────────

describe('recent-log — fetchChannel unhandled channel', () => {
  it('returns ok:false with "no reshaper wired" when a channel is bound but not quo/email', async () => {
    // 'twilio' has a bound provider but fetchChannel has no reshaper for it
    const twilio = boundProvider('twilio', 'chittyagent-twilio');
    const out = await recentLog(
      { identifier: '+15555550001', channels: ['twilio'], ...WIN },
      {
        dispatch: dispatch({}),
        owner: OWNER,
        providers: providerMap(twilio),
      },
    );
    const ch = out.metadata.channelsQueried.find((c) => c.channel === 'twilio')!;
    assert.equal(ch.ok, false, 'bound-but-unhandled channel must be ok:false');
    assert.match(ch.error ?? '', /no reshaper wired/, 'error must mention "no reshaper wired"');
    assert.equal(ch.count, 0);
    assert.equal(out.entries.length, 0);
  });
});

// ── recentLog: generic unbound channel (not imessage) ────────────────────────

describe('recent-log — generic unbound channel', () => {
  it('returns "no bound provider" error for an unbound channel that is not imessage', async () => {
    // 'voice' is not in the providers map and is not 'imessage'
    const out = await recentLog(
      { identifier: '+15555550001', channels: ['voice'], ...WIN },
      {
        dispatch: dispatch({}),
        owner: OWNER,
        providers: new Map(), // empty — no provider for 'voice'
      },
    );
    const ch = out.metadata.channelsQueried.find((c) => c.channel === 'voice')!;
    assert.equal(ch.ok, false, 'unbound generic channel must be ok:false');
    assert.match(ch.error ?? '', /no bound provider for channel voice/, 'error must name the channel');
    assert.equal(ch.provider, undefined, 'generic unbound channel has no provider field');
  });
});

// ── recentLog: input.person chittyId detection ───────────────────────────────

describe('recent-log — input.person chittyId detection', () => {
  it('sets resolvedContact.chittyId when person matches /-P-/ pattern', async () => {
    const out = await recentLog(
      { person: '03-1-USA-5537-P-2602-0-38', channels: [], ...WIN },
      { dispatch: dispatch({}), owner: OWNER, providers: new Map() },
    );
    assert.equal(
      out.metadata.resolvedContact.chittyId,
      '03-1-USA-5537-P-2602-0-38',
      'chittyId must be the person string when it matches /-P-/',
    );
  });

  it('resolvedContact.chittyId is null when person does not match /-P-/ pattern', async () => {
    const out = await recentLog(
      { person: 'alice@example.com', channels: [], ...WIN },
      { dispatch: dispatch({}), owner: OWNER, providers: new Map() },
    );
    assert.equal(
      out.metadata.resolvedContact.chittyId,
      null,
      'chittyId must be null when person does not contain -P-',
    );
  });
});
