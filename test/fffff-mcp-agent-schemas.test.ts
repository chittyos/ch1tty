/**
 * Workstream S: unit tests for src/mcp-agent-schemas.ts
 *
 * The Ch1ttyMcpAgent (/mcp2) tool parameter schemas are pure Zod definitions
 * with no Cloudflare runtime dependencies. This file tests each schema's
 * validation behaviour: required fields, optional fields, type rejection,
 * enum validation, and nested object structure.
 *
 * All 8 schemas are exercised: Search, Execute, Code, Cast, Provision,
 * MemoryRecall, MemoryIngest, MemorySummary.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import {
  SearchSchema,
  ExecuteSchema,
  CodeSchema,
  CastSchema,
  ProvisionSchema,
  MemoryRecallSchema,
  MemoryIngestSchema,
  MemorySummarySchema,
} from '../src/mcp-agent-schemas.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wrap a Zod schema object in z.object() and parse safely. */
function safeParse<T extends Record<string, z.ZodTypeAny>>(
  schema: T,
  data: unknown,
): z.SafeParseReturnType<z.objectOutputType<T, z.ZodTypeAny>> {
  return z.object(schema).safeParse(data);
}

// ── SearchSchema ──────────────────────────────────────────────────────────────

describe('SearchSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    const result = safeParse(SearchSchema, {});
    assert.ok(result.success, 'empty object should be valid');
  });

  it('accepts all fields populated', () => {
    const result = safeParse(SearchSchema, {
      query: 'list projects',
      server: 'neon',
      category: 'code',
      focus: 'finance',
      limit: 20,
    });
    assert.ok(result.success);
  });

  it('rejects non-string query', () => {
    const result = safeParse(SearchSchema, { query: 42 });
    assert.ok(!result.success, 'number query should fail');
  });

  it('rejects non-number limit', () => {
    const result = safeParse(SearchSchema, { limit: 'twenty' });
    assert.ok(!result.success, 'string limit should fail');
  });

  it('all fields have non-empty describe()', () => {
    for (const [key, field] of Object.entries(SearchSchema)) {
      const desc = (field as unknown as { description?: string }).description;
      assert.ok(typeof desc === 'string' && desc.length > 0,
        `SearchSchema.${key} should have a non-empty describe()`);
    }
  });
});

// ── ExecuteSchema ─────────────────────────────────────────────────────────────

describe('ExecuteSchema', () => {
  it('requires tool field', () => {
    const result = safeParse(ExecuteSchema, {});
    assert.ok(!result.success, 'missing tool should fail');
  });

  it('accepts tool only (args optional)', () => {
    const result = safeParse(ExecuteSchema, { tool: 'neon/list_projects' });
    assert.ok(result.success);
  });

  it('accepts tool + args object', () => {
    const result = safeParse(ExecuteSchema, { tool: 'neon/run_sql', args: { query: 'SELECT 1' } });
    assert.ok(result.success);
    if (result.success) {
      assert.deepEqual(result.data.args, { query: 'SELECT 1' });
    }
  });

  it('rejects non-string tool', () => {
    const result = safeParse(ExecuteSchema, { tool: 123 });
    assert.ok(!result.success);
  });
});

// ── CodeSchema ────────────────────────────────────────────────────────────────

describe('CodeSchema', () => {
  it('requires code field', () => {
    const result = safeParse(CodeSchema, {});
    assert.ok(!result.success, 'missing code should fail');
  });

  it('accepts a code string', () => {
    const result = safeParse(CodeSchema, { code: 'return await neon.execute("run_sql", {})' });
    assert.ok(result.success);
  });

  it('rejects non-string code', () => {
    const result = safeParse(CodeSchema, { code: null });
    assert.ok(!result.success);
  });
});

// ── CastSchema ────────────────────────────────────────────────────────────────

describe('CastSchema', () => {
  it('requires intent field', () => {
    const result = safeParse(CastSchema, {});
    assert.ok(!result.success, 'missing intent should fail');
  });

  it('accepts intent only', () => {
    const result = safeParse(CastSchema, { intent: 'list my databases' });
    assert.ok(result.success);
  });

  it('accepts intent + confirm:true + focus', () => {
    const result = safeParse(CastSchema, {
      intent: 'check balances',
      confirm: true,
      focus: 'finance',
    });
    assert.ok(result.success);
    if (result.success) assert.equal(result.data.confirm, true);
  });

  it('rejects non-boolean confirm', () => {
    const result = safeParse(CastSchema, { intent: 'ok', confirm: 'yes' });
    assert.ok(!result.success, 'string confirm should fail');
  });

  it('rejects non-string intent', () => {
    const result = safeParse(CastSchema, { intent: 42 });
    assert.ok(!result.success);
  });
});

// ── ProvisionSchema ───────────────────────────────────────────────────────────

describe('ProvisionSchema', () => {
  it('requires both intent and entityId', () => {
    assert.ok(!safeParse(ProvisionSchema, {}).success, 'empty should fail');
    assert.ok(!safeParse(ProvisionSchema, { intent: 'monitor' }).success, 'missing entityId should fail');
    assert.ok(!safeParse(ProvisionSchema, { entityId: 'ent-123' }).success, 'missing intent should fail');
  });

  it('accepts both fields', () => {
    const result = safeParse(ProvisionSchema, { intent: 'monitor finances', entityId: 'ent-123' });
    assert.ok(result.success);
  });
});

// ── MemoryRecallSchema ────────────────────────────────────────────────────────

describe('MemoryRecallSchema', () => {
  it('requires profile and query', () => {
    assert.ok(!safeParse(MemoryRecallSchema, {}).success);
    assert.ok(!safeParse(MemoryRecallSchema, { profile: 'nick' }).success);
    assert.ok(!safeParse(MemoryRecallSchema, { query: 'what did we decide?' }).success);
  });

  it('accepts both required fields', () => {
    const result = safeParse(MemoryRecallSchema, { profile: 'nick', query: 'what did we decide?' });
    assert.ok(result.success);
  });
});

// ── MemoryIngestSchema ────────────────────────────────────────────────────────

describe('MemoryIngestSchema', () => {
  it('requires profile and messages', () => {
    assert.ok(!safeParse(MemoryIngestSchema, {}).success);
    assert.ok(!safeParse(MemoryIngestSchema, { profile: 'nick' }).success, 'missing messages should fail');
  });

  it('accepts valid messages array', () => {
    const result = safeParse(MemoryIngestSchema, {
      profile: 'nick',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ],
    });
    assert.ok(result.success);
  });

  it('rejects invalid role in messages', () => {
    const result = safeParse(MemoryIngestSchema, {
      profile: 'nick',
      messages: [{ role: 'bot', content: 'hi' }],
    });
    assert.ok(!result.success, 'invalid role should fail');
  });

  it('rejects non-string message content', () => {
    const result = safeParse(MemoryIngestSchema, {
      profile: 'nick',
      messages: [{ role: 'user', content: 42 }],
    });
    assert.ok(!result.success);
  });

  it('accepts optional sessionId', () => {
    const result = safeParse(MemoryIngestSchema, {
      profile: 'nick',
      sessionId: 'sess-abc',
      messages: [{ role: 'system', content: 'you are helpful' }],
    });
    assert.ok(result.success);
    if (result.success) assert.equal(result.data.sessionId, 'sess-abc');
  });

  it('accepts all three valid role values', () => {
    for (const role of ['system', 'user', 'assistant'] as const) {
      const result = safeParse(MemoryIngestSchema, {
        profile: 'p',
        messages: [{ role, content: 'msg' }],
      });
      assert.ok(result.success, `role '${role}' should be valid`);
    }
  });
});

// ── MemorySummarySchema ───────────────────────────────────────────────────────

describe('MemorySummarySchema', () => {
  it('requires profile', () => {
    assert.ok(!safeParse(MemorySummarySchema, {}).success);
  });

  it('accepts profile only (sessionId optional)', () => {
    const result = safeParse(MemorySummarySchema, { profile: 'team-alpha' });
    assert.ok(result.success);
  });

  it('accepts profile + sessionId', () => {
    const result = safeParse(MemorySummarySchema, { profile: 'team-alpha', sessionId: 'sess-xyz' });
    assert.ok(result.success);
    if (result.success) assert.equal(result.data.sessionId, 'sess-xyz');
  });
});
