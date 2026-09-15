// Workstream BV: unit tests for src/core-utils.ts — pure functions extracted
// from Ch1ttyCore so they can be exercised without Cloudflare runtime deps.
//
// isChittyHost: security-critical allowlist guard used before forwarding
// inherited credentials to a dynamically-ingested upstream endpoint.
// extractEntityTypeCode: ChittyID type-code parser used for provision validation.

import test from 'node:test';
import assert from 'node:assert/strict';
import { isChittyHost, extractEntityTypeCode } from '../src/core-utils.js';

// ── isChittyHost ─────────────────────────────────────────────────────────────

test('isChittyHost — apex domain https://chitty.cc → true', () => {
  assert.equal(isChittyHost('https://chitty.cc'), true);
});

test('isChittyHost — subdomain https://mcp.chitty.cc → true', () => {
  assert.equal(isChittyHost('https://mcp.chitty.cc'), true);
});

test('isChittyHost — deep subdomain https://a.b.chitty.cc → true', () => {
  assert.equal(isChittyHost('https://a.b.chitty.cc'), true);
});

test('isChittyHost — uppercase host normalised → true', () => {
  assert.equal(isChittyHost('https://MCP.Chitty.CC/mcp'), true);
});

test('isChittyHost — http (not https) → false', () => {
  assert.equal(isChittyHost('http://chitty.cc'), false);
});

test('isChittyHost — http subdomain → false', () => {
  assert.equal(isChittyHost('http://mcp.chitty.cc'), false);
});

test('isChittyHost — look-alike suffix attack chitty.cc.evil.com → false', () => {
  assert.equal(isChittyHost('https://chitty.cc.evil.com'), false);
});

test('isChittyHost — look-alike prefix attack notchitty.cc → false', () => {
  assert.equal(isChittyHost('https://notchitty.cc'), false);
});

test('isChittyHost — unrelated https host → false', () => {
  assert.equal(isChittyHost('https://example.com'), false);
});

test('isChittyHost — malformed URL string → false', () => {
  assert.equal(isChittyHost('not a url at all'), false);
});

test('isChittyHost — empty string → false', () => {
  assert.equal(isChittyHost(''), false);
});

test('isChittyHost — with path and query string → true', () => {
  assert.equal(isChittyHost('https://api.chitty.cc/v1/tools?foo=bar'), true);
});

// ── extractEntityTypeCode ────────────────────────────────────────────────────

test('extractEntityTypeCode — valid 8-segment id returns type code at index 4', () => {
  // Form: VV-G-LLL-SSSS-T-YM-C-X (e.g. 26-1-abc-0001-P-2406-0-1)
  assert.equal(extractEntityTypeCode('26-1-abc-0001-P-2406-0-1'), 'P');
});

test('extractEntityTypeCode — another valid id returns its type code', () => {
  assert.equal(extractEntityTypeCode('01-2-xyz-9999-A-2501-1-0'), 'A');
});

test('extractEntityTypeCode — lowercase letter at position 4 → null (not uppercase)', () => {
  assert.equal(extractEntityTypeCode('26-1-abc-0001-p-2406-0-1'), null);
});

test('extractEntityTypeCode — too few segments (7) → null', () => {
  assert.equal(extractEntityTypeCode('26-1-abc-0001-P-2406-0'), null);
});

test('extractEntityTypeCode — too many segments (9) → null', () => {
  assert.equal(extractEntityTypeCode('26-1-abc-0001-P-2406-0-1-extra'), null);
});

test('extractEntityTypeCode — empty string → null', () => {
  assert.equal(extractEntityTypeCode(''), null);
});

test('extractEntityTypeCode — no dashes → null', () => {
  assert.equal(extractEntityTypeCode('plainstring'), null);
});

test('extractEntityTypeCode — digit at type position → null', () => {
  assert.equal(extractEntityTypeCode('26-1-abc-0001-3-2406-0-1'), null);
});
