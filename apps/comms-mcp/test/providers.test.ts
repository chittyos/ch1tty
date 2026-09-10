import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  quoProvider,
  gmailProvider,
  imessageProviderUnbound,
  defaultBoundProviders,
} from '../src/providers.js';

const UNIFIED_SCHEMA_REF =
  'https://schema.chitty.cc/comms/v1/unified-comms-entry.schema.json' as const;

describe('quoProvider', () => {
  it('has capability messages and channel quo', () => {
    assert.equal(quoProvider.capability, 'messages');
    assert.equal(quoProvider.channel, 'quo');
  });

  it('has provider openphone', () => {
    assert.equal(quoProvider.provider, 'openphone');
  });

  it('binding points to chittyagent-quo', () => {
    assert.equal(quoProvider.binding?.mcpServerId, 'chittyagent-quo');
  });

  it('binding.tools has all three abstract ops with correct tool names', () => {
    const tools = quoProvider.binding?.tools ?? {};
    assert.equal(tools['resolveContact'], 'quo_lookup_contact_context');
    assert.equal(tools['listMessages'], 'quo_recent_messages_local');
    assert.equal(tools['getMessage'], 'quo_get_message');
  });

  it('listMessages uses the local-cache op (not the live-API op)', () => {
    assert.equal(quoProvider.binding?.tools?.['listMessages'], 'quo_recent_messages_local');
  });

  it('resolveContact op name matches abstract op', () => {
    assert.equal(quoProvider.resolveContact.op, 'resolveContact');
  });

  it('listMessages op name matches abstract op', () => {
    assert.equal(quoProvider.listMessages.op, 'listMessages');
  });

  it('getMessage op name matches abstract op', () => {
    assert.equal(quoProvider.getMessage?.op, 'getMessage');
  });

  it('rawToUnified.outputSchemaRef is the canonical unified-comms schema', () => {
    assert.equal(quoProvider.rawToUnified.outputSchemaRef, UNIFIED_SCHEMA_REF);
  });

  it('rawToUnified.fieldMap has a quo key', () => {
    assert.ok('quo' in quoProvider.rawToUnified.fieldMap, 'fieldMap must have a quo key');
  });

  it('supports.nativeDirection is true (quo emits direction natively)', () => {
    assert.equal(quoProvider.supports?.nativeDirection, true);
  });

  it('supports.localCache is true', () => {
    assert.equal(quoProvider.supports?.localCache, true);
  });

  it('supports.transcripts is true', () => {
    assert.equal(quoProvider.supports?.transcripts, true);
  });
});

describe('gmailProvider', () => {
  it('has capability messages and channel email', () => {
    assert.equal(gmailProvider.capability, 'messages');
    assert.equal(gmailProvider.channel, 'email');
  });

  it('has provider gmail', () => {
    assert.equal(gmailProvider.provider, 'gmail');
  });

  it('binding points to chittyagent-google', () => {
    assert.equal(gmailProvider.binding?.mcpServerId, 'chittyagent-google');
  });

  it('resolveContact and listMessages both bind search_threads', () => {
    assert.equal(gmailProvider.binding?.tools?.['resolveContact'], 'search_threads');
    assert.equal(gmailProvider.binding?.tools?.['listMessages'], 'search_threads');
  });

  it('getMessage binds get_thread', () => {
    assert.equal(gmailProvider.binding?.tools?.['getMessage'], 'get_thread');
  });

  it('rawToUnified.deriveDirection is set (direction not native)', () => {
    assert.ok(
      gmailProvider.rawToUnified.deriveDirection,
      'gmail direction must be derived from owner-bundle',
    );
  });

  it('rawToUnified.fieldMap has a gmail key', () => {
    assert.ok('gmail' in gmailProvider.rawToUnified.fieldMap, 'fieldMap must have a gmail key');
  });

  it('supports.nativeDirection is false (direction is derived)', () => {
    assert.equal(gmailProvider.supports?.nativeDirection, false);
  });

  it('supports.localCache is false', () => {
    assert.equal(gmailProvider.supports?.localCache, false);
  });
});

describe('imessageProviderUnbound', () => {
  it('has bound: false', () => {
    assert.equal(imessageProviderUnbound.bound, false);
  });

  it('has channel imessage', () => {
    assert.equal(imessageProviderUnbound.channel, 'imessage');
  });

  it('has a non-empty reason string documenting the blocker', () => {
    assert.ok(
      typeof imessageProviderUnbound.reason === 'string' && imessageProviderUnbound.reason.length > 0,
      'reason must document why this provider is unbound',
    );
  });
});

describe('defaultBoundProviders', () => {
  it('returns exactly two bound providers', () => {
    assert.equal(defaultBoundProviders().size, 2);
  });

  it('includes quo channel', () => {
    assert.ok(defaultBoundProviders().has('quo'));
  });

  it('includes email channel', () => {
    assert.ok(defaultBoundProviders().has('email'));
  });

  it('quo entry is quoProvider', () => {
    assert.equal(defaultBoundProviders().get('quo'), quoProvider);
  });

  it('email entry is gmailProvider', () => {
    assert.equal(defaultBoundProviders().get('email'), gmailProvider);
  });

  it('does not include imessage (unbound channel must not appear)', () => {
    assert.ok(!defaultBoundProviders().has('imessage'));
  });

  it('does not include voice or twilio (unregistered channels)', () => {
    const m = defaultBoundProviders();
    assert.ok(!m.has('voice'));
    assert.ok(!m.has('twilio'));
  });

  it('each call returns a fresh Map', () => {
    const a = defaultBoundProviders();
    const b = defaultBoundProviders();
    assert.notEqual(a, b);
  });
});
