/**
 * Workstream BK: branch gaps in recent-log.ts (lines 103–108) and
 * workers-ai-brain.ts (lines 208, 270).
 *
 *   1. recent-log.ts:103 — fetchChannel: provider in map but binding undefined
 *      → !serverId || !tool → returns ok:false "provider not bound (no listMessages tool)"
 *   2. recent-log.ts:103 — fetchChannel: binding present but tools.listMessages absent
 *      → same branch fires (tool is undefined)
 *   3. workers-ai-brain.ts:208 — indexCandidates: c.category undefined → '' fallback
 *   4. workers-ai-brain.ts:270 — candidateFromMetadata: metadata.category not a string
 *      → category set to undefined
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recentLog } from '../src/recent-log.ts';
import { WorkersAiBrain, type ToolCandidate } from '../../../src/workers-ai-brain.js';
import type {
  Channel,
  CommsDispatch,
  MessagesProvider,
  OwnerIdentity,
} from '../src/types.ts';

// ── Shared helpers ────────────────────────────────────────────────────────────

const OWNER: OwnerIdentity = {
  identifiers: ['owner@example.com'],
  displayName: 'Owner',
  chittyId: null,
};

const WIN = { since: '2026-09-01T00:00:00Z', until: '2026-09-30T00:00:00Z' } as const;

const UNIFIED_REF =
  'https://schema.chitty.cc/comms/v1/unified-comms-entry.schema.json' as const;

function emptyDispatch(): CommsDispatch {
  return {
    async call() {
      return [];
    },
  };
}

function providerMap(...ps: MessagesProvider[]): Map<Channel, MessagesProvider> {
  const m = new Map<Channel, MessagesProvider>();
  for (const p of ps) m.set(p.channel, p);
  return m;
}

function makeUnboundProvider(channel: Channel, bindingOverride?: MessagesProvider['binding']): MessagesProvider {
  return {
    capability: 'messages',
    channel,
    provider: channel,
    binding: bindingOverride,
    resolveContact: { op: 'resolveContact', inputShape: {} },
    listMessages: { op: 'listMessages', inputShape: {} },
    rawToUnified: {
      outputSchemaRef: UNIFIED_REF,
      fieldMap: {},
    },
  };
}

// ── 1. fetchChannel: binding undefined → !serverId || !tool fires ─────────────

describe('recent-log.ts:103 — no binding (undefined)', () => {
  it('returns ok:false "provider not bound" when provider.binding is undefined', async () => {
    const provider = makeUnboundProvider('quo', undefined);
    const out = await recentLog(
      { identifier: '+15555550001', channels: ['quo'], ...WIN },
      { dispatch: emptyDispatch(), owner: OWNER, providers: providerMap(provider) },
    );
    const ch = out.metadata.channelsQueried.find((c) => c.channel === 'quo')!;
    assert.ok(ch, 'quo channel entry must exist');
    assert.equal(ch.ok, false, 'channel must be ok:false');
    assert.match(ch.error ?? '', /provider not bound/, 'error must mention "provider not bound"');
    assert.equal(ch.count, 0);
    assert.equal(out.entries.length, 0);
  });
});

// ── 2. fetchChannel: binding present but tools.listMessages absent → !tool fires

describe('recent-log.ts:103 — binding present but listMessages tool absent', () => {
  it('returns ok:false "provider not bound" when binding.tools has no listMessages', async () => {
    const provider = makeUnboundProvider('email', {
      mcpServerId: 'chittyagent-google',
      tools: { resolveContact: 'gmail_resolve' }, // listMessages absent
    });
    const out = await recentLog(
      { identifier: 'alice@example.com', channels: ['email'], ...WIN },
      { dispatch: emptyDispatch(), owner: OWNER, providers: providerMap(provider) },
    );
    const ch = out.metadata.channelsQueried.find((c) => c.channel === 'email')!;
    assert.ok(ch, 'email channel entry must exist');
    assert.equal(ch.ok, false, 'channel must be ok:false when listMessages tool is absent');
    assert.match(ch.error ?? '', /provider not bound/, 'error must mention "provider not bound"');
    assert.equal(ch.count, 0);
    assert.equal(out.entries.length, 0);
  });
});

// ── AI brain helpers ──────────────────────────────────────────────────────────

type AiRunFn = (model: string, opts: { text: string[] }) => Promise<{ data?: number[][] }>;

function makeAi(runFn: AiRunFn): Ai {
  return { run: runFn } as unknown as Ai;
}

type VectorizeQueryFn = (
  vec: number[],
  opts: { topK: number; returnMetadata: boolean },
) => Promise<{ matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> }>;

function makeVectorize(queryFn: VectorizeQueryFn): VectorizeIndex {
  return {
    query: queryFn,
    upsert: async () => ({ count: 0 }),
  } as unknown as VectorizeIndex;
}

function cand(name: string, desc = 'desc', category?: string): ToolCandidate {
  return { namespacedName: name, description: desc, ...(category !== undefined ? { category } : {}) };
}

// ── 3. indexCandidates: c.category undefined → '' fallback (line 208) ────────

describe('workers-ai-brain.ts:208 — indexCandidates category fallback to ""', () => {
  it('upserts with category="" when candidate has no category field', async () => {
    const upserted: Array<{ id: string; metadata?: Record<string, unknown> }> = [];
    const ai = makeAi(async (_m, { text }) => ({ data: text.map(() => [1, 0, 0]) }));
    const vz = {
      query: async () => ({ matches: [] }),
      upsert: async (items: VectorizeVector[]) => {
        upserted.push(...items);
        return { count: items.length };
      },
    } as unknown as VectorizeIndex;

    const brain = new WorkersAiBrain(ai, vz, {});
    // candidate with no category field — c.category is undefined → ?? '' → ''
    const count = await brain.indexCandidates([cand('s/tool', 'Some tool')]);
    assert.equal(count, 1, 'one vector upserted');
    assert.ok(upserted.length === 1, 'upsert must have been called');
    assert.equal(upserted[0]!.metadata!['category'], '', "category in metadata must be '' when candidate.category is undefined");
  });
});

// ── 4. candidateFromMetadata: metadata.category not a string → undefined (line 270)

describe('workers-ai-brain.ts:270 — candidateFromMetadata category non-string → undefined', () => {
  it('sets category to undefined when metadata.category is not a string', async () => {
    let callN = 0;
    const ai = makeAi(async (_m, { text }) => {
      callN++;
      return { data: text.map(() => [1, 0, 0]) };
    });
    const vz = makeVectorize(async () => ({
      matches: [
        {
          id: 'svc/method',
          score: 0.9,
          metadata: {
            namespacedName: 'svc/method',
            description: 'a tool',
            // category is a number — not a string → typeof check false → undefined
            category: 42,
          },
        },
      ],
    }));
    const brain = new WorkersAiBrain(ai, vz, { minSimilarity: 0 });
    // pass a candidate that is NOT in the vectorize result so candidateFromMetadata fires
    const result = await brain.route('query', [cand('other/tool', 'Other')]);
    assert.ok(callN >= 1, 'embed must have been called');
    assert.ok(result !== null, 'route must return a result array (not null)');
    const match = result!.find((r) => r.tool.namespacedName === 'svc/method');
    assert.ok(match, 'tool from metadata must surface');
    assert.equal(match!.tool.category, undefined, 'category must be undefined when metadata.category is not a string');
  });
});
