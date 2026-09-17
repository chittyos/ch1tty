/**
 * Drift guard for @ch1tty/shared-types.
 *
 * @ch1tty/shared-types is a PURE TYPE PACKAGE — all exports are TypeScript
 * interfaces and type aliases with no runtime values. These tests:
 *
 *   1. Assert zero runtime exports (catches accidental value additions).
 *   2. Verify structural type shapes via TypeScript compile-time assertions
 *      (renamed or removed properties cause a compile failure = test failure
 *      before a single runtime assert runs).
 *   3. Create minimal runtime fixture objects to validate discriminant unions
 *      and field presence at runtime, complementing the compile-time checks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import * as SharedTypes from '../src/index.js';

// Compile-time named imports — renaming or removing any of these types causes
// the file to fail to compile, which surfaces as a test failure.
import type {
  ServerAccess,
  ServerCategory,
  ServerConfig,
  LocalServerConfig,
  RemoteServerConfig,
  ServersConfig,
  AggregatedTool,
  ContentItem,
  ToolCallResult,
  ResourceEntry,
  ResourceTemplateEntry,
  PromptEntry,
  BackendStatus,
  ServerStatus,
  ToolEntry,
} from '../src/index.js';

// ── Runtime: zero exports (pure type package) ─────────────────────────────

test('package has zero runtime exports — pure type package', () => {
  const keys = Object.keys(SharedTypes);
  assert.deepEqual(keys, [], `expected empty runtime surface, got: ${JSON.stringify(keys)}`);
});

// ── Compile-time structural guards ────────────────────────────────────────
// These functions are never invoked at runtime; TypeScript validates property
// names and types at compile time. Rename a field → this file won't compile.

function _assertLocalServerConfig(c: LocalServerConfig): void {
  void (c.id as string);
  void (c.name as string);
  void (c.type as 'local');
  void (c.access as ServerAccess);
  void (c.category as ServerCategory);
  void (c.command as string);
}

function _assertRemoteServerConfig(c: RemoteServerConfig): void {
  void (c.id as string);
  void (c.name as string);
  void (c.type as 'remote');
  void (c.access as ServerAccess);
  void (c.category as ServerCategory);
  void (c.endpoint as string);
}

function _assertServersConfig(c: ServersConfig): void {
  void (c.servers as ServerConfig[]);
}

function _assertAggregatedTool(t: AggregatedTool): void {
  void (t.serverId as string);
  void (t.originalName as string);
  void (t.namespacedName as string);
  void (t.description as string);
  void (t.inputSchema as Record<string, unknown>);
}

function _assertContentItem(c: ContentItem): void {
  if (c.type === 'text') { void (c.text as string); }
  else if (c.type === 'image') { void (c.data as string); void (c.mimeType as string); }
  else { void (c.resource.uri as string); }
}

function _assertToolCallResult(r: ToolCallResult): void {
  void (r.content as ContentItem[]);
  void (r.isError as boolean | undefined);
}

function _assertResourceEntry(r: ResourceEntry): void {
  void (r.uri as string);
  void (r.name as string);
}

function _assertResourceTemplateEntry(r: ResourceTemplateEntry): void {
  void (r.uriTemplate as string);
  void (r.name as string);
}

function _assertPromptEntry(p: PromptEntry): void {
  void (p.name as string);
}

function _assertBackendStatus(s: BackendStatus): void {
  void (s.connected as boolean);
  void (s.toolCount as number);
  void (s.toolCacheAge as number | null);
}

function _assertServerStatus(s: ServerStatus): void {
  void (s.id as string);
  void (s.name as string);
  void (s.type as 'local' | 'remote');
  void (s.enabled as boolean);
  void (s.connected as boolean);
  void (s.toolCount as number);
}

function _assertToolEntry(t: ToolEntry): void {
  void (t.name as string);
  void (t.inputSchema as Record<string, unknown>);
  void (t.description as string | undefined);
}

// Reference the guards so TypeScript doesn't tree-shake them before checking.
void _assertLocalServerConfig;
void _assertRemoteServerConfig;
void _assertServersConfig;
void _assertAggregatedTool;
void _assertContentItem;
void _assertToolCallResult;
void _assertResourceEntry;
void _assertResourceTemplateEntry;
void _assertPromptEntry;
void _assertBackendStatus;
void _assertServerStatus;
void _assertToolEntry;

// ── Runtime fixture tests ─────────────────────────────────────────────────

test('LocalServerConfig fixture: type discriminant is "local"', () => {
  const cfg = {
    id: 'test-local',
    name: 'Test Local',
    type: 'local' as const,
    access: 'read' as ServerAccess,
    category: 'code' as ServerCategory,
    command: 'node',
  } satisfies LocalServerConfig;
  assert.equal(cfg.type, 'local');
  assert.equal(cfg.access, 'read');
  assert.equal(cfg.command, 'node');
});

test('RemoteServerConfig fixture: type discriminant is "remote"', () => {
  const cfg = {
    id: 'test-remote',
    name: 'Test Remote',
    type: 'remote' as const,
    access: 'readwrite' as ServerAccess,
    category: 'ecosystem' as ServerCategory,
    endpoint: 'https://example.com/mcp',
  } satisfies RemoteServerConfig;
  assert.equal(cfg.type, 'remote');
  assert.equal(cfg.access, 'readwrite');
  assert.equal(cfg.endpoint, 'https://example.com/mcp');
});

test('ServerConfig discriminated union narrows correctly on type field', () => {
  const local: ServerConfig = {
    id: 'l', name: 'L', type: 'local', access: 'read', category: 'code', command: 'node',
  };
  const remote: ServerConfig = {
    id: 'r', name: 'R', type: 'remote', access: 'write', category: 'search',
    endpoint: 'https://x.com/mcp',
  };
  if (local.type === 'local') {
    assert.equal(typeof local.command, 'string');
  }
  if (remote.type === 'remote') {
    assert.equal(typeof remote.endpoint, 'string');
  }
});

test('ContentItem text variant: type and text fields present', () => {
  const item: ContentItem = { type: 'text', text: 'hello world' };
  assert.equal(item.type, 'text');
  if (item.type === 'text') { assert.equal(item.text, 'hello world'); }
});

test('ContentItem image variant: type, data, and mimeType fields present', () => {
  const item: ContentItem = { type: 'image', data: 'base64==', mimeType: 'image/png' };
  assert.equal(item.type, 'image');
  if (item.type === 'image') {
    assert.equal(item.data, 'base64==');
    assert.equal(item.mimeType, 'image/png');
  }
});

test('BackendStatus fixture: connected + toolCount + toolCacheAge', () => {
  const status: BackendStatus = { connected: true, toolCount: 5, toolCacheAge: 42 };
  assert.equal(status.connected, true);
  assert.equal(status.toolCount, 5);
  assert.equal(status.toolCacheAge, 42);
});

test('BackendStatus: toolCacheAge accepts null', () => {
  const status: BackendStatus = { connected: false, toolCount: 0, toolCacheAge: null };
  assert.equal(status.toolCacheAge, null);
});

test('ServerStatus extends BackendStatus: id + name + type + enabled', () => {
  const status: ServerStatus = {
    id: 'srv1', name: 'Server 1', type: 'remote', enabled: true,
    connected: false, toolCount: 0, toolCacheAge: null,
  };
  assert.equal(status.id, 'srv1');
  assert.equal(status.name, 'Server 1');
  assert.equal(status.enabled, true);
  assert.equal(status.toolCacheAge, null);
});

test('ToolCallResult fixture: content array present, isError optional', () => {
  const result: ToolCallResult = { content: [{ type: 'text', text: 'ok' }] };
  assert.equal(result.content.length, 1);
  assert.equal(result.isError, undefined);
});

test('ResourceEntry fixture: uri and name required', () => {
  const entry: ResourceEntry = { uri: 'file:///a', name: 'a' };
  assert.equal(entry.uri, 'file:///a');
  assert.equal(entry.name, 'a');
});

test('ResourceTemplateEntry fixture: uriTemplate and name required', () => {
  const entry: ResourceTemplateEntry = { uriTemplate: 'file:///{path}', name: 'tmpl' };
  assert.equal(entry.uriTemplate, 'file:///{path}');
  assert.equal(entry.name, 'tmpl');
});

test('PromptEntry fixture: name required, arguments optional', () => {
  const entry: PromptEntry = { name: 'my-prompt' };
  assert.equal(entry.name, 'my-prompt');
  assert.equal(entry.arguments, undefined);
});

test('ToolEntry fixture: name and inputSchema required, description optional', () => {
  const entry: ToolEntry = { name: 'do_thing', inputSchema: { type: 'object' } };
  assert.equal(entry.name, 'do_thing');
  assert.deepEqual(entry.inputSchema, { type: 'object' });
  assert.equal(entry.description, undefined);
});

test('ServersConfig fixture: servers array present', () => {
  const cfg: ServersConfig = { servers: [] };
  assert.deepEqual(cfg.servers, []);
});

test('AggregatedTool fixture: all 5 required fields present', () => {
  const tool: AggregatedTool = {
    serverId: 'srv',
    originalName: 'doX',
    namespacedName: 'srv/doX',
    description: 'does X',
    inputSchema: { type: 'object', properties: {} },
  };
  assert.equal(tool.serverId, 'srv');
  assert.equal(tool.namespacedName, 'srv/doX');
  assert.deepEqual(tool.inputSchema, { type: 'object', properties: {} });
});
