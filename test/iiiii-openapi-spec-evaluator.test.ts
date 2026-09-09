/**
 * Workstream I: zero-coverage paths in openapi-spec.ts and evaluator.ts.
 *
 * openapi-spec.ts — pure functions (buildOpenApiSpec, parseToolPath), no IO.
 * evaluator.ts    — DO-SQLite record/flush/getStats/measure; uses a real
 *                   in-memory node:sqlite instance wrapped in the SqlStorage
 *                   interface shape so no Cloudflare runtime is needed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Suppress the experimental SQLite warning so it doesn't pollute TAP output.
process.removeAllListeners('warning');
import { DatabaseSync } from 'node:sqlite';

import { buildOpenApiSpec, parseToolPath, type ToolSpecEntry } from '../src/openapi-spec.js';
import { Evaluator } from '../src/evaluator.js';

// ── SqlStorage shim (Cloudflare DO SQLite → node:sqlite) ─────────────────────

type SqlCursor<T> = { toArray(): T[] };
type SqlValue = string | number | null | boolean | bigint | ArrayBuffer;

type Shim = {
  exec<T>(sql: string, ...v: SqlValue[]): SqlCursor<T>;
  /** Direct SELECT for test assertions — bypasses the SqlStorage cast. */
  query<T>(sql: string, ...v: SqlValue[]): T[];
};

function makeSqlStorage(): Shim {
  const db = new DatabaseSync(':memory:');
  return {
    exec<T>(sql: string, ...values: SqlValue[]): SqlCursor<T> {
      const trimmed = sql.trim();
      const lower = trimmed.toLowerCase();
      const isSelect = lower.startsWith('select') || lower.startsWith('pragma');
      if (isSelect) {
        const stmt = db.prepare(trimmed);
        const rows = values.length > 0 ? stmt.all(...values) : stmt.all();
        return { toArray: () => rows as T[] };
      }
      // DDL or DML without bind params — exec handles multi-statement DDL.
      if (values.length === 0) {
        db.exec(trimmed);
        return { toArray: () => [] as T[] };
      }
      db.prepare(trimmed).run(...values);
      return { toArray: () => [] as T[] };
    },
    query<T>(sql: string, ...values: SqlValue[]): T[] {
      const stmt = db.prepare(sql);
      return (values.length > 0 ? stmt.all(...values) : stmt.all()) as T[];
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// openapi-spec.ts — buildOpenApiSpec
// ═══════════════════════════════════════════════════════════════════════════════

test('buildOpenApiSpec: empty tools list → paths is empty object', () => {
  const spec = buildOpenApiSpec([]);
  assert.deepEqual((spec.paths as Record<string, unknown>), {});
});

test('buildOpenApiSpec: openapi version is 3.1.0', () => {
  const spec = buildOpenApiSpec([]);
  assert.equal(spec.openapi, '3.1.0');
});

test('buildOpenApiSpec: info.title is set', () => {
  const spec = buildOpenApiSpec([]);
  assert.ok(typeof (spec.info as Record<string, unknown>).title === 'string');
  assert.ok(((spec.info as Record<string, unknown>).title as string).length > 0);
});

test('buildOpenApiSpec: info.version uses provided version param', () => {
  const spec = buildOpenApiSpec([], '2.3.4');
  assert.equal((spec.info as Record<string, unknown>).version, '2.3.4');
});

test('buildOpenApiSpec: info.version defaults to 1.0.0', () => {
  const spec = buildOpenApiSpec([]);
  assert.equal((spec.info as Record<string, unknown>).version, '1.0.0');
});

test('buildOpenApiSpec: single tool → path key is /tools/<namespacedName>', () => {
  const tool: ToolSpecEntry = {
    serverId: 'neon', namespacedName: 'neon/run_sql',
    description: 'Run SQL', inputSchema: { type: 'object', properties: {} },
  };
  const spec = buildOpenApiSpec([tool]);
  assert.ok('/tools/neon/run_sql' in (spec.paths as Record<string, unknown>));
});

test('buildOpenApiSpec: operationId is namespacedName with slashes replaced by _', () => {
  const tool: ToolSpecEntry = {
    serverId: 'neon', namespacedName: 'neon/run_sql',
    description: 'Run SQL', inputSchema: { type: 'object', properties: {} },
  };
  const spec = buildOpenApiSpec([tool]);
  const path = (spec.paths as Record<string, Record<string, Record<string, unknown>>>)['/tools/neon/run_sql'];
  assert.equal(path.post.operationId, 'neon_run_sql');
});

test('buildOpenApiSpec: operationId deduplication — different paths that normalize to same id get _2 suffix', () => {
  // 'neon/run-sql' and 'neon/run_sql' both normalize to 'neon_run_sql'
  const t1: ToolSpecEntry = {
    serverId: 'neon', namespacedName: 'neon/run-sql', description: 'A', inputSchema: { type: 'object', properties: {} },
  };
  const t2: ToolSpecEntry = {
    serverId: 'neon', namespacedName: 'neon/run_sql', description: 'B', inputSchema: { type: 'object', properties: {} },
  };
  const spec = buildOpenApiSpec([t1, t2]);
  const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
  const ids = Object.values(paths).map((p) => p.post.operationId as string);
  assert.ok(ids.includes('neon_run_sql'), 'first occurrence keeps bare id');
  assert.ok(ids.includes('neon_run_sql_2'), 'second occurrence gets _2 suffix');
});

test('buildOpenApiSpec: three paths normalizing to same id get _2 and _3 suffixes', () => {
  // 'a/b', 'a-b', 'a.b' all normalize to 'a_b'
  const mkTool = (ns: string): ToolSpecEntry => ({
    serverId: 'x', namespacedName: ns, description: 'd', inputSchema: { type: 'object', properties: {} },
  });
  const spec = buildOpenApiSpec([mkTool('a/b'), mkTool('a-b'), mkTool('a.b')]);
  const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
  const ids = Object.values(paths).map((p) => p.post.operationId as string);
  assert.ok(ids.includes('a_b'), 'first gets bare id');
  assert.ok(ids.includes('a_b_2'), 'second gets _2');
  assert.ok(ids.includes('a_b_3'), 'third gets _3');
});

test('buildOpenApiSpec: tags is [serverId]', () => {
  const tool: ToolSpecEntry = {
    serverId: 'neon', namespacedName: 'neon/run_sql',
    description: 'Run SQL', inputSchema: { type: 'object', properties: {} },
  };
  const spec = buildOpenApiSpec([tool]);
  const path = (spec.paths as Record<string, Record<string, Record<string, unknown>>>)['/tools/neon/run_sql'];
  assert.deepEqual(path.post.tags, ['neon']);
});

test('buildOpenApiSpec: summary uses description when present', () => {
  const tool: ToolSpecEntry = {
    serverId: 'neon', namespacedName: 'neon/run_sql',
    description: 'Execute a SQL query', inputSchema: { type: 'object', properties: {} },
  };
  const spec = buildOpenApiSpec([tool]);
  const path = (spec.paths as Record<string, Record<string, Record<string, unknown>>>)['/tools/neon/run_sql'];
  assert.equal(path.post.summary, 'Execute a SQL query');
});

test('buildOpenApiSpec: summary falls back to namespacedName when description empty', () => {
  const tool: ToolSpecEntry = {
    serverId: 'neon', namespacedName: 'neon/run_sql',
    description: '', inputSchema: { type: 'object', properties: {} },
  };
  const spec = buildOpenApiSpec([tool]);
  const path = (spec.paths as Record<string, Record<string, Record<string, unknown>>>)['/tools/neon/run_sql'];
  assert.equal(path.post.summary, 'neon/run_sql');
});

test('buildOpenApiSpec: requestBody absent when inputSchema has no properties', () => {
  const tool: ToolSpecEntry = {
    serverId: 'neon', namespacedName: 'neon/ping',
    description: 'Ping', inputSchema: { type: 'object', properties: {} },
  };
  const spec = buildOpenApiSpec([tool]);
  const path = (spec.paths as Record<string, Record<string, Record<string, unknown>>>)['/tools/neon/ping'];
  assert.equal(path.post.requestBody, undefined);
});

test('buildOpenApiSpec: requestBody present when inputSchema has properties', () => {
  const tool: ToolSpecEntry = {
    serverId: 'neon', namespacedName: 'neon/run_sql',
    description: 'Run SQL',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  };
  const spec = buildOpenApiSpec([tool]);
  const path = (spec.paths as Record<string, Record<string, Record<string, unknown>>>)['/tools/neon/run_sql'];
  assert.ok(path.post.requestBody !== undefined);
});

test('buildOpenApiSpec: requestBody.required true when required fields present', () => {
  const tool: ToolSpecEntry = {
    serverId: 'neon', namespacedName: 'neon/run_sql',
    description: 'Run SQL',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  };
  const spec = buildOpenApiSpec([tool]);
  const path = (spec.paths as Record<string, Record<string, Record<string, unknown>>>)['/tools/neon/run_sql'];
  const rb = path.post.requestBody as Record<string, unknown>;
  assert.equal(rb.required, true);
});

test('buildOpenApiSpec: requestBody.required false when no required fields', () => {
  const tool: ToolSpecEntry = {
    serverId: 'neon', namespacedName: 'neon/run_sql',
    description: 'Run SQL',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: [] },
  };
  const spec = buildOpenApiSpec([tool]);
  const path = (spec.paths as Record<string, Record<string, Record<string, unknown>>>)['/tools/neon/run_sql'];
  const rb = path.post.requestBody as Record<string, unknown>;
  assert.equal(rb.required, false);
});

test('buildOpenApiSpec: requestBody schema is the full inputSchema', () => {
  const inputSchema = {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
    additionalProperties: false,
  };
  const tool: ToolSpecEntry = {
    serverId: 'neon', namespacedName: 'neon/run_sql', description: 'Run SQL', inputSchema,
  };
  const spec = buildOpenApiSpec([tool]);
  const path = (spec.paths as Record<string, Record<string, Record<string, unknown>>>)['/tools/neon/run_sql'];
  const rb = path.post.requestBody as Record<string, Record<string, Record<string, unknown>>>;
  assert.deepEqual(rb.content['application/json'].schema, inputSchema);
});

test('buildOpenApiSpec: 200 response always present', () => {
  const tool: ToolSpecEntry = {
    serverId: 'neon', namespacedName: 'neon/ping',
    description: 'Ping', inputSchema: { type: 'object', properties: {} },
  };
  const spec = buildOpenApiSpec([tool]);
  const path = (spec.paths as Record<string, Record<string, Record<string, unknown>>>)['/tools/neon/ping'];
  assert.ok('200' in (path.post.responses as Record<string, unknown>));
});

test('buildOpenApiSpec: 400 response always present', () => {
  const tool: ToolSpecEntry = {
    serverId: 'neon', namespacedName: 'neon/ping',
    description: 'Ping', inputSchema: { type: 'object', properties: {} },
  };
  const spec = buildOpenApiSpec([tool]);
  const path = (spec.paths as Record<string, Record<string, Record<string, unknown>>>)['/tools/neon/ping'];
  assert.ok('400' in (path.post.responses as Record<string, unknown>));
});

test('buildOpenApiSpec: two tools from different servers both appear in paths', () => {
  const tools: ToolSpecEntry[] = [
    { serverId: 'neon', namespacedName: 'neon/run_sql', description: 'A', inputSchema: { type: 'object', properties: {} } },
    { serverId: 'tasks', namespacedName: 'tasks/list', description: 'B', inputSchema: { type: 'object', properties: {} } },
  ];
  const spec = buildOpenApiSpec(tools);
  const paths = spec.paths as Record<string, unknown>;
  assert.ok('/tools/neon/run_sql' in paths);
  assert.ok('/tools/tasks/list' in paths);
});

// ═══════════════════════════════════════════════════════════════════════════════
// openapi-spec.ts — parseToolPath
// ═══════════════════════════════════════════════════════════════════════════════

test('parseToolPath: /tools/neon/run_sql → neon/run_sql', () => {
  assert.equal(parseToolPath('/tools/neon/run_sql'), 'neon/run_sql');
});

test('parseToolPath: /tools/tasks/list_tasks → tasks/list_tasks', () => {
  assert.equal(parseToolPath('/tools/tasks/list_tasks'), 'tasks/list_tasks');
});

test('parseToolPath: /tools/a/b → a/b', () => {
  assert.equal(parseToolPath('/tools/a/b'), 'a/b');
});

test('parseToolPath: empty string → null', () => {
  assert.equal(parseToolPath(''), null);
});

test('parseToolPath: /tools only → null (no serverId/toolName)', () => {
  assert.equal(parseToolPath('/tools'), null);
});

test('parseToolPath: /tools/neon only → null (missing toolName)', () => {
  assert.equal(parseToolPath('/tools/neon'), null);
});

test('parseToolPath: /tools/a/b/c → null (too many segments)', () => {
  assert.equal(parseToolPath('/tools/a/b/c'), null);
});

test('parseToolPath: /api/tools/a/b → null (wrong prefix)', () => {
  assert.equal(parseToolPath('/api/tools/a/b'), null);
});

test('parseToolPath: /Tools/a/b → null (case sensitive)', () => {
  assert.equal(parseToolPath('/Tools/a/b'), null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// evaluator.ts — Evaluator (using node:sqlite SqlStorage shim)
// ═══════════════════════════════════════════════════════════════════════════════

test('Evaluator: constructor creates table without throwing', () => {
  const sql = makeSqlStorage();
  assert.doesNotThrow(() => new Evaluator(sql as unknown as SqlStorage));
});

test('Evaluator: getStats returns 0 buffered and 0 flushed on fresh instance', () => {
  const sql = makeSqlStorage();
  const ev = new Evaluator(sql as unknown as SqlStorage);
  const stats = ev.getStats();
  assert.equal(stats.buffered, 0);
  assert.equal(stats.flushed, 0);
});

test('Evaluator: record() increments buffered count', () => {
  const sql = makeSqlStorage();
  const ev = new Evaluator(sql as unknown as SqlStorage);
  ev.record({ ts: Date.now(), route: 'search', latency_ms: 5, ok: true });
  assert.equal(ev.getStats().buffered, 1);
});

test('Evaluator: record() two entries → buffered = 2', () => {
  const sql = makeSqlStorage();
  const ev = new Evaluator(sql as unknown as SqlStorage);
  ev.record({ ts: Date.now(), route: 'search', latency_ms: 5, ok: true });
  ev.record({ ts: Date.now(), route: 'execute', latency_ms: 10, ok: false });
  assert.equal(ev.getStats().buffered, 2);
});

test('Evaluator: flush() returns count of flushed rows', async () => {
  const sql = makeSqlStorage();
  const ev = new Evaluator(sql as unknown as SqlStorage);
  ev.record({ ts: Date.now(), route: 'search', latency_ms: 3, ok: true });
  ev.record({ ts: Date.now(), route: 'cast', latency_ms: 7, ok: true });
  const n = await ev.flush();
  assert.equal(n, 2);
});

test('Evaluator: flush() returns 0 when no buffered rows', async () => {
  const sql = makeSqlStorage();
  const ev = new Evaluator(sql as unknown as SqlStorage);
  const n = await ev.flush();
  assert.equal(n, 0);
});

test('Evaluator: flush() increments totalFlushed in getStats', async () => {
  const sql = makeSqlStorage();
  const ev = new Evaluator(sql as unknown as SqlStorage);
  ev.record({ ts: Date.now(), route: 'execute', latency_ms: 12, ok: true });
  await ev.flush();
  assert.equal(ev.getStats().flushed, 1);
});

test('Evaluator: flush() then getStats().buffered = 0', async () => {
  const sql = makeSqlStorage();
  const ev = new Evaluator(sql as unknown as SqlStorage);
  ev.record({ ts: Date.now(), route: 'search', latency_ms: 4, ok: true });
  await ev.flush();
  assert.equal(ev.getStats().buffered, 0);
});

test('Evaluator: second flush() after first returns 0', async () => {
  const sql = makeSqlStorage();
  const ev = new Evaluator(sql as unknown as SqlStorage);
  ev.record({ ts: Date.now(), route: 'search', latency_ms: 4, ok: true });
  await ev.flush();
  const n2 = await ev.flush();
  assert.equal(n2, 0);
});

test('Evaluator: totalFlushed accumulates across multiple flushes', async () => {
  const sql = makeSqlStorage();
  const ev = new Evaluator(sql as unknown as SqlStorage);
  ev.record({ ts: Date.now(), route: 'search', latency_ms: 1, ok: true });
  await ev.flush();
  ev.record({ ts: Date.now(), route: 'cast', latency_ms: 2, ok: true });
  await ev.flush();
  assert.equal(ev.getStats().flushed, 2);
});

test('Evaluator: measure() returns fn result on success', async () => {
  const sql = makeSqlStorage();
  const ev = new Evaluator(sql as unknown as SqlStorage);
  const val = await ev.measure('search', async () => 'hello');
  assert.equal(val, 'hello');
});

test('Evaluator: measure() records ok=true when fn resolves normally', async () => {
  const sql = makeSqlStorage();
  const ev = new Evaluator(sql as unknown as SqlStorage);
  await ev.measure('search', async () => 42);
  assert.equal(ev.getStats().buffered, 1);
  // verify the persisted ok flag
  const rows = sql.query<{ ok: number; route: string }>('SELECT ok, route FROM evaluator WHERE flushed = 0');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ok, 1, 'ok should be 1 (true) when fn resolves');
  assert.equal(rows[0].route, 'search');
});

test('Evaluator: measure() records even when fn throws (finally block)', async () => {
  const sql = makeSqlStorage();
  const ev = new Evaluator(sql as unknown as SqlStorage);
  await assert.rejects(() => ev.measure('execute', async () => { throw new Error('fail'); }));
  // The record should still have been written (finally block in measure)
  assert.equal(ev.getStats().buffered, 1);
});

test('Evaluator: measure() uses isOk callback to determine ok flag', async () => {
  const sql = makeSqlStorage();
  const ev = new Evaluator(sql as unknown as SqlStorage);
  // isOk returns false → record with ok=false
  await ev.measure('cast', async () => ({ isError: true }), undefined, (v) => !v.isError);
  // verify ok=0 before flushing
  const rows = sql.query<{ ok: number }>('SELECT ok FROM evaluator WHERE flushed = 0');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ok, 0, 'ok should be 0 (false) when isOk returns false');
  const n = await ev.flush();
  assert.equal(n, 1);
});

test('Evaluator: measure() passes server/capability meta to record', async () => {
  const sql = makeSqlStorage();
  const ev = new Evaluator(sql as unknown as SqlStorage);
  await ev.measure('execute', async () => 'ok', { server: 'neon', capability: 'run_sql' });
  // verify server and capability are persisted
  const rows = sql.query<{ server: string | null; capability: string | null; ok: number }>(
    'SELECT server, capability, ok FROM evaluator WHERE flushed = 0',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].server, 'neon');
  assert.equal(rows[0].capability, 'run_sql');
  assert.equal(rows[0].ok, 1);
  const n = await ev.flush();
  assert.equal(n, 1);
});

test('Evaluator: record() with optional fields undefined does not throw', () => {
  const sql = makeSqlStorage();
  const ev = new Evaluator(sql as unknown as SqlStorage);
  assert.doesNotThrow(() =>
    ev.record({ ts: Date.now(), route: 'status', latency_ms: 1, ok: true }),
  );
});

test('Evaluator: latency_ms is rounded to nearest int by record()', async () => {
  const sql = makeSqlStorage();
  const ev = new Evaluator(sql as unknown as SqlStorage);
  ev.record({ ts: 1000, route: 'search', latency_ms: 4.7, ok: true });
  // verify latency_ms stored as 5 (rounded from 4.7) before flushing
  const rows = sql.query<{ latency_ms: number }>('SELECT latency_ms FROM evaluator WHERE flushed = 0');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].latency_ms, 5, 'latency_ms 4.7 should round to 5');
  const n = await ev.flush();
  assert.equal(n, 1);
});
