# comms-mcp schema contracts

Canonical contract for the `comms.recentLog` composite — the first vertical
promotion described in `docs/ALCHEMICAL_PROMOTION.md` §7. These are the **frozen
shape** of the combo; backends are late-bound and `codemode` is the only adaptive
joint.

## The three schemas

| Schema | Canonical URI | What it is |
|---|---|---|
| `unified-comms-entry.schema.json` | `https://schema.chitty.cc/comms/v1/unified-comms-entry.schema.json` | Output record — one normalized comm event across channels |
| `messages-provider.schema.json` | `https://schema.chitty.cc/comms/v1/messages-provider.schema.json` | Injection-point contract a late-bound provider must satisfy |
| `comms.recentLog.schema.json` | `https://schema.chitty.cc/comms/v1/comms.recentLog.schema.json` | Tool I/O (input + UnifiedCommsEntry[] + metadata) |

## Where these live and who owns them (deliverable #4)

**Ownership = ChittySchema; reference = comms-mcp.** Per the per-service ownership
pattern and the Schema Owner Manifest (`GET https://schema.chitty.cc/api/owners`):

- The **canonical, versioned definitions are owned by ChittySchema** and served
  from the `CANONICAL_SCHEMAS` R2 bucket under the `comms/v1/*` namespace at the
  `schema.chitty.cc` URIs above (same mechanism as the `/meta/*` meta-schemas).
  ChittySchema governs drift, breaking-change review, and generates the TS types
  (`identity/src/types/comms/`) and Zod validators (`identity/src/validators/comms/`).
- The **comms-mcp vertical REFERENCES them, it does not own them.** This directory
  is the working copy used to scaffold the build; the vertical imports the
  generated types from the published contract rather than hand-defining record
  shapes inline. This mirrors the fractal rule in ALCHEMICAL_PROMOTION.md:
  `vertical references primitives`, and here `vertical references schema`.
- `comms.recentLog` is a **cross-canonical composite with no single home service**
  (quo + imessage + email). Per §3 the *vertical itself* owns the fan-out
  orchestration — but the *data shapes* it fuses to are owned upstream by
  ChittySchema. Orchestration is the vertical's; the contract is ChittySchema's.

`comms` is **not** a Neon database — it is a schema namespace for a cross-channel
view. No new table tree is minted; the underlying durable rows already live in the
canonical `contextual.messages` + `contextual.party_identifiers` relation that
`quo_recent_messages_local` and `imessage_unified_with_quo` read.

## Real backend shapes observed (no invented fields)

Bound to live responses captured during design (no mocks):

- **quo / openphone** (`quo_recent_messages_local`, reads `contextual.messages
  where source='openphone'`): `message_id` (internal), `external_id` (AC…,
  provider), `external_thread_id` (AC…), `direction` (`inbound`/`outbound`),
  `body_text`, `sent_at` (RFC3339), `parties[]` of `{role: sender|recipient,
  identifier}` where identifier is E.164 or email, `source`.
- **gmail** (`search_threads`/`get_thread`): per-message `id`, thread `id`,
  `date` (RFC3339), `sender`, `toRecipients[]`, `ccRecipients[]`, `subject`,
  `snippet`, `labelIds[]`. **No native `direction`** — derived.
- **quo conversation** (`quo_list_conversations`): `id` (CN…), `participants[]`
  E.164, `phoneNumberId`, `lastActivityAt`, `lastActivityId` (AC…).

### Where real shapes DIVERGE from the unified schema → codemode reshaping required

1. **direction**: quo/twilio emit it; **gmail does not** — codemode derives it by
   testing whether the owner identity-bundle is the sender (`rawToUnified.deriveDirection`).
2. **owner identity bundle**: quo `parties[]` carries the owner's ~30 alias
   identifiers (every `nick@*`, every owned `+1…`) on every row. codemode must
   collapse these to a single `self=true` counterparty so `participants[]` isn't
   polluted. **This is the single largest reshape.**
3. **thread ref**: quo uses `external_thread_id` (AC…) on messages but `id` (CN…)
   on conversations; gmail uses thread `id`. Normalized to one `threadRef`.
4. **id namespaces**: quo splits `message_id` (internal) vs `external_id`
   (provider); gmail has one `id`; twilio has `MessageSid`. The schema keeps
   `providerMessageId` (cross-channel dedup key) separate from `internalId`.
5. **body vs snippet**: gmail returns `snippet` and only returns body under
   `FULL_CONTENT`; quo returns full `body_text`. The schema makes body|snippet a
   union — at least one present — so neither channel forces a round-trip.
6. **subject/transcriptRef**: email-only / voice-only respectively; null elsewhere.

### Real provider-contract bugs found (drift evidence)

These are exactly the mismatches the codemode joint exists to absorb, and are
live drift findings for ChittySchema:

- `quo_lookup_contact_context` sends `maxResults=100` but the OpenPhone API caps
  it at 50 → HTTP 400. The adapter over-asks.
- `quo_list_messages` 400s without a `participants[]` array (live API requires it);
  the local-cache path (`quo_recent_messages_local`) does not. The combo should
  bind the **local** op as `listMessages` to avoid this.
- `imessage_unified_with_quo` and `imessage_top_contacts` currently error on this
  node (`column m.id does not exist` / `relation communications.imessages does not
  exist`) — the hand-built precursor is **drifted/broken**, which is itself the
  Alchemist signal that the composite has outgrown its host and belongs here.

> iMessage row shape is therefore **descriptor-derived, unverified on this node**:
> per the `imessage_unified_with_quo` descriptor it reads `contextual.messages`
> joined to `contextual.party_identifiers` — i.e. the SAME canonical relation as
> quo, so the same UnifiedCommsEntry mapping applies (channel discriminated by
> `source`). Flagged explicitly rather than guessed.

## Breaking-change / drift note — adding a 4th channel (deliverable #5)

Adding a channel (say `whatsapp` via twilio, or `signal`) is a **non-breaking,
additive** change *by construction*, because the shape is frozen and the wiring is
late-bound:

1. **UnifiedCommsEntry**: append the value to the `channel` (and provider) enum.
   Enum extension is backward-compatible — existing entries still validate; no
   field is removed or retyped. (ChittySchema: this is a "safe" change.)
2. **MessagesProvider**: bind one new provider instance — declare `capability:
   "messages"`, its `channel`, its `binding.tools` map, and a `rawToUnified`
   `fieldMap`. codemode **generates the new `rawToUnified` on first call** (cache
   miss → regenerate; §4). The combo shape, merge, sort, and output schema are
   untouched. This is the whole point of §2b: replace the call, not the tool.
3. **comms.recentLog**: append the enum value to `channels[]`. Default channel set
   may stay as-is (opt-in) to avoid changing existing callers' behavior.
4. **The late-binding stays valid** because the combo references the *capability*
   (`messages`), never the concrete provider. A provider the combo has never seen
   does not break it — `metadata.channelsQueried[].reshapedBy = "regenerated"`
   records that codemode filled the gap live, and a per-channel failure degrades
   to `ok:false` for that channel only (no silent fallback) while the rest of the
   log returns.

**What WOULD be breaking** (requires ChittySchema coordinated migration, not just
an enum bump): removing/renaming a required UnifiedCommsEntry field
(`occurredAt`, `direction`, `participants`, `providerMessageId`), retyping
`occurredAt`, or changing the CommParty `chittyId` P-type pattern. Those ripple to
every consumer of the fused log and to the generated TS/Zod — they go through the
breaking-change protocol, never a silent edit.
