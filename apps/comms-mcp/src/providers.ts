// Bound MessagesProvider descriptors. The combo references the abstract `messages`
// capability; these descriptors carry the late-bound wiring (binding.mcpServerId +
// binding.tools mapping abstract ops → the REAL tool names from schemas/README).
//
// @canon: chittycanon://gov/governance#core-types

import type { Channel, MessagesProvider } from './types.js';

const UNIFIED_REF =
  'https://schema.chitty.cc/comms/v1/unified-comms-entry.schema.json' as const;

/**
 * quo / openphone.
 *
 * binding.tools binds the LOCAL op (`quo_recent_messages_local`) as listMessages.
 * This deliberately avoids two documented live-API bugs (schemas/README § "Real
 * provider-contract bugs found"):
 *   - `quo_list_messages` 400s without a participants[] array (the local-cache
 *     path does not require it).
 *   - `quo_lookup_contact_context` over-asks with maxResults=100 (OpenPhone caps
 *     at 50 → HTTP 400); the combo caps its resolveContact request at ≤50.
 */
export const quoProvider: MessagesProvider = {
  capability: 'messages',
  channel: 'quo',
  provider: 'openphone',
  binding: {
    mcpServerId: 'chittyagent-quo',
    tools: {
      resolveContact: 'quo_lookup_contact_context',
      listMessages: 'quo_recent_messages_local',
      getMessage: 'quo_get_message',
    },
  },
  resolveContact: {
    op: 'resolveContact',
    inputShape: { contact: 'string', maxResults: 50 },
    notes: 'OpenPhone caps maxResults at 50; combo never sends 100 (drift bug).',
  },
  listMessages: {
    op: 'listMessages',
    inputShape: { participants: ['E.164|email'], days: 'number', limit: 'number' },
    notes: 'Local-cache op — no participants[] requirement, reads contextual.messages source=openphone.',
  },
  getMessage: { op: 'getMessage', inputShape: { id: 'external_id' } },
  rawToUnified: {
    outputSchemaRef: UNIFIED_REF,
    deriveDirection: null, // quo emits direction natively
    fieldMap: {
      quo: {
        external_id: 'providerMessageId',
        message_id: 'internalId',
        external_thread_id: 'threadRef',
        direction: 'direction',
        sent_at: 'occurredAt',
        body_text: 'body',
        source: 'source',
        'parties[]': 'participants[] (role->role, identifier->identifier; collapse owner aliases to self=true)',
      },
    },
  },
  supports: {
    transcripts: true,
    nativeDirection: true,
    nativeThreadId: true,
    localCache: true,
  },
};

/**
 * gmail / email.
 *
 * resolveContact + listMessages both bind `search_threads` (a from:/to: query
 * builder), with `get_thread` for body hydration. No native direction — derived
 * by the reshaper from the owner identity bundle.
 */
export const gmailProvider: MessagesProvider = {
  capability: 'messages',
  channel: 'email',
  provider: 'gmail',
  binding: {
    mcpServerId: 'chittyagent-google',
    tools: {
      resolveContact: 'search_threads',
      listMessages: 'search_threads',
      getMessage: 'get_thread',
    },
  },
  resolveContact: {
    op: 'resolveContact',
    inputShape: { q: 'from:<addr> OR to:<addr>' },
    notes: 'Gmail has no contact lookup — resolveContact is a query builder over the raw email identifier.',
  },
  listMessages: {
    op: 'listMessages',
    inputShape: { q: 'gmail search query', after: 'epoch|date', maxResults: 'number' },
  },
  getMessage: { op: 'getMessage', inputShape: { threadId: 'string' } },
  rawToUnified: {
    outputSchemaRef: UNIFIED_REF,
    deriveDirection: 'owner-bundle-is-sender', // #1: gmail direction is derived
    fieldMap: {
      gmail: {
        id: 'providerMessageId',
        '<thread>.id': 'threadRef',
        date: 'occurredAt',
        sender: 'participants[] role=sender',
        'toRecipients[]': 'participants[] role=recipient',
        'ccRecipients[]': 'participants[] role=cc',
        subject: 'subject',
        snippet: 'snippet',
        'labelIds[]': 'labels[]',
        '<derived from owner addr>': 'direction',
      },
    },
  },
  supports: {
    transcripts: false,
    nativeDirection: false,
    nativeThreadId: true,
    localCache: false,
  },
};

/**
 * imessage — KNOWN BUT UNBOUND.
 *
 * Deliberately NOT a usable binding. The hand-built precursor
 * `imessage_unified_with_quo` currently ERRORS on this node (`column m.id does not
 * exist` / `relation communications.imessages does not exist` — schemas/README
 * § "Real provider-contract bugs found"). That drift is itself the Alchemist
 * signal that the composite outgrew its host and belongs here. Per the README,
 * the iMessage row shape is descriptor-derived & UNVERIFIED on this node: it would
 * read the SAME canonical contextual.messages + party_identifiers relation as quo
 * (channel discriminated by source), so the quo reshaper would apply once a
 * working backend exists. We do NOT fake it. Requesting `imessage` degrades to
 * channelsQueried[].ok=false (no silent fallback, no fabricated rows).
 */
export const imessageProviderUnbound: Pick<MessagesProvider, 'capability' | 'channel' | 'provider'> & {
  bound: false;
  reason: string;
} = {
  capability: 'messages',
  channel: 'imessage',
  provider: 'imessage-local',
  bound: false,
  reason:
    'imessage_unified_with_quo / imessage_top_contacts error on this node ' +
    '(column m.id does not exist / relation communications.imessages does not exist). ' +
    'No working backend to bind — channel degrades to ok:false rather than fake data.',
};

/** Default registry of bound providers, keyed by channel. */
export function defaultBoundProviders(): Map<Channel, MessagesProvider> {
  const m = new Map<Channel, MessagesProvider>();
  m.set('quo', quoProvider);
  m.set('email', gmailProvider);
  return m;
}
