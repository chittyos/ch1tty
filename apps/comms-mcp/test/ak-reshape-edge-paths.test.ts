/**
 * test(AK): reshape.ts additional edge paths — quoRawToUnified + gmailRawToUnified
 *
 * Covers branches not exercised by reshape.test.ts (happy paths) or the BF
 * branch-gaps additions to that file. BF (f68cef8) already covers: missing
 * external_id/sent_at throws, empty parties throws, counterparty dedup, non-
 * openphone source, missing id/date throws, no-participants throws, plaintext_body
 * fallback, threadId arg. This file covers the remaining gaps:
 *
 *   quoRawToUnified:
 *     1. Absent parties key (undefined) → throws "no participants"
 *     2. Degenerate row (no self match, all unknown IDs) → raw parties fallback
 *     3. No message_id → internalId absent
 *     4. No external_thread_id → threadRef absent
 *     5. No body_text → body absent, snippet undefined
 *     6. Long body_text → snippet truncated at 140 chars with ellipsis
 *     7. Phone with formatting chars in owner bundle → normId strips to match
 *
 *   gmailRawToUnified:
 *     8. body preferred over plaintext_body when both present
 *     9. No snippet field, short body → snippet derived from body
 *    10. No snippet field, long body → snippet truncated at 140 chars
 *    11. Labels absent from result when labelIds not provided
 *    12. Empty ccRecipients → no cc parties
 *    13. Bare email address (no "Name <addr>") → identifier set, displayName null
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

// ── quoRawToUnified: absent parties key (distinct from empty array) ───────────

describe('quoRawToUnified — absent parties key', () => {
  it('throws "no participants" when parties key is absent (undefined)', () => {
    const row: QuoRawRow = { ...BASE_QUO, parties: undefined };
    assert.throws(() => quoRawToUnified(row, OWNER), /no participants/);
  });
});

// ── quoRawToUnified: degenerate fallback path ─────────────────────────────────

describe('quoRawToUnified — degenerate parties fallback', () => {
  it('emits raw parties when no party matches owner bundle (unknown identifiers)', () => {
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
    assert.ok(e.participants.every((p) => p.self === false), 'all parties non-self in fallback');
  });
});

// ── quoRawToUnified: optional fields absent ───────────────────────────────────

describe('quoRawToUnified — optional fields absent', () => {
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
    assert.ok(e.snippet, 'snippet present');
    assert.ok(e.snippet!.endsWith('…'), 'snippet ends with ellipsis');
    assert.ok(e.snippet!.length <= 145, 'snippet within truncation range');
    assert.equal(e.body, longBody, 'full body preserved despite truncated snippet');
  });
});

// ── quoRawToUnified: phone normId with formatting chars ───────────────────────

describe('quoRawToUnified — phone normId formatting', () => {
  it('formatted phone in owner bundle (dashes/spaces) still recognized as self', () => {
    const ownerWithFormatted: OwnerIdentity = {
      identifiers: ['+1-555-555-0000', 'owner@example.com'],
      displayName: 'Owner',
      chittyId: null,
    };
    const row: QuoRawRow = {
      ...BASE_QUO,
      parties: [
        { role: 'sender', identifier: '+15555550001' },
        { role: 'recipient', identifier: '+15555550000' }, // normId strips dashes to match
      ],
    };
    const e = quoRawToUnified(row, ownerWithFormatted);
    const selves = e.participants.filter((p) => p.self);
    assert.equal(selves.length, 1, 'formatted owner phone still recognized as self');
  });
});

// ── gmailRawToUnified: body vs plaintext_body preference ─────────────────────

describe('gmailRawToUnified — body field preference', () => {
  it('body preferred over plaintext_body when both present', () => {
    const msg: GmailRawMessage = {
      ...BASE_GMAIL,
      body: 'primary body content',
      plaintext_body: 'fallback text',
    };
    const e = gmailRawToUnified(msg, OWNER);
    assert.equal(e.body, 'primary body content');
  });
});

// ── gmailRawToUnified: snippet derivation from body ──────────────────────────

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

  it('snippet truncated at 140 chars when body is long and snippet field absent', () => {
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

// ── gmailRawToUnified: bare email address parsing ────────────────────────────

describe('gmailRawToUnified — bare email address parsing', () => {
  it('bare address (no "Name <addr>") → identifier set, displayName null for non-owner', () => {
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
