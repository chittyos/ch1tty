/**
 * BU: reshape.ts remaining branch gaps — 5 coverage paths:
 *
 * 1. identifierKind:32 — `return 'handle'` when id is neither email nor phone
 * 2. quoRawToUnified:149 — `row.source ?? 'openphone'` when source is undefined
 * 3. quoRawToUnified:120 — `owner.displayName ?? null` when displayName is undefined
 * 4. parseEmailParty:192 — `name || null` when display-name portion is empty ("" <addr>)
 * 5. gmailRawToUnified:215 — `owner.displayName ?? name` when owner has no displayName
 *
 * Line 116 (`ownerRole ?? ...`) is structurally unreachable: ownerRole and ownerIdentifier
 * are co-assigned in the loop, so ownerRole is always defined when we enter the
 * `if (ownerIdentifier !== undefined)` block. That line carries a c8 ignore annotation.
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

const OWNER_NO_META: OwnerIdentity = {
  identifiers: ['+15555550000', 'owner@example.com'],
  // displayName and chittyId intentionally absent → tests ?? branches
};

const BASE_QUO: QuoRawRow = {
  external_id: 'OP-bu-001',
  sent_at: '2026-09-05T10:00:00Z',
  direction: 'inbound',
  parties: [
    { role: 'sender', identifier: '+15555550001' },
    { role: 'recipient', identifier: '+15555550000' },
  ],
  source: 'openphone',
};

// ── 1. identifierKind:30 — 'email' and 'handle' branches ─────────────────────
//
// identifierKind is never called with an email in quo tests (gmail hardcodes
// identifierKind:'email'); adding an email counterparty covers the '@' true branch.
// Adding a handle-type identifier covers the final 'handle' return.

describe("reshape.ts identifierKind — 'email' return via quo counterparty", () => {
  it("returns email in the unified entry when counterparty identifier contains @", () => {
    const row: QuoRawRow = {
      ...BASE_QUO,
      parties: [
        { role: 'sender', identifier: 'alice@example.com' }, // email type
        { role: 'recipient', identifier: '+15555550000' },
      ],
    };
    const e = quoRawToUnified(row, OWNER);
    const counterparty = e.participants.find((p) => !p.self);
    assert.ok(counterparty, 'counterparty must exist');
    assert.equal(counterparty.identifierKind, 'email');
  });
});

describe("reshape.ts identifierKind — 'handle' return", () => {
  it("returns handle in the unified entry when counterparty identifier is a non-phone non-email string", () => {
    const row: QuoRawRow = {
      ...BASE_QUO,
      parties: [
        { role: 'sender', identifier: 'chitty-user-xyz' }, // handle type
        { role: 'recipient', identifier: '+15555550000' },
      ],
    };
    const e = quoRawToUnified(row, OWNER);
    const counterparty = e.participants.find((p) => !p.self);
    assert.ok(counterparty, 'counterparty must exist');
    assert.equal(counterparty.identifierKind, 'handle');
    assert.equal(counterparty.identifier, 'chitty-user-xyz');
  });
});

// ── 2. quoRawToUnified:149 — source ?? 'openphone' ───────────────────────────

describe('reshape.ts quoRawToUnified — source undefined → provider defaults to openphone', () => {
  it('sets provider to openphone when source is absent', () => {
    const row: QuoRawRow = {
      ...BASE_QUO,
      source: undefined,
    };
    const e = quoRawToUnified(row, OWNER);
    assert.equal(e.provider, 'openphone');
  });
});

// ── 3. quoRawToUnified:120 — owner.displayName ?? null ───────────────────────

describe('reshape.ts quoRawToUnified — owner without displayName/chittyId', () => {
  it('produces null displayName and chittyId for the self participant when owner has neither', () => {
    const e = quoRawToUnified(BASE_QUO, OWNER_NO_META);
    const self = e.participants.find((p) => p.self);
    assert.ok(self, 'self participant must exist');
    assert.equal(self.displayName, null);
    assert.equal(self.chittyId, null);
  });
});

// ── 4. parseEmailParty:192 — name || null (empty display-name segment) ────────

describe('reshape.ts parseEmailParty — angle-bracket format with no display name', () => {
  it('sets displayName to null when sender is "<addr@host>" with no name before the bracket', () => {
    const msg: GmailRawMessage = {
      id: 'gm-bu-no-name-001',
      date: '2026-09-05T10:00:00Z',
      sender: '<alice@example.com>',
      toRecipients: ['owner@example.com'],
    };
    const e = gmailRawToUnified(msg, OWNER);
    const sender = e.participants.find((p) => p.role === 'sender');
    assert.ok(sender, 'sender party must exist');
    assert.equal(sender.identifier, 'alice@example.com');
    assert.equal(sender.displayName, null, 'empty display name segment must produce null');
  });
});

// ── 5. gmailRawToUnified:215 — owner.displayName ?? name (owner without displayName) ──

describe('reshape.ts gmailRawToUnified — owner sender without displayName falls back to email name', () => {
  it('falls back to the parsed name from the sender string when owner.displayName is absent', () => {
    const msg: GmailRawMessage = {
      id: 'gm-bu-owner-nodisplay-001',
      date: '2026-09-05T10:00:00Z',
      sender: 'Fallback Name <owner@example.com>',
      toRecipients: ['alice@example.com'],
    };
    const e = gmailRawToUnified(msg, OWNER_NO_META);
    const self = e.participants.find((p) => p.self);
    assert.ok(self, 'self participant must exist');
    // owner.displayName is undefined → undefined ?? 'Fallback Name' = 'Fallback Name'
    assert.equal(self.displayName, 'Fallback Name');
    assert.equal(self.chittyId, null);
  });
});
