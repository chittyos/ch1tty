/**
 * BT: branch gaps in comms-mcp — 2 coverage paths:
 *
 * 1. recent-log.ts:156 — fetchChannel catch: thrown value is NOT an Error → String(err)
 * 2. recent-log.ts:176 — seedIdentifier is undefined (no identifier, no person) → identifiers:[]
 *
 * Note: server.ts:91 String(err) branch is structurally unreachable (all in-process throws use
 * new Error()) and is suppressed with a c8 ignore annotation instead.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recentLog } from '../src/recent-log.ts';
import type {
  Channel,
  CommsDispatch,
  MessagesProvider,
  OwnerIdentity,
  ProviderBinding,
} from '../src/types.ts';

const OWNER: OwnerIdentity = {
  identifiers: ['owner@example.com'],
  displayName: 'Owner',
  chittyId: null,
};

const WIN = { since: '2026-09-01T00:00:00Z', until: '2026-09-30T00:00:00Z' } as const;

const UNIFIED_REF =
  'https://schema.chitty.cc/comms/v1/unified-comms-entry.schema.json' as const;

function makeDispatch(handler: CommsDispatch['call']): CommsDispatch {
  return { call: handler };
}

function makeBoundProvider(channel: Channel): MessagesProvider {
  const binding: ProviderBinding = {
    mcpServerId: `chittyagent-${channel}`,
    tools: { listMessages: 'listMessages' },
  };
  return {
    capability: 'messages',
    channel,
    provider: channel,
    binding,
    resolveContact: { op: 'resolveContact', inputShape: {} },
    listMessages: { op: 'listMessages', inputShape: {} },
    rawToUnified: {
      outputSchemaRef: UNIFIED_REF,
      fieldMap: {},
    },
  };
}

// ── 1. recent-log.ts:156 — fetchChannel catch: non-Error thrown ───────────────

describe('recent-log.ts:156 — fetchChannel catch: non-Error thrown', () => {
  it('returns ok:false with String(err) as error when dispatch throws a number', async () => {
    const dispatch = makeDispatch(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 42;
    });

    const provider = makeBoundProvider('quo');
    const providers = new Map<Channel, MessagesProvider>([['quo', provider]]);

    const out = await recentLog(
      { identifier: '+15555550001', channels: ['quo'], ...WIN },
      { dispatch, owner: OWNER, providers },
    );

    const ch = out.metadata.channelsQueried.find((c) => c.channel === 'quo')!;
    assert.ok(ch, 'quo channel entry must exist');
    assert.equal(ch.ok, false, 'channel must be ok:false');
    assert.equal(ch.error, '42', 'error must be String(42)');
  });
});

// ── 2. recent-log.ts:176 — seedIdentifier undefined → identifiers:[] ──────────

describe('recent-log.ts:176 — seedIdentifier undefined → identifiers:[]', () => {
  it('resolves without error when neither identifier nor person is provided', async () => {
    const dispatch = makeDispatch(async () => []);
    const provider = makeBoundProvider('quo');
    const providers = new Map<Channel, MessagesProvider>([['quo', provider]]);

    const out = await recentLog(
      { channels: ['quo'], ...WIN },
      { dispatch, owner: OWNER, providers },
    );

    assert.ok(out, 'recentLog must return a result');
    const ch = out.metadata.channelsQueried.find((c) => c.channel === 'quo');
    assert.ok(ch, 'quo channel entry must exist');
  });
});
