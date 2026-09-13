import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { quoRawToUnified, gmailRawToUnified, type QuoRawRow, type GmailRawMessage } from '../src/reshape.ts';
import type { OwnerIdentity } from '../src/types.ts';
import { validateUnifiedEntry, assertValid } from './ajv-harness.ts';

// Owner identity bundle — production-shaped self-identifiers (the alias bundle the
// reshaper collapses to one self=true party).
const OWNER: OwnerIdentity = {
  identifiers: ['+13125551212', '+13125559999', 'nick@nevershitty.com', 'nick@chitty.cc'],
  displayName: 'Nick',
  chittyId: '03-1-USA-5537-P-2602-0-38',
};

// Real quo_recent_messages_local shape (contextual.messages source=openphone).
const QUO_ROW_INBOUND: QuoRawRow = {
  message_id: '16884',
  external_id: 'OPdf1a2b3c4d5e6f7a8b9c0d1e2f3a4b5',
  external_thread_id: 'OPthread9988776655443322110099887',
  direction: 'inbound',
  body_text: 'Hey, are we still meeting Thursday about the closing docs?',
  sent_at: '2026-06-10T15:42:03Z',
  parties: [
    { role: 'sender', identifier: '+13122186717' },
    // owner alias bundle on every row — the largest reshape collapses these:
    { role: 'recipient', identifier: '+13125551212' },
    { role: 'recipient', identifier: '+13125559999' },
    { role: 'recipient', identifier: 'nick@nevershitty.com' },
  ],
  source: 'openphone',
};

const QUO_ROW_OUTBOUND: QuoRawRow = {
  message_id: '16885',
  external_id: 'OPaa11bb22cc33dd44ee55ff6600112233',
  external_thread_id: 'OPthread9988776655443322110099887',
  direction: 'outbound',
  body_text: 'Yes — 2pm works. Bring the ALTA statement.',
  sent_at: '2026-06-10T15:50:11Z',
  parties: [
    { role: 'sender', identifier: '+13125551212' },
    { role: 'recipient', identifier: '+13122186717' },
  ],
  source: 'openphone',
};

// Real gmail search_threads / get_thread shape.
const GMAIL_INBOUND: GmailRawMessage = {
  id: '18f2a9c4b7e1d6a3',
  threadId: '18f2a9c4b7e1d600',
  date: '2026-06-09T09:12:44Z',
  sender: 'Maria Bianchi <maria.bianchi@example-law.com>',
  toRecipients: ['nick@nevershitty.com'],
  ccRecipients: ['paralegal@example-law.com'],
  subject: 'Re: Closing disclosure — wire instructions',
  snippet: 'Attached is the revised closing disclosure with the corrected wire instructions.',
  labelIds: ['INBOX', 'IMPORTANT'],
};

const GMAIL_OUTBOUND: GmailRawMessage = {
  id: '18f2a9c4b7e1d6ff',
  threadId: '18f2a9c4b7e1d600',
  date: '2026-06-09T10:05:00Z',
  sender: 'nick@chitty.cc',
  toRecipients: ['maria.bianchi@example-law.com'],
  subject: 'Re: Closing disclosure — wire instructions',
  snippet: 'Got it, thanks. Confirming the wire goes out tomorrow morning.',
  labelIds: ['SENT'],
};

describe('quoRawToUnified', () => {
  it('produces a schema-valid entry and collapses owner aliases to one self party (divergence #2)', () => {
    const e = quoRawToUnified(QUO_ROW_INBOUND, OWNER);
    assertValid(validateUnifiedEntry, e, 'quo inbound');
    const selves = e.participants.filter((p) => p.self);
    assert.equal(selves.length, 1, 'exactly one self party despite 3 owner aliases');
    assert.equal(selves[0].chittyId, '03-1-USA-5537-P-2602-0-38');
    const counter = e.participants.filter((p) => !p.self);
    assert.equal(counter.length, 1);
    assert.equal(counter[0].identifier, '+13122186717');
  });

  it('keeps direction native, splits id namespaces, normalizes thread ref (divergences #1,#3,#4)', () => {
    const e = quoRawToUnified(QUO_ROW_INBOUND, OWNER);
    assert.equal(e.direction, 'inbound');
    assert.equal(e.providerMessageId, 'OPdf1a2b3c4d5e6f7a8b9c0d1e2f3a4b5'); // external_id
    assert.equal(e.internalId, '16884'); // message_id
    assert.equal(e.threadRef, 'OPthread9988776655443322110099887');
    assert.equal(e.channel, 'quo');
    assert.equal(e.provider, 'openphone');
    assert.equal(e.source, 'openphone');
  });

  it('emits body AND a snippet, null subject + transcriptRef (divergences #5,#6)', () => {
    const e = quoRawToUnified(QUO_ROW_INBOUND, OWNER);
    assert.ok(e.body && e.body.length > 0);
    assert.ok(e.snippet && e.snippet.length > 0);
    assert.equal(e.subject, null);
    assert.equal(e.transcriptRef, null);
  });

  it('validates the outbound row too', () => {
    const e = quoRawToUnified(QUO_ROW_OUTBOUND, OWNER);
    assertValid(validateUnifiedEntry, e, 'quo outbound');
    assert.equal(e.direction, 'outbound');
  });

  it('throws on a non-canonical direction rather than guessing', () => {
    assert.throws(() => quoRawToUnified({ ...QUO_ROW_INBOUND, direction: 'unknown' }, OWNER), /direction/);
  });
});

describe('quoRawToUnified — branch gaps', () => {
  it('throws when external_id is missing', () => {
    const row = { ...QUO_ROW_INBOUND, external_id: undefined };
    assert.throws(() => quoRawToUnified(row, OWNER), /external_id/);
  });

  it('throws when sent_at is missing', () => {
    const row = { ...QUO_ROW_INBOUND, sent_at: undefined };
    assert.throws(() => quoRawToUnified(row, OWNER), /sent_at/);
  });

  it('throws when parties is empty (no participants reachable)', () => {
    const row: QuoRawRow = {
      external_id: 'OPxxx',
      sent_at: '2026-01-01T00:00:00Z',
      direction: 'inbound',
      parties: [],
    };
    assert.throws(() => quoRawToUnified(row, OWNER), /no participants/);
  });

  it('deduplicates repeated non-self counterparty (seenCounter path)', () => {
    const row: QuoRawRow = {
      ...QUO_ROW_INBOUND,
      parties: [
        { role: 'sender', identifier: '+13122186717' },
        { role: 'sender', identifier: '+13122186717' }, // duplicate — seenCounter skips it
        { role: 'recipient', identifier: '+13125551212' }, // owner alias
      ],
    };
    const e = quoRawToUnified(row, OWNER);
    const nonSelf = e.participants.filter((p) => !p.self);
    assert.equal(nonSelf.length, 1, 'duplicate counterparty collapsed to one');
    assert.equal(nonSelf[0].identifier, '+13122186717');
  });

  it('assigns identifierKind "handle" for non-email non-phone identifiers', () => {
    const row: QuoRawRow = {
      ...QUO_ROW_INBOUND,
      parties: [
        { role: 'sender', identifier: 'slack:U123456' }, // handle — neither email nor E.164
        { role: 'recipient', identifier: '+13125551212' }, // owner alias
      ],
    };
    const e = quoRawToUnified(row, OWNER);
    const handle = e.participants.find((p) => !p.self);
    assert.equal(handle?.identifierKind, 'handle');
  });

  it('uses source value as provider when source is not "openphone"', () => {
    const row: QuoRawRow = { ...QUO_ROW_INBOUND, source: 'twilio' };
    const e = quoRawToUnified(row, OWNER);
    assert.equal(e.provider, 'twilio');
  });
});

describe('gmailRawToUnified', () => {
  it('derives inbound direction (owner not sender) — divergence #1', () => {
    const e = gmailRawToUnified(GMAIL_INBOUND, OWNER);
    assertValid(validateUnifiedEntry, e, 'gmail inbound');
    assert.equal(e.direction, 'inbound');
  });

  it('derives outbound direction when owner bundle is the sender — divergence #1', () => {
    const e = gmailRawToUnified(GMAIL_OUTBOUND, OWNER);
    assertValid(validateUnifiedEntry, e, 'gmail outbound');
    assert.equal(e.direction, 'outbound');
    assert.ok(e.participants.find((p) => p.role === 'sender' && p.self));
  });

  it('maps id/thread/subject/snippet/labels and marks self on owner recipient', () => {
    const e = gmailRawToUnified(GMAIL_INBOUND, OWNER);
    assert.equal(e.channel, 'email');
    assert.equal(e.provider, 'gmail');
    assert.equal(e.providerMessageId, '18f2a9c4b7e1d6a3');
    assert.equal(e.threadRef, '18f2a9c4b7e1d600');
    assert.equal(e.subject, 'Re: Closing disclosure — wire instructions'); // #6 email has subject
    assert.equal(e.transcriptRef, null); // #6 no transcript
    assert.ok(e.snippet && e.snippet.length > 0); // #5 snippet present
    assert.deepEqual(e.labels, ['INBOX', 'IMPORTANT']);
    const ownerParty = e.participants.find((p) => p.identifier === 'nick@nevershitty.com');
    assert.ok(ownerParty?.self, 'owner recipient flagged self');
    const cc = e.participants.find((p) => p.role === 'cc');
    assert.equal(cc?.identifier, 'paralegal@example-law.com');
  });

  it('parses "Display Name <addr>" into identifier + displayName', () => {
    const e = gmailRawToUnified(GMAIL_INBOUND, OWNER);
    const sender = e.participants.find((p) => p.role === 'sender');
    assert.equal(sender?.identifier, 'maria.bianchi@example-law.com');
    assert.equal(sender?.displayName, 'Maria Bianchi');
  });
});

describe('gmailRawToUnified — branch gaps', () => {
  it('throws when id is missing', () => {
    const msg = { ...GMAIL_INBOUND, id: undefined };
    assert.throws(() => gmailRawToUnified(msg, OWNER), /missing id/);
  });

  it('throws when date is missing', () => {
    const msg = { ...GMAIL_INBOUND, date: undefined };
    assert.throws(() => gmailRawToUnified(msg, OWNER), /missing date/);
  });

  it('throws when no participants can be pushed (no sender, no recipients)', () => {
    const msg: GmailRawMessage = {
      id: 'abc123',
      date: '2026-01-01T00:00:00Z',
      // no sender, no toRecipients, no ccRecipients
    };
    assert.throws(() => gmailRawToUnified(msg, OWNER), /no participants/);
  });

  it('skips empty addr in pushParty — empty string in toRecipients returns early via !addr guard', () => {
    const msg: GmailRawMessage = {
      id: 'test-empty-recipient',
      date: '2026-01-01T00:00:00Z',
      toRecipients: ['nick@nevershitty.com', ''],
    };
    const e = gmailRawToUnified(msg, OWNER);
    assert.equal(e.participants.length, 1, 'empty-addr recipient skipped; valid one kept');
    assert.equal(e.participants[0].identifier, 'nick@nevershitty.com');
  });

  it('uses plaintext_body as body fallback when body is absent (divergence #5)', () => {
    const msg: GmailRawMessage = {
      ...GMAIL_INBOUND,
      body: undefined,
      plaintext_body: 'Plain text content here.',
    };
    const e = gmailRawToUnified(msg, OWNER);
    assert.equal(e.body, 'Plain text content here.');
  });

  it('uses threadId argument as threadRef when msg.threadId is absent', () => {
    const { threadId: _omit, ...msgWithoutThreadId } = GMAIL_INBOUND;
    const e = gmailRawToUnified(msgWithoutThreadId, OWNER, 'external-thread-001');
    assert.equal(e.threadRef, 'external-thread-001');
  });
});
