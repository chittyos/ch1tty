// The combo. Encodes the durable SHAPE (ALCHEMICAL_PROMOTION.md §2b/§3):
//   resolveContact → fan out listMessages across requested+bound channels (in
//   parallel, each wrapped so one failure degrades that channel to ok:false only)
//   → reshape each raw row → merge by occurredAt → apply order + limit → assemble
//   { entries, metadata }.
//
// The vertical OWNS this cross-canonical fan-out (no single home service owns
// quo+imessage+email together). It references the `messages` capability via
// late-bound MessagesProvider descriptors, never a concrete tool. The only seam to
// the backends is the injected CommsDispatch.
//
// @canon: chittycanon://gov/governance#core-types

import type {
  Channel,
  ChannelQueried,
  CommsDispatch,
  MessagesProvider,
  OwnerIdentity,
  RecentLogInput,
  RecentLogOutput,
  UnifiedCommsEntry,
} from './types.js';
import { gmailRawToUnified, quoRawToUnified, type GmailRawMessage, type QuoRawRow } from './reshape.js';
import { defaultBoundProviders, imessageProviderUnbound } from './providers.js';

const DEFAULT_CHANNELS: Channel[] = ['quo', 'imessage', 'email'];
const QUO_RESOLVE_MAX = 50; // OpenPhone caps at 50 — never over-ask (drift bug).

export interface RecentLogDeps {
  dispatch: CommsDispatch;
  owner: OwnerIdentity;
  /** Bound providers keyed by channel. Defaults to quo+gmail. */
  providers?: Map<Channel, MessagesProvider>;
}

/**
 * Extract an array of raw provider rows from a dispatch result. Handles both:
 *  - a plain array (test DI of real-shaped rows), and
 *  - an MCP tool content envelope { content: [{ type:'text', text: JSON }] }.
 * Throws on an unrecognized shape — never silently returns [].
 */
export function extractRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    // MCP content envelope
    if (Array.isArray(obj.content)) {
      const textItem = (obj.content as Array<Record<string, unknown>>).find(
        (c) => c.type === 'text' && typeof c.text === 'string',
      );
      if (textItem) {
        const parsed = JSON.parse(textItem.text as string);
        return extractRows(parsed);
      }
    }
    // Common wrappers
    for (const key of ['messages', 'rows', 'results', 'data', 'items', 'threads']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
  }
  throw new Error(`unrecognized listMessages result shape: ${typeof result}`);
}

/** Flatten gmail thread results into per-message rows, carrying the thread id. */
function flattenGmail(rows: unknown[]): Array<{ msg: GmailRawMessage; threadId?: string }> {
  const out: Array<{ msg: GmailRawMessage; threadId?: string }> = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const obj = r as Record<string, unknown>;
    if (Array.isArray(obj.messages)) {
      const threadId = (obj.id as string | undefined) ?? (obj.threadId as string | undefined);
      for (const m of obj.messages as GmailRawMessage[]) out.push({ msg: m, threadId });
    } else {
      out.push({ msg: obj as GmailRawMessage, threadId: obj.threadId as string | undefined });
    }
  }
  return out;
}

function computeWindow(input: RecentLogInput): { since: string; until: string } {
  const until = input.until ? new Date(input.until) : new Date();
  let since: Date;
  if (input.since) {
    since = new Date(input.since);
  } else {
    const days = input.days ?? 30;
    since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
  }
  return { since: since.toISOString(), until: until.toISOString() };
}

async function fetchChannel(
  channel: Channel,
  provider: MessagesProvider,
  deps: RecentLogDeps,
  identifiers: string[],
  input: RecentLogInput,
  window: { since: string; until: string },
): Promise<{ entries: UnifiedCommsEntry[]; queried: ChannelQueried }> {
  const tool = provider.binding?.tools?.listMessages;
  const serverId = provider.binding?.mcpServerId;
  if (!serverId || !tool) {
    return {
      entries: [],
      queried: { channel, provider: provider.provider, ok: false, count: 0, reshapedBy: 'none', error: 'provider not bound (no listMessages tool)' },
    };
  }

  try {
    let entries: UnifiedCommsEntry[];
    if (channel === 'quo') {
      const args: Record<string, unknown> = {
        participants: identifiers,
        since: window.since,
        until: window.until,
        limit: input.limit ?? 100,
        maxResults: QUO_RESOLVE_MAX,
      };
      const raw = extractRows(await deps.dispatch.call(serverId, tool, args));
      entries = raw.map((row) => quoRawToUnified(row as QuoRawRow, deps.owner));
    } else if (channel === 'email') {
      const q = identifiers.map((id) => `from:${id} OR to:${id}`).join(' OR ');
      const args: Record<string, unknown> = {
        q,
        after: window.since,
        before: window.until,
        maxResults: input.limit ?? 100,
      };
      const raw = extractRows(await deps.dispatch.call(serverId, tool, args));
      entries = flattenGmail(raw).map(({ msg, threadId }) =>
        gmailRawToUnified(msg, deps.owner, threadId),
      );
    } else {
      // A bound provider for an unhandled channel: surface honestly, never fake.
      return {
        entries: [],
        queried: { channel, provider: provider.provider, ok: false, count: 0, reshapedBy: 'none', error: `no reshaper wired for channel ${channel}` },
      };
    }

    // Window filter (provider may over-return).
    const sinceMs = Date.parse(window.since);
    const untilMs = Date.parse(window.until);
    entries = entries.filter((e) => {
      const t = Date.parse(e.occurredAt);
      return Number.isFinite(t) && t >= sinceMs && t <= untilMs;
    });

    return {
      entries,
      // Honest: these reshapers are statically hand-bound, not codemode-regenerated.
      queried: { channel, provider: provider.provider, ok: true, count: entries.length, reshapedBy: 'none', error: null },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      entries: [],
      queried: { channel, provider: provider.provider, ok: false, count: 0, reshapedBy: 'none', error: msg },
    };
  }
}

export async function recentLog(input: RecentLogInput, deps: RecentLogDeps): Promise<RecentLogOutput> {
  const providers = deps.providers ?? defaultBoundProviders();
  const requested = (input.channels && input.channels.length ? input.channels : DEFAULT_CHANNELS);
  const window = computeWindow(input);
  const order = input.order ?? 'desc';
  const limit = input.limit ?? 100;

  // resolveContact: fan a raw identifier (or person's known endpoints) out to the
  // sibling identifiers each provider's listMessages needs. With a raw identifier
  // we have exactly one endpoint to start from; chittyId resolution is late and
  // may not succeed — be honest about partial resolution.
  const seedIdentifier = input.identifier ?? input.person;
  const identifiers: string[] = seedIdentifier ? [seedIdentifier] : [];
  const resolvedContact = {
    chittyId: input.person && /-P-/.test(input.person) ? input.person : null,
    identifiers,
    displayName: null as string | null,
  };

  const results = await Promise.all(
    requested.map(async (channel): Promise<{ entries: UnifiedCommsEntry[]; queried: ChannelQueried }> => {
      const provider = providers.get(channel);
      if (!provider) {
        // Requested-but-unbound channel (e.g. default imessage). Distinct path from
        // "bound provider call threw": degrade to ok:false with an honest reason.
        const reason =
          channel === 'imessage'
            ? imessageProviderUnbound.reason
            : `no bound provider for channel ${channel}`;
        return {
          entries: [],
          queried: { channel, provider: channel === 'imessage' ? imessageProviderUnbound.provider : undefined, ok: false, count: 0, reshapedBy: 'none', error: reason },
        };
      }
      return fetchChannel(channel, provider, deps, identifiers, input, window);
    }),
  );

  const channelsQueried = results.map((r) => r.queried);
  let entries = results.flatMap((r) => r.entries);

  // Merge by occurredAt (parsed time, offsets may differ across providers).
  entries.sort((a, b) => {
    const ta = Date.parse(a.occurredAt);
    const tb = Date.parse(b.occurredAt);
    return order === 'asc' ? ta - tb : tb - ta;
  });

  const totalBeforeLimit = entries.length;
  const truncated = totalBeforeLimit > limit;
  if (truncated) entries = entries.slice(0, limit);

  return {
    entries,
    metadata: {
      resolvedContact,
      channelsQueried,
      window,
      totalBeforeLimit,
      truncated,
    },
  };
}
