/**
 * EEEE batch — child-manager.ts callTool success path + listPrompts argument mapping.
 *
 * Gaps covered (2 branches):
 *   1. callTool success (child-manager.ts:239): normalizeToolResult return when
 *      client.callTool succeeds. Prior tests only reach the circuit-open early-return
 *      or the catch/rethrow paths; none calls callTool with a working fake doSpawn.
 *   2. listPrompts arguments map body (child-manager.ts:327): p.arguments?.map executes
 *      when a prompt has a non-empty arguments array. Prior tests return prompts with
 *      no arguments, so the inner map body is never entered.
 *
 * Uses the same doSpawn-patching pattern as child-manager-cache.test.ts — no real
 * process is spawned; the patched doSpawn returns a ChildConnection with a minimal
 * stub client.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.CH1TTY_SPAWN_TIMEOUT_MS = '500';

const { ChildManager } = await import('../src/child-manager.js');

import type { LocalServerConfig } from '../src/types.js';

function localConfig(id: string): LocalServerConfig {
  return {
    id, name: id, type: 'local', access: 'readwrite', category: 'code',
    command: `/nonexistent/${id}`,
    args: [],
  };
}

// ── 1. callTool success path (child-manager.ts:239) ─────────────────────────

describe('EEEE — callTool success path', { concurrency: false }, () => {
  test('callTool: client.callTool succeeds → normalizeToolResult return (line 239)', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('ct1'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).doSpawn = async () => ({
      client: {
        listTools: async () => ({ tools: [] }),
        listResources: async () => ({ resources: [] }),
        listResourceTemplates: async () => ({ resourceTemplates: [] }),
        listPrompts: async () => ({ prompts: [] }),
        callTool: async () => ({
          content: [{ type: 'text', text: 'echoed-result' }],
          isError: false,
        }),
        close: async () => {},
      },
      transport: {},
      toolCache: null,
      resourceCache: null,
      promptCache: null,
    });

    const result = await cm.callTool('ct1', 'my-tool', { key: 'val' });
    assert.deepEqual(result, {
      content: [{ type: 'text', text: 'echoed-result' }],
      isError: false,
    });
  });
});

// ── 2. listPrompts arguments map body (child-manager.ts:327) ────────────────

describe('EEEE — listPrompts arguments mapping', { concurrency: false }, () => {
  test('listPrompts: prompts with non-empty arguments array → arguments mapped onto PromptEntry (line 327)', async () => {
    const cm = new ChildManager();
    cm.registerServer(localConfig('lp1'));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cm as any).doSpawn = async () => ({
      client: {
        listTools: async () => ({ tools: [] }),
        listResources: async () => ({ resources: [] }),
        listResourceTemplates: async () => ({ resourceTemplates: [] }),
        listPrompts: async () => ({
          prompts: [
            {
              name: 'create-task',
              description: 'Create a task prompt',
              arguments: [
                { name: 'title', description: 'Task title', required: true },
                { name: 'due', description: 'Optional due date', required: false },
              ],
            },
          ],
        }),
        callTool: async () => { throw new Error('callTool not stubbed'); },
        close: async () => {},
      },
      transport: {},
      toolCache: null,
      resourceCache: null,
      promptCache: null,
    });

    const prompts = await cm.listPrompts('lp1');
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].name, 'create-task');
    assert.deepEqual(prompts[0].arguments, [
      { name: 'title', description: 'Task title', required: true },
      { name: 'due', description: 'Optional due date', required: false },
    ]);
  });
});
