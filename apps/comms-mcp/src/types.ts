// TS mirrors of the canonical `comms/v1` schemas.
//
// OWNERSHIP NOTE (per apps/comms-mcp/schemas/README.md § "Where these live and who
// owns them"): the canonical, versioned definitions are OWNED BY ChittySchema and
// served from the `comms/v1/*` namespace at https://schema.chitty.cc. ChittySchema
// generates the TS types (`identity/src/types/comms/`) and Zod validators. The
// comms-mcp vertical REFERENCES these shapes, it does not own them. These hand-
// written interfaces are a working copy used to scaffold the build; they should be
// REPLACED BY GENERATED IMPORTS from the published `comms/v1` contract once
// ChittySchema publishes them. Do not let them drift from the schemas/*.json here.
//
// @canon: chittycanon://gov/governance#core-types — communicating endpoints are
// Person (P), actors with agency, never Thing (T).

/** Mirror of unified-comms-entry.schema.json#/$defs/CommParty */
export interface CommParty {
  role: 'sender' | 'recipient' | 'cc' | 'bcc';
  identifier: string;
  identifierKind?: 'phone' | 'email' | 'handle';
  self?: boolean;
  /** Resolved ChittyID of the Person, T=P. Optional, late-resolved; null when unresolved. */
  chittyId?: string | null;
  displayName?: string | null;
}

/** Mirror of unified-comms-entry.schema.json — the FROZEN output shape. */
export interface UnifiedCommsEntry {
  channel: 'quo' | 'imessage' | 'email' | 'twilio' | 'voice';
  provider?: string;
  providerMessageId: string;
  internalId?: string;
  threadRef?: string;
  direction: 'inbound' | 'outbound';
  /** RFC3339 / ISO-8601 UTC. The single sort key for the time-ordered merge. */
  occurredAt: string;
  participants: CommParty[];
  body?: string;
  snippet?: string;
  subject?: string | null;
  transcriptRef?: string | null;
  labels?: string[];
  source?: string;
  /** Non-schema provenance carried per ALCHEMICAL_PROMOTION.md §5. */
  _meta?: Record<string, unknown>;
}

/** Channel discriminator shared by inputs, providers and entries. */
export type Channel = UnifiedCommsEntry['channel'];

// ---- MessagesProvider (messages-provider.schema.json) --------------------------

export interface ProviderOperation {
  op: string;
  inputShape?: Record<string, unknown>;
  notes?: string;
}

export interface ProviderBinding {
  /** ch1tty servers.json id of the backend (e.g. 'chittyagent-quo'). */
  mcpServerId: string;
  /** Concrete tool names the abstract ops map onto. The ONLY place provider wiring lives. */
  tools?: Record<string, string>;
}

export interface RawToUnifiedDescriptor {
  outputSchemaRef: 'https://schema.chitty.cc/comms/v1/unified-comms-entry.schema.json';
  /** Provider-field -> UnifiedCommsEntry-field, grounded in REAL observed responses. */
  fieldMap: Record<string, Record<string, string>>;
  /** Set for providers that do NOT emit direction natively (gmail). null for quo/twilio. */
  deriveDirection?: string | null;
}

export interface ProviderSupports {
  transcripts?: boolean;
  nativeDirection?: boolean;
  nativeThreadId?: boolean;
  localCache?: boolean;
}

/** Mirror of messages-provider.schema.json — the injection-point contract. */
export interface MessagesProvider {
  capability: 'messages';
  channel: Channel;
  provider?: string;
  binding?: ProviderBinding;
  resolveContact: ProviderOperation;
  listMessages: ProviderOperation;
  getMessage?: ProviderOperation;
  rawToUnified: RawToUnifiedDescriptor;
  supports?: ProviderSupports;
}

// ---- comms.recentLog I/O (comms.recentLog.schema.json) -------------------------

/** Mirror of comms.recentLog.schema.json#/$defs/Input. Exactly one of person|identifier. */
export interface RecentLogInput {
  person?: string;
  identifier?: string;
  channels?: Channel[];
  days?: number;
  since?: string;
  until?: string;
  limit?: number;
  order?: 'desc' | 'asc';
  includeBody?: boolean;
}

export interface ResolvedContact {
  chittyId?: string | null;
  identifiers?: string[];
  displayName?: string | null;
}

export interface ChannelQueried {
  channel: Channel;
  provider?: string;
  ok: boolean;
  count: number;
  reshapedBy?: 'cached' | 'regenerated' | 'none';
  error?: string | null;
}

export interface RecentLogWindow {
  since: string;
  until: string;
}

export interface RecentLogMetadata {
  resolvedContact: ResolvedContact;
  channelsQueried: ChannelQueried[];
  window: RecentLogWindow;
  totalBeforeLimit?: number;
  truncated?: boolean;
}

/** Mirror of comms.recentLog.schema.json#/$defs/Output. */
export interface RecentLogOutput {
  entries: UnifiedCommsEntry[];
  metadata: RecentLogMetadata;
}

/**
 * The late-binding seam. The combo never calls a concrete MCP tool directly; it
 * dispatches abstract (mcpServerId, tool, args) through this interface. A real
 * MCP-client implementation lives in src/dispatch.ts; tests inject a real-shaped
 * stub. A missing endpoint/token OR a failed call must surface as an error
 * (channel degrades to ok:false) — never a silent fallback, never fake data.
 */
export interface CommsDispatch {
  call(mcpServerId: string, tool: string, args: Record<string, unknown>): Promise<unknown>;
}

/** The owner identity bundle — the self-identifiers (E.164 numbers + emails) that
 *  belong to the ChittyOS account owner. Passed into the reshapers so "self"
 *  detection is never hardcoded. */
export interface OwnerIdentity {
  /** Lowercased / normalized self identifiers (E.164 phones and email addresses). */
  identifiers: string[];
  displayName?: string | null;
  chittyId?: string | null;
}
