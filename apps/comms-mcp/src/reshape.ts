// PURE rawToUnified reshapers — one per provider, grounded in the REAL observed
// field shapes documented in apps/comms-mcp/schemas/README.md § "Real backend
// shapes observed". No invented fields. These are the ONLY brittle surface
// (ALCHEMICAL_PROMOTION.md §2b): a new/changed provider regenerates JUST this.
//
// The 6 documented divergences implemented here (schemas/README §"Where real
// shapes DIVERGE"):
//   1. gmail direction derivation (owner-bundle-is-sender test)
//   2. quo owner-alias collapse → single self=true counterparty (largest reshape)
//   3. thread-ref normalization (quo external_thread_id / gmail thread id)
//   4. id-namespace split (providerMessageId vs internalId)
//   5. body|snippet union (always emit a snippet; body when available)
//   6. subject/transcriptRef null-elsewhere (email-only / voice-only)
//
// @canon: chittycanon://gov/governance#core-types — participants are Person (P).

import type { CommParty, OwnerIdentity, UnifiedCommsEntry } from './types.js';

const SNIPPET_MAX = 140;

/** Normalize an identifier for owner-bundle membership testing. */
function normId(id: string): string {
  const t = id.trim();
  if (t.includes('@')) return t.toLowerCase();
  // E.164 / phone: keep digits and leading +, drop spacing/punctuation.
  return t.replace(/[^\d+]/g, '');
}

function identifierKind(id: string): CommParty['identifierKind'] {
  if (id.includes('@')) return 'email';
  if (/^\+?\d[\d\s().-]+$/.test(id)) return 'phone';
  return 'handle';
}

function deriveSnippet(body: string | undefined, snippet: string | undefined): string | undefined {
  // Divergence #5: gmail returns snippet directly; quo/imessage have full body
  // which we truncate. At least one of body|snippet should be present.
  if (snippet && snippet.trim()) return snippet;
  if (body && body.trim()) {
    return body.length > SNIPPET_MAX ? `${body.slice(0, SNIPPET_MAX).trimEnd()}…` : body;
  }
  return undefined;
}

/** True when `id` belongs to the owner identity bundle. */
function isSelf(id: string, owner: OwnerIdentity): boolean {
  const n = normId(id);
  return owner.identifiers.some((o) => normId(o) === n);
}

// ---- quo / openphone -----------------------------------------------------------
// Real shape (quo_recent_messages_local, reads contextual.messages where
// source='openphone'): { message_id, external_id (AC…), external_thread_id (AC…),
// direction (inbound|outbound), body_text, sent_at (RFC3339), parties[]
// {role: sender|recipient, identifier (E.164|email)}, source }.

export interface QuoRawParty {
  role: 'sender' | 'recipient' | string;
  identifier: string;
}

export interface QuoRawRow {
  message_id?: string;
  external_id?: string;
  external_thread_id?: string;
  direction?: 'inbound' | 'outbound' | string;
  body_text?: string;
  sent_at?: string;
  parties?: QuoRawParty[];
  source?: string;
  [k: string]: unknown;
}

export function quoRawToUnified(row: QuoRawRow, owner: OwnerIdentity): UnifiedCommsEntry {
  if (!row.external_id) throw new Error('quo row missing external_id (providerMessageId)');
  if (!row.sent_at) throw new Error('quo row missing sent_at (occurredAt)');
  if (row.direction !== 'inbound' && row.direction !== 'outbound') {
    throw new Error(`quo row has non-canonical direction: ${String(row.direction)}`);
  }

  const rawParties = row.parties ?? [];

  // Divergence #2 (the largest reshape): quo parties[] carries the owner's ~30
  // alias identifiers on every row. Collapse all owner-owned identifiers into a
  // SINGLE self=true counterparty; keep distinct non-self counterparties as-is.
  const counterparties: CommParty[] = [];
  let ownerRole: CommParty['role'] | undefined;
  let ownerIdentifier: string | undefined;
  const seenCounter = new Set<string>();

  for (const p of rawParties) {
    const role: CommParty['role'] = p.role === 'recipient' ? 'recipient' : 'sender';
    if (isSelf(p.identifier, owner)) {
      // Remember the role/identifier of the owner on this row; do not emit 30 parties.
      if (ownerIdentifier === undefined) {
        ownerRole = role;
        ownerIdentifier = p.identifier;
      }
      continue;
    }
    const key = `${role}:${normId(p.identifier)}`;
    if (seenCounter.has(key)) continue;
    seenCounter.add(key);
    counterparties.push({
      role,
      identifier: p.identifier,
      identifierKind: identifierKind(p.identifier),
      self: false,
    });
  }

  const participants: CommParty[] = [];
  if (ownerIdentifier !== undefined) {
    participants.push({
      // Owner role: on an outbound message the owner is the sender; inbound = recipient.
      role: ownerRole ?? (row.direction === 'outbound' ? 'sender' : 'recipient'),
      identifier: ownerIdentifier,
      identifierKind: identifierKind(ownerIdentifier),
      self: true,
      displayName: owner.displayName ?? null,
      chittyId: owner.chittyId ?? null,
    });
  }
  participants.push(...counterparties);

  // participants requires minItems 1 — if neither side resolved (degenerate row),
  // surface the raw parties rather than fabricate.
  if (participants.length === 0) {
    for (const p of rawParties) {
      participants.push({
        role: p.role === 'recipient' ? 'recipient' : 'sender',
        identifier: p.identifier,
        identifierKind: identifierKind(p.identifier),
        self: false,
      });
    }
  }
  if (participants.length === 0) {
    throw new Error('quo row produced no participants');
  }

  const entry: UnifiedCommsEntry = {
    channel: 'quo',
    provider: row.source === 'openphone' ? 'openphone' : (row.source ?? 'openphone'),
    providerMessageId: row.external_id, // #4: provider namespace
    direction: row.direction, // quo emits direction natively (#1 not needed here)
    occurredAt: row.sent_at,
    participants,
    // #6: SMS has no subject / no transcript — null elsewhere.
    subject: null,
    transcriptRef: null,
    source: row.source,
  };
  if (row.message_id) entry.internalId = row.message_id; // #4: internal surrogate
  if (row.external_thread_id) entry.threadRef = row.external_thread_id; // #3
  if (row.body_text) entry.body = row.body_text; // #5
  const snip = deriveSnippet(row.body_text, undefined);
  if (snip) entry.snippet = snip;
  return entry;
}

// ---- gmail ---------------------------------------------------------------------
// Real shape (search_threads / get_thread): per-message { id, date (RFC3339),
// sender, toRecipients[], ccRecipients[], subject, snippet, labelIds[] } plus the
// owning thread id. NO native direction — derived (#1).

export interface GmailRawMessage {
  id?: string;
  threadId?: string;
  date?: string;
  sender?: string;
  toRecipients?: string[];
  ccRecipients?: string[];
  subject?: string;
  snippet?: string;
  body?: string;
  plaintext_body?: string;
  labelIds?: string[];
  [k: string]: unknown;
}

/** Parse "Display Name <addr@host>" or bare "addr@host" → { addr, name } */
function parseEmailParty(raw: string): { addr: string; name: string | null } {
  const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].replace(/^"|"$/g, '').trim();
    return { addr: m[2].trim(), name: name || null };
  }
  return { addr: raw.trim(), name: null };
}

export function gmailRawToUnified(
  msg: GmailRawMessage,
  owner: OwnerIdentity,
  threadId?: string,
): UnifiedCommsEntry {
  if (!msg.id) throw new Error('gmail message missing id (providerMessageId)');
  if (!msg.date) throw new Error('gmail message missing date (occurredAt)');

  const participants: CommParty[] = [];
  const pushParty = (raw: string, role: CommParty['role']) => {
    const { addr, name } = parseEmailParty(raw);
    if (!addr) return;
    const self = isSelf(addr, owner);
    participants.push({
      role,
      identifier: addr,
      identifierKind: 'email',
      self,
      displayName: self ? (owner.displayName ?? name) : name,
      chittyId: self ? (owner.chittyId ?? null) : null,
    });
  };

  if (msg.sender) pushParty(msg.sender, 'sender');
  for (const to of msg.toRecipients ?? []) pushParty(to, 'recipient');
  for (const cc of msg.ccRecipients ?? []) pushParty(cc, 'cc');

  if (participants.length === 0) {
    throw new Error('gmail message produced no participants');
  }

  // Divergence #1: gmail has no native direction. Derive: if the owner bundle
  // appears as the sender, it's outbound; otherwise inbound.
  const senderParty = participants.find((p) => p.role === 'sender');
  const direction: UnifiedCommsEntry['direction'] =
    senderParty && senderParty.self ? 'outbound' : 'inbound';

  const body = msg.body ?? msg.plaintext_body; // #5: body only under FULL_CONTENT
  const entry: UnifiedCommsEntry = {
    channel: 'email',
    provider: 'gmail',
    providerMessageId: msg.id, // #4
    direction,
    occurredAt: msg.date,
    participants,
    // #6: email HAS subject (null only when truly absent); no transcript.
    subject: msg.subject ?? null,
    transcriptRef: null,
  };
  // #3: thread ref from get_thread / search_threads
  const tref = msg.threadId ?? threadId;
  if (tref) entry.threadRef = tref;
  if (body) entry.body = body;
  const snip = deriveSnippet(body, msg.snippet);
  if (snip) entry.snippet = snip;
  if (msg.labelIds && msg.labelIds.length) entry.labels = msg.labelIds;
  return entry;
}
