/**
 * DV: comms-mcp/schemas/*.json structural drift guard
 *
 * These three JSON Schema files own the canonical comms/v1 contracts
 * (comms.recentLog, MessagesProvider, UnifiedCommsEntry). The TypeScript
 * types in apps/comms-mcp/src/types.ts are hand-written mirrors of them;
 * the types.ts header warns they must not drift from these schemas.
 *
 * These tests lock the structural invariants so any breaking change
 * (renamed $defs, removed required fields, altered enums) shows up
 * immediately in CI rather than silently at runtime.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SCHEMAS = resolve(ROOT, 'apps/comms-mcp/schemas');

function load(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(SCHEMAS, name), 'utf8'));
}

// ── comms.recentLog.schema.json ───────────────────────────────────────────────

describe('comms.recentLog.schema.json — structural drift guard', () => {
  const schema = load('comms.recentLog.schema.json');
  type Defs = Record<string, Record<string, unknown>>;

  it('$id is the canonical schema.chitty.cc URI', () => {
    assert.equal(
      schema['$id'],
      'https://schema.chitty.cc/comms/v1/comms.recentLog.schema.json'
    );
  });

  it('title is "comms.recentLog"', () => {
    assert.equal(schema['title'], 'comms.recentLog');
  });

  it('top-level type is "object"', () => {
    assert.equal(schema['type'], 'object');
  });

  it('$defs contains Input and Output', () => {
    const defs = schema['$defs'] as Defs;
    assert.ok(defs && typeof defs === 'object', '$defs must be present');
    assert.ok('Input' in defs, '$defs must have Input');
    assert.ok('Output' in defs, '$defs must have Output');
  });

  it('Input.oneOf has exactly 2 variants', () => {
    const input = (schema['$defs'] as Defs)['Input'];
    const oneOf = input['oneOf'] as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(oneOf), 'Input.oneOf must be an array');
    assert.equal(oneOf.length, 2, 'Input.oneOf must have exactly 2 entries');
  });

  it('Input.oneOf[0].required includes "person"', () => {
    const input = (schema['$defs'] as Defs)['Input'];
    const oneOf = input['oneOf'] as Array<{ required?: string[] }>;
    assert.ok(oneOf[0].required?.includes('person'), 'first variant must require person');
  });

  it('Input.oneOf[1].required includes "identifier"', () => {
    const input = (schema['$defs'] as Defs)['Input'];
    const oneOf = input['oneOf'] as Array<{ required?: string[] }>;
    assert.ok(oneOf[1].required?.includes('identifier'), 'second variant must require identifier');
  });

  it('Input has expected properties', () => {
    const input = (schema['$defs'] as Defs)['Input'];
    const props = Object.keys((input['properties'] ?? {}) as object);
    for (const key of ['person', 'identifier', 'channels', 'days', 'since', 'until', 'limit', 'order', 'includeBody']) {
      assert.ok(props.includes(key), `Input must have property "${key}"`);
    }
  });

  it('Input additionalProperties is false', () => {
    const input = (schema['$defs'] as Defs)['Input'];
    assert.equal(input['additionalProperties'], false);
  });

  it('Output has "entries" and "metadata" properties', () => {
    const output = (schema['$defs'] as Defs)['Output'];
    const props = Object.keys((output['properties'] ?? {}) as object);
    assert.ok(props.includes('entries'), 'Output must have entries');
    assert.ok(props.includes('metadata'), 'Output must have metadata');
  });
});

// ── messages-provider.schema.json ─────────────────────────────────────────────

describe('messages-provider.schema.json — structural drift guard', () => {
  const schema = load('messages-provider.schema.json');
  type Defs = Record<string, Record<string, unknown>>;

  it('$id is the canonical schema.chitty.cc URI', () => {
    assert.equal(
      schema['$id'],
      'https://schema.chitty.cc/comms/v1/messages-provider.schema.json'
    );
  });

  it('title is "MessagesProvider"', () => {
    assert.equal(schema['title'], 'MessagesProvider');
  });

  it('top-level type is "object"', () => {
    assert.equal(schema['type'], 'object');
  });

  it('required array includes capability, channel, resolveContact, listMessages, rawToUnified', () => {
    const required = schema['required'] as string[];
    assert.ok(Array.isArray(required), 'required must be an array');
    for (const field of ['capability', 'channel', 'resolveContact', 'listMessages', 'rawToUnified']) {
      assert.ok(required.includes(field), `"${field}" must be required`);
    }
  });

  it('top-level properties include capability, channel, binding, resolveContact, listMessages, rawToUnified', () => {
    const props = Object.keys((schema['properties'] ?? {}) as object);
    for (const key of ['capability', 'channel', 'binding', 'resolveContact', 'listMessages', 'rawToUnified']) {
      assert.ok(props.includes(key), `must have property "${key}"`);
    }
  });

  it('$defs contains Operation', () => {
    const defs = schema['$defs'] as Defs;
    assert.ok(defs && 'Operation' in defs, '$defs must contain Operation');
  });

  it('Operation has op, inputShape, and notes properties', () => {
    const op = ((schema['$defs'] as Defs)['Operation']['properties'] ?? {}) as Record<string, unknown>;
    assert.ok('op' in op, 'Operation must have op');
    assert.ok('inputShape' in op, 'Operation must have inputShape');
    assert.ok('notes' in op, 'Operation must have notes');
  });

  it('Operation.op type is "string"', () => {
    const op = ((schema['$defs'] as Defs)['Operation']['properties'] as Record<string, Record<string, unknown>>)['op'];
    assert.equal(op['type'], 'string');
  });
});

// ── unified-comms-entry.schema.json ───────────────────────────────────────────

describe('unified-comms-entry.schema.json — structural drift guard', () => {
  const schema = load('unified-comms-entry.schema.json');
  type Defs = Record<string, Record<string, unknown>>;
  type Props = Record<string, Record<string, unknown>>;

  it('$id is the canonical schema.chitty.cc URI', () => {
    assert.equal(
      schema['$id'],
      'https://schema.chitty.cc/comms/v1/unified-comms-entry.schema.json'
    );
  });

  it('title is "UnifiedCommsEntry"', () => {
    assert.equal(schema['title'], 'UnifiedCommsEntry');
  });

  it('top-level type is "object"', () => {
    assert.equal(schema['type'], 'object');
  });

  it('required array includes the 5 mandatory fields', () => {
    const required = schema['required'] as string[];
    assert.ok(Array.isArray(required), 'required must be an array');
    for (const field of ['channel', 'direction', 'occurredAt', 'participants', 'providerMessageId']) {
      assert.ok(required.includes(field), `"${field}" must be required`);
    }
  });

  it('top-level properties include all expected fields', () => {
    const props = Object.keys((schema['properties'] ?? {}) as object);
    for (const key of [
      'channel', 'provider', 'providerMessageId', 'internalId', 'threadRef',
      'direction', 'occurredAt', 'participants', 'body', 'snippet',
      'subject', 'transcriptRef', 'labels', 'source', '_meta',
    ]) {
      assert.ok(props.includes(key), `must have property "${key}"`);
    }
  });

  it('channel enum contains exactly quo, imessage, email, twilio, voice', () => {
    const channelEnum = ((schema['properties'] as Props)['channel'])['enum'] as string[];
    assert.ok(Array.isArray(channelEnum), 'channel must have an enum');
    assert.equal(channelEnum.length, 5, 'channel enum must have exactly 5 values');
    for (const ch of ['quo', 'imessage', 'email', 'twilio', 'voice']) {
      assert.ok(channelEnum.includes(ch), `"${ch}" must be in channel enum`);
    }
  });

  it('direction enum contains "inbound" and "outbound"', () => {
    const dirEnum = ((schema['properties'] as Props)['direction'])['enum'] as string[];
    assert.ok(Array.isArray(dirEnum), 'direction must have an enum');
    assert.ok(dirEnum.includes('inbound'), '"inbound" must be in direction enum');
    assert.ok(dirEnum.includes('outbound'), '"outbound" must be in direction enum');
  });

  it('occurredAt has format "date-time"', () => {
    const prop = (schema['properties'] as Props)['occurredAt'];
    assert.equal(prop['format'], 'date-time');
  });

  it('$defs contains CommParty', () => {
    const defs = schema['$defs'] as Defs;
    assert.ok(defs && 'CommParty' in defs, '$defs must contain CommParty');
  });

  it('CommParty required includes role and identifier', () => {
    const cp = (schema['$defs'] as Defs)['CommParty'];
    const required = cp['required'] as string[];
    assert.ok(Array.isArray(required), 'CommParty.required must be an array');
    assert.ok(required.includes('role'), 'CommParty must require role');
    assert.ok(required.includes('identifier'), 'CommParty must require identifier');
  });

  it('CommParty has role, identifier, identifierKind, self, chittyId, displayName properties', () => {
    const cp = (schema['$defs'] as Defs)['CommParty'];
    const props = Object.keys((cp['properties'] ?? {}) as object);
    for (const key of ['role', 'identifier', 'identifierKind', 'self', 'chittyId', 'displayName']) {
      assert.ok(props.includes(key), `CommParty must have property "${key}"`);
    }
  });

  it('CommParty.role enum includes sender, recipient, cc, bcc', () => {
    const cpProps = ((schema['$defs'] as Defs)['CommParty']['properties'] as Props);
    const roleEnum = cpProps['role']['enum'] as string[];
    assert.ok(Array.isArray(roleEnum), 'role must have an enum');
    for (const r of ['sender', 'recipient', 'cc', 'bcc']) {
      assert.ok(roleEnum.includes(r), `"${r}" must be in role enum`);
    }
  });

  it('CommParty.identifierKind enum includes phone, email, handle', () => {
    const cpProps = ((schema['$defs'] as Defs)['CommParty']['properties'] as Props);
    const kindEnum = cpProps['identifierKind']['enum'] as string[];
    assert.ok(Array.isArray(kindEnum), 'identifierKind must have an enum');
    for (const k of ['phone', 'email', 'handle']) {
      assert.ok(kindEnum.includes(k), `"${k}" must be in identifierKind enum`);
    }
  });
});
