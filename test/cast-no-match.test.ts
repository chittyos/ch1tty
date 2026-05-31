/**
 * cast: no_match and cast: discovered path tests.
 *
 * These two return shapes have had zero dedicated test coverage:
 *
 *   cast: 'no_match'   — all surfaces (tools, prompts, resources) score ≤ 0.1
 *                        for the given intent.  Returned as a non-error informational
 *                        response with a hint.
 *   cast: 'discovered' — tools scored ≤ 0.1 but at least one prompt or resource
 *                        scored > 0.1.  Response includes the matched prompts/resources
 *                        without executing anything.
 *
 * All five tests use minimal in-process FixtureBackend setups to isolate the
 * exact scoring path that triggers each shape.  No real processes are spawned.
 */
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Aggregator } from '../src/aggregator.js';
import { FixtureBackend } from './fixture-backend.js';
import type { ServerConfig } from '../src/types.js';

function dlqPath(label: string): string {
  return join(tmpdir(), `ch1tty-nomatch-${label}-${Date.now()}.jsonl`);
}

function makeAgg(
  serverId: string,
  setupBackend: (b: FixtureBackend) => void,
): { agg: Aggregator; backend: FixtureBackend } {
  const backend = new FixtureBackend();
  setupBackend(backend);
  const configs: ServerConfig[] = [
    {
      id: serverId,
      name: serverId,
      type: 'remote',
      access: 'readwrite',
      category: 'ecosystem',
      endpoint: `https://${serverId}.test/mcp`,
      lazy: true,
    },
  ];
  const agg = new Aggregator(configs, {
    backendFactory: () => backend,
    embedEnabled: false,
    ledgerDlqPath: dlqPath(serverId),
    suggestionsCatalog: {},
  });
  return { agg, backend };
}

// ── 1. no_match — completely unknown intent keywords ─────────────────────────

test('cast: no_match when intent keywords are absent from all tools, prompts, resources', async () => {
  // Register a server with a tool whose description has no overlap with the intent.
  const { agg } = makeAgg('greeting', (b) =>
    b.defineServer('greeting', {
      tools: [
        {
          name: 'say_hello',
          description: 'greet a user with a friendly hello message',
          inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
          response: { content: [{ type: 'text', text: 'Hello!' }] },
        },
      ],
    }),
  );

  try {
    // Terms ["xyzzy", "frobulate", "qqqzzz"] — none appear in any fixture
    const result = await agg.callTool('ch1tty/cast', { intent: 'xyzzy frobulate qqqzzz' });
    assert.equal(result.isError, undefined, 'no_match is not a tool-level error');

    const data = JSON.parse(result.content[0].text as string);
    assert.equal(data.cast, 'no_match');
    assert.equal(data.resolvedBy, 'keyword');
    assert.equal(data.intent, 'xyzzy frobulate qqqzzz');
    assert.ok(typeof data.hint === 'string' && data.hint.length > 0, 'hint string present');
    assert.equal(data.tools, undefined, 'no tools field on no_match');
  } finally {
    await agg.shutdown();
  }
});

// ── 2. no_match — all intent terms filtered out (length ≤ 2) ────────────────

test('cast: no_match when all intent terms are ≤ 2 chars and filtered to empty', async () => {
  // With empty terms array, every tool/prompt/resource scores exactly 0 (< 0.1),
  // so all filtered lists are empty → no_match.
  const { agg } = makeAgg('tools-server', (b) =>
    b.defineServer('tools-server', {
      tools: [
        {
          name: 'list_items',
          description: 'list all items in the registry',
          inputSchema: { type: 'object', properties: {} },
          response: { content: [{ type: 'text', text: '[]' }] },
        },
      ],
    }),
  );

  try {
    // "go do it" → split → ["go", "do", "it"] → all length 2 → filtered → terms = []
    const result = await agg.callTool('ch1tty/cast', { intent: 'go do it' });
    assert.equal(result.isError, undefined, 'no_match is informational, not an error');

    const data = JSON.parse(result.content[0].text as string);
    assert.equal(data.cast, 'no_match');
    assert.equal(data.resolvedBy, 'keyword');
    assert.equal(data.intent, 'go do it');
    assert.ok(data.hint.includes('Try ch1tty/search'), 'hint suggests ch1tty/search');
  } finally {
    await agg.shutdown();
  }
});

// ── 3. no_match — server registered but has no tools, prompts, or resources ──

test('cast: no_match when the only registered server has no tools, prompts, or resources', async () => {
  const { agg } = makeAgg('empty', (b) =>
    b.defineServer('empty', { tools: [] }),
  );

  try {
    // Even a meaningful intent scores nothing if the registry is empty
    const result = await agg.callTool('ch1tty/cast', { intent: 'list all database projects' });
    assert.equal(result.isError, undefined);

    const data = JSON.parse(result.content[0].text as string);
    assert.equal(data.cast, 'no_match');
    assert.equal(data.resolvedBy, 'keyword');
  } finally {
    await agg.shutdown();
  }
});

// ── 4. discovered — matching prompt exists, no tools registered ──────────────

test('cast: discovered when a prompt matches but no tools are registered', async () => {
  // Server has no tools, one prompt whose description overlaps the intent.
  const { agg } = makeAgg('runbook', (b) =>
    b.defineServer('runbook', {
      tools: [],
      prompts: [
        {
          name: 'deploy-runbook',
          description: 'runbook for safe production deployment procedures',
        },
      ],
    }),
  );

  try {
    // Terms ["production", "deployment", "runbook"] all appear in the prompt description
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'production deployment runbook',
      confirm: true,
    });
    assert.equal(result.isError, undefined);

    const data = JSON.parse(result.content[0].text as string);
    assert.equal(data.cast, 'discovered');
    assert.equal(data.resolvedBy, 'keyword');
    assert.equal(data.intent, 'production deployment runbook');
    assert.ok(data.hint.includes('No executable tools'), 'hint explains no tools matched');

    // The matched prompt is surfaced in the response (name is namespaced: serverId/promptName)
    assert.ok(Array.isArray(data.prompts) && data.prompts.length > 0, 'prompts array present');
    assert.equal(data.prompts[0].name, 'runbook/deploy-runbook', 'prompt name is namespaced');
    assert.ok(typeof data.prompts[0].score === 'number' && data.prompts[0].score > 0.1, 'prompt has positive score');
    assert.equal(data.resources, undefined, 'no resources field when only prompts matched');
  } finally {
    await agg.shutdown();
  }
});

// ── 5. discovered — matching resource exists, no tools registered ─────────────

test('cast: discovered when a resource matches but no tools are registered', async () => {
  // Server has no tools, one resource whose description overlaps the intent.
  const { agg } = makeAgg('docs', (b) =>
    b.defineServer('docs', {
      tools: [],
      resources: [
        {
          uri: 'readme',
          name: 'project-readme',
          description: 'quickstart guide for new contributors joining the project',
        },
      ],
    }),
  );

  try {
    // Terms ["quickstart", "joining", "contributors"] all in resource description
    const result = await agg.callTool('ch1tty/cast', {
      intent: 'quickstart joining contributors',
    });
    assert.equal(result.isError, undefined);

    const data = JSON.parse(result.content[0].text as string);
    assert.equal(data.cast, 'discovered');
    assert.equal(data.resolvedBy, 'keyword');

    // The matched resource is surfaced in the response (URI is namespaced: serverId://originalUri)
    assert.ok(Array.isArray(data.resources) && data.resources.length > 0, 'resources array present');
    assert.equal(data.resources[0].uri, 'docs://readme', 'resource URI is namespaced with serverId');
    assert.ok(typeof data.resources[0].score === 'number' && data.resources[0].score > 0.1, 'resource has positive score');
    assert.equal(data.prompts, undefined, 'no prompts field when only resources matched');
  } finally {
    await agg.shutdown();
  }
});
