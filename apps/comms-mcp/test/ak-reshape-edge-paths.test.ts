/**
 * test(AK): reshape.ts uncovered edge paths — quoRawToUnified + gmailRawToUnified
 *
 * Covers branches not exercised by reshape.test.ts (happy paths):
 *
 *   quoRawToUnified:
 *     1. Missing external_id → throws
 *     2. Missing sent_at → throws
 *     3. Empty parties array → throws "no participants"
 *     4. No parties key at all → throws "no participants"
 *     5. Degenerate row: no self matches, non-self parties → raw parties fallback path
 *     6. No message_id → internalId absent from result
 *     7. No external_thread_id → threadRef absent from result
 *     8. No body_text → body absent; snippet undefined
 *     9. Long body_text → snippet truncated at 140 chars with ellipsis
 *    10. Source != 'openphone' → provider field reflects raw source
 *    11. Duplicate non-owner counterparties → collapsed to one via seenCounter
 *    12. Phone identifier with formatting chars → normId matches owner bundle
 *
 *   gmailRawToUnified:
 *    13. Missing id → throws
 *    14. Missing date → throws
 *    15. No sender + no recipients → throws "no participants"
 *    16. body preferred over plaintext_body when both present
 *    17. plaintext_body used when body absent
 *    18. No snippet, short body → snippet derived from body
 *    19. No snippet, long body → snippet truncated at 140 chars
 *    20. Explicit threadId param used when msg.threadId absent
 *    21. No labels → labels absent from result
 *    22. Empty ccRecipients → no cc parties
 *    23. Bare email address (no "Name <addr>" wrapper) → addr parsed, name null
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  quoRawToUnified,
  gmailRawToUnified,
  type QuoRawRow,
  type GmailRawMessage,
} from '../src/reshape.ts';
import type { OwnerIdentity } from '../src/types.ts';

const OWNER: OwnerIdentity = {
  identifiers: ['+15555550000', 'owner@example.com'],
  displayName: 'Owner',
  chittyId: null,
};

const BASE_QUO: QuoRawRow = {
  external_id: 'OP-base-001',
  sent_at: '2026-09-05T10:00:00Z',
  direction: 'inbound',
  parties: [
    { role: 'sender', identifier: '+15555550001' },
    { role: 'recipient', identifier: '+15555550000' },
  ],
  source: 'openphone',
};

const BASE_GMAIL: GmailRawMessage = {
  id: 'gm-base-001',
  date: '2026-09-05T10:00:00Z',
  sender: 'alice@example.com',
  toRecipients: ['owner@example.com'],
};

// ── quoRawToUnified: error paths ──────────────────────────────────────────────

describe('quoRawToUnified — required-field errors', () => {
  it('throws when external_id is missing', () => {
    const row: QuoRawRow = { ...BASE_QUO, external_id: undefined };
    assert.throws(() => quoRawToUnified(row, OWNER), /external_id/);
  });

  it('throws when sent_at is missing', () => {
    const row: QuoRawRow = { ...BASE_QUO, sent_at: undefined };
    assert.throws(() => quoRawToUnified(row, OWNER), /sent_at/);
  });

  it('throws "no participants" when parties array is empty', () => {
    const row: QuoRawRow = { ...BASE_QUO, parties: [] };
    assert.throws(() => quoRawToUnified(row, OWNER), /no participants/);
  });

  it('throws "no participants" when parties key is absent', () => {
    const row: QuoRawRow = { ...BASE_QUO, parties: undefined };
    assert.throws(() => quoRawToUnified(row, OWNER), /no participants/);
  });
});

// ── quoRawToUnified: degenerate fallback path ─────────────────────────────────

describe('quoRawToUnified — degenerate parties fallback', () => {
  it('emits raw parties when no owner match and no counterparty (unknown identifiers only)', () => {
    // None of these identifiers are in OWNER.identifiers, so isSelf returns false
    // for all. ownerIdentifier stays undefined → participants starts empty →
    // falls back to raw parties path rather than throwing.
    const row: QuoRawRow = {
      ...BASE_QUO,
      parties: [
        { role: 'sender', identifier: '+19995550001' },
        { role: 'recipient', identifier: '+19995550002' },
      ],
    };
    const e = quoRawToUnified(row, OWNER);
    assert.equal(e.participants.length, 2);
    assert.ok(e.participants.every((p) => p.self === false), 'all parties are non-self in fallback');
  });
});

// ── quoRawToUnified: optional fields absent ───────────────────────────────────

describe('quoRawToUnified — optional fields', () => {
  it('internalId absent when message_id not provided', () => {
    const row: QuoRawRow = { ...BASE_QUO, message_id: undefined };
    const e = quoRawToUnified(row, OWNER);
    assert.equal(e.internalId, undefined);
  });

  it('threadRef absent when external_thread_id not provided', () => {
    const row: QuoRawRow = { ...BASE_QUO, external_thread_id: undefined };
    const e = quoRawToUnified(row, OWNER);
    assert.equal(e.threadRef, undefined);
  });

  it('body absent and snippet undefined when body_text not provided', () => {
    const row: QuoRawRow = { ...BASE_QUO, body_text: undefined };
    const e = quoRawToUnified(row, OWNER);
    assert.equal(e.body, undefined);
    assert.equal(e.snippet, undefined);
  });

  it('snippet truncated at 140 chars with ellipsis when body_text is long', () => {
    const longBody = 'A'.repeat(200);
    const row: QuoRawRow = { ...BASE_QUO, body_text: longBody };
    const e = quoRawToUnified(row, OWNER);
    assert.ok(e.snippet, 'snippet should be present');
    assert.ok(e.snippet!.length <= 145, 'snippet should not exceed 140 + ellipsis length');
    assert.ok(e.snippet!.endsWith('…'), 'snippet should end with ellipsis');
    assert.equal(e.body, longBody, 'full body preserved despite truncated snippet');
  });

  it('provider reflects raw source value when source is not openphone', () => {
    const row: QuoRawRow = { ...BASE_QUO, source: 'imessage' };
    const e = quoRawToUnified(row, OWNER);
    assert.equal(e.provider, 'imessage');
  });
});

// ── quoRawToUnified: counterparty deduplication ───────────────────────────────

describe('quoRawToUnified — counterparty deduplication', () => {
  it('collapses duplicate non-owner counterparties with same role to one', () => {
    const row: QuoRawRow = {
      ...BASE_QUO,
      parties: [
        { role: 'sender', identifier: '+15555550001' },
        { role: 'sender', identifier: '+15555550001' }, // duplicate
        { role: 'recipient', identifier: '+15555550000' }, // owner
      ],
    };
    const e = quoRawToUnified(row, OWNER);
    const senders = e.participants.filter((p) => p.role === 'sender');
    assert.equal(senders.length, 1, 'duplicate counterparty collapsed to one');
    assert.equal(senders[0].identifier, '+15555550001');
  });
});

// ── quoRawToUnified: normId phone formatting ──────────────────────────────────

describe('quoRawToUnified — phone normalization in owner matching', () => {
  it('owner identifier with formatting chars (spaces/dashes) still matches bundle', () => {
    const ownerWithFormatted: OwnerIdentity = {
      identifiers: ['+1-555-555-0000', 'owner@example.com'],
      displayName: 'Owner',
      chittyId: null,
    };
    // The counterparty matches the raw owner identifier format after normId strips non-digit/+
    const row: QuoRawRow = {
      ...BASE_QUO,
      parties: [
        { role: 'sender', identifier: '+15555550001' },
        { role: 'recipient', identifier: '+15555550000' }, // maps to owner after normId
      ],
    };
    const e = quoRawToUnified(row, ownerWithFormatted);
    const selves = e.participants.filter((p) => p.self);
    assert.equal(selves.length, 1, 'formatted owner identifier still recognized as self');
  });
});

// ── gmailRawToUnified: error paths ────────────────────────────────────────────

describe('gmailRawToUnified — required-field errors', () => {
  it('throws when id is missing', () => {
    const msg: GmailRawMessage = { ...BASE_GMAIL, id: undefined };
    assert.throws(() => gmailRawToUnified(msg, OWNER), /id/);
  });

  it('throws when date is missing', () => {
    const msg: GmailRawMessage = { ...BASE_GMAIL, date: undefined };
    assert.throws(() => gmailRawToUnified(msg, OWNER), /date/);
  });

  it('throws "no participants" when no sender and no recipients', () => {
    const msg: GmailRawMessage = {
      id: 'gm-empty-001',
      date: '2026-09-05T10:00:00Z',
      sender: undefined,
      toRecipients: [],
      ccRecipients: [],
    };
    assert.throws(() => gmailRawToUnified(msg, OWNER), /no participants/);
  });
});

// ── gmailRawToUnified: body / plaintext_body fallback ────────────────────────

describe('gmailRawToUnified — body field resolution', () => {
  it('body preferred over plaintext_body when both present', () => {
    const msg: GmailRawMessage = {
      ...BASE_GMAIL,
      body: 'full html body',
      plaintext_body: 'plain text fallback',
    };
    const e = gmailRawToUnified(msg, OWNER);
    assert.equal(e.body, 'full html body');
  });

  it('plaintext_body used when body absent', () => {
    const msg: GmailRawMessage = {
      ...BASE_GMAIL,
      body: undefined,
      plaintext_body: 'plain text only',
    };
    const e = gmailRawToUnified(msg, OWNER);
    assert.equal(e.body, 'plain text only');
  });
});

// ── gmailRawToUnified: snippet derivation ────────────────────────────────────

describe('gmailRawToUnified — snippet derivation', () => {
  it('snippet derived from short body when snippet field absent', () => {
    const msg: GmailRawMessage = {
      ...BASE_GMAIL,
      snippet: undefined,
      body: 'Short body text',
    };
    const e = gmailRawToUnified(msg, OWNER);
    assert.equal(e.snippet, 'Short body text');
  });

  it('snippet truncated at 140 chars when body is long and no snippet field', () => {
    const longBody = 'B'.repeat(200);
    const msg: GmailRawMessage = {
      ...BASE_GMAIL,
      snippet: undefined,
      body: longBody,
    };
    const e = gmailRawToUnified(msg, OWNER);
    assert.ok(e.snippet, 'snippet present from long body');
    assert.ok(e.snippet!.endsWith('…'), 'truncated with ellipsis');
    assert.ok(e.snippet!.length <= 145);
  });
});

// ── gmailRawToUnified: optional fields ───────────────────────────────────────

describe('gmailRawToUnified — optional fields', () => {
  it('uses explicit threadId param when msg.threadId absent', () => {
    const msg: GmailRawMessage = { ...BASE_GMAIL, threadId: undefined };
    const e = gmailRawToUnified(msg, OWNER, 'explicit-thread-id');
    assert.equal(e.threadRef, 'explicit-thread-id');
  });

  it('labels absent from result when labelIds not provided', () => {
    const msg: GmailRawMessage = { ...BASE_GMAIL, labelIds: undefined };
    const e = gmailRawToUnified(msg, OWNER);
    assert.equal(e.labels, undefined);
  });

  it('empty ccRecipients produces no cc parties', () => {
    const msg: GmailRawMessage = { ...BASE_GMAIL, ccRecipients: [] };
    const e = gmailRawToUnified(msg, OWNER);
    const cc = e.participants.filter((p) => p.role === 'cc');
    assert.equal(cc.length, 0);
  });
});

// ── gmailRawToUnified: parseEmailParty bare address ──────────────────────────

describe('gmailRawToUnified — bare email address parsing', () => {
  it('parses bare address (no display name) — identifier set, displayName null for non-owner', () => {
    const msg: GmailRawMessage = {
      ...BASE_GMAIL,
      sender: 'bare@example.com', // no "Name <addr>" wrapper
    };
    const e = gmailRawToUnified(msg, OWNER);
    const sender = e.participants.find((p) => p.role === 'sender');
    assert.equal(sender?.identifier, 'bare@example.com');
    assert.equal(sender?.displayName, null);
  });
});
