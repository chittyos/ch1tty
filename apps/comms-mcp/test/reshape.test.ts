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
