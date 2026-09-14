/**
 * AT — openapi-spec.ts branch gaps.
 *
 * Covers the uncovered ?? branch in buildOpenApiSpec:
 *   tool.inputSchema.properties is absent (undefined) → fallback to {}
 *
 * The ?? on line 34 fires only when inputSchema has no `properties` key at all.
 * All existing tests supply either properties: {} or properties: { field: ... }.
 * A tool with no inputSchema.properties key is valid (e.g. a ping/status op that
 * accepts no args), and results in requestBody: undefined (no args to describe).
 *
 * Also covers the cascade:
 *   - required ?? [] fires (required also absent) → [] → required.length === 0
 *   - Object.keys({}).length === 0 → requestBody: undefined
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOpenApiSpec, type ToolSpecEntry } from '../src/openapi-spec.js';

// ── properties ?? {} — inputSchema with no properties key ─────────────────────

test('buildOpenApiSpec: inputSchema with no properties key → properties defaults to {} → requestBody absent', () => {
  const tool: ToolSpecEntry = {
    serverId: 'x',
    namespacedName: 'x/ping',
    description: 'Ping',
    inputSchema: { type: 'object' },
  };
  const spec = buildOpenApiSpec([tool]);
  const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
  const path = paths['/tools/x/ping'];
  assert.ok(path !== undefined, 'path entry must be present');
  assert.equal(
    path.post.requestBody,
    undefined,
    'requestBody must be absent when inputSchema has no properties field',
  );
});

test('buildOpenApiSpec: inputSchema with no properties key still produces correct path and operationId', () => {
  const tool: ToolSpecEntry = {
    serverId: 'status',
    namespacedName: 'status/health',
    description: 'Health check',
    inputSchema: {},
  };
  const spec = buildOpenApiSpec([tool]);
  const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
  const path = paths['/tools/status/health'];
  assert.ok(path !== undefined, 'path entry must be present for tool with empty inputSchema');
  assert.equal(path.post.operationId, 'status_health', 'operationId must replace / with _');
  assert.equal(path.post.summary, 'Health check', 'summary must use description');
  assert.equal(path.post.requestBody, undefined, 'requestBody must be absent');
});

test('buildOpenApiSpec: multiple tools — mix of with and without properties key — all paths present', () => {
  const tools: ToolSpecEntry[] = [
    { serverId: 'a', namespacedName: 'a/ping', description: 'Ping', inputSchema: { type: 'object' } },
    { serverId: 'b', namespacedName: 'b/run', description: 'Run', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } },
  ];
  const spec = buildOpenApiSpec(tools);
  const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
  const ping = paths['/tools/a/ping'];
  const run = paths['/tools/b/run'];
  assert.ok(ping !== undefined, 'ping path must be present');
  assert.ok(run !== undefined, 'run path must be present');
  assert.equal(ping.post.requestBody, undefined, 'ping must have no requestBody (no properties)');
  assert.ok(run.post.requestBody !== undefined, 'run must have requestBody (has properties)');
});
