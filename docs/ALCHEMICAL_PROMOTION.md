# Alchemical Promotion — Molten Composites → Durable Vertical Tools

> Design note. Captures the model for how ch1tty's `apps/*-mcp` verticals grow
> from observed use. Companion to `CHITTY.md` § *Alchemical Self-Composition*
> (which describes the *behavior*); this note names the *substrate* and the
> *promotion mechanics*. Status: design, not yet shipped — gaps called out in § 6.

## 1. The problem, concretely

Every time a caller uses a primitive backend like `chittyagent-quo`, it re-pays a
discovery tax: find the contact → find their numbers → list messages → pull
transcripts → assemble a "recent comms with X" view. The same re-poke sequence is
re-derived from scratch on every session. Add iMessage and email and the caller is
hand-fusing three primitive backends into one composite *that has no home*.

The tax is real and the ecosystem already pays it down **by hand**: tools like
`imessage_unified_with_quo` and `quo_lookup_contact_context` are exactly this
composite, frozen manually by whoever hit the pain. That hand-promotion is the
behavior the Alchemist should perform automatically, from observed recurrence.

## 2. Three states of a capability

```
MOLTEN          ad-hoc codemode program over PRIMITIVE backends
                (quo/imessage/gmail: find-user, find-numbers, list-messages…)
                — this is where the re-poke tax lives.
   │  heat = recurrence across callers
   ▼
CRYSTALLIZING   Alchemist scoring a recurring program shape:
                frequency × success-rate × recency × caller-diversity
   │  crosses promotion threshold
   ▼
SOLID           a typed, parameterized tool in a VERTICAL focus MCP
                (apps/comms-mcp → comms.recentLog({person, channels, days}))
                — the re-poke is gone; one purpose-built call.
```

The primitives stay raw and low-level. The **vertical** (`apps/*-mcp`) is the
frozen layer that holds durable composites. The Alchemist is the heat that
crystallizes recurring molten programs up into a vertical. ch1tty's 5 meta-tools
route across both layers; a **focus profile** (`comms`, `finance`, …) biases
`search`/`cast` toward the solid layer so durable tools surface first and
primitives stay reachable but demoted.

## 2b. Non-brittle by construction — freeze the shape, not the wiring

The failure mode of any "promote a pipeline into a tool" scheme is brittleness: a
frozen pipeline breaks the moment a backend changes. This model avoids it by
freezing the **shape**, never the **wiring**:

- A combo (`comms.recentLog`) encodes the durable *shape* — resolve contact →
  gather messages per channel → merge → assemble — with **injection points**, not
  hardcoded backend calls. It does NOT bake in `quo.listMessages`.
- **Backends are late-bound, supplied by the agent from the skill.** Swap quo →
  twilio = rebind the `messages` capability; the combo shape is untouched. Replace
  the call, not the tool.
- **codemode is the adaptive joint.** When a binding doesn't line up (twilio's API
  shape ≠ quo's), codemode regenerates just the glue to reshape the new provider's
  response into what the combo expects — live. A provider the combo has never seen
  does not break it; codemode fills the gap.

The crystallized "typed tool" in §§ 2–3 is therefore a typed **shape with injection
points**, not a hardwired pipeline. The brittleness budget is spent in exactly one
place — codemode, the adaptive joint — and nowhere in the frozen layer.

This is **fractal**: the same "abstract reference + late binding + codemode
adaptation" repeats at every altitude —

```
skill     references a combo        (not the combo's internals)
combo     references capabilities   (not the MCP — the agent binds it)
vertical  references primitives     (late-bound; codemode bridges mismatches)
gateway   references backends       (servers.json; 5 meta-tools)
```

— the same slim-MCP late-binding move self-similar at each scale
(`project_fractal_architecture`).

## 3. Where durable tools live (placement rule)

Promoted composites live in **vertical focus MCPs under `apps/*-mcp`**, never as
inline facades in the ch1tty gateway (`no_inline_facades`), and never bolted onto
whichever primitive the author happened to be editing.

- A composite with a single canonical owner → vertical wraps that owner
  (e.g. `apps/tasks-mcp` wraps `chittyagent-tasks`).
- A **cross-backend** composite with no single owner (quo + imessage + email) →
  the vertical itself owns the fan-out orchestration. This is the legitimate home
  for orchestration that spans canonical services; it is a focused surface, not
  the gateway.

**Smell:** `imessage_unified_with_quo` is a *comms* composite frozen into the
*imessage primitive*. In this model it belongs in `apps/comms-mcp`. A composite
living inside one of its inputs is itself an Alchemist signal: "this has outgrown
its host."

## 4. The substrate — gateway as the Alchemist's memory

Route codemode's **code-generation LLM call** (intent + available tool signatures
→ generated program) through **Cloudflare AI Gateway**:

- **Cache = recognition / exact-dedup.** Same intent + same tool surface → the
  prior program is returned without an LLM round-trip. This also kills the live
  embed-timeout on the cast hot path (`project_ch1tty_cast_latency_landmine`):
  embed/generate once at write time, not per call.
- **Log = corpus + scoring signal.** Every generation is logged; frequency and
  recency for the promotion score fall out of the log with zero extra
  instrumentation. The gateway log *is* what ContextConsciousness needs to read.
- **Vectorize = fuzzy clustering only.** Needed solely to cluster *non-identical*
  programs (different wording, same composite shape) into one promotable pattern.
  Exact match: gateway cache. Near match: vector.

### Online clustering — recall, reinforce, merge

Clustering is not a batch job; it runs per incoming program as a reinforcement
loop. For each new molten combo:

1. **Does it look like an existing pattern X?** Embed the program shape, nearest-
   neighbour search the pattern store.
2. **Was the combo recalled** (cache or vector hit above the match threshold)?
   → **keep it** — reinforce X: bump its weight (frequency/recency), widen its
   centroid slightly toward this instance. Recall *is* the promotion signal
   accumulating.
3. **New combo, but also *kind of* looks like X** (near but below the strict
   match threshold)? → **merge it** into X: it's the same composite expressed
   differently; fold it in so X's signature generalizes rather than spawning a
   near-duplicate pattern.
4. **No match** → seed a new pattern at weight 1.

The merge step is what stops the store fragmenting into 40 near-identical "recent
comms" patterns that each individually never cross the promotion threshold. A
pattern's accumulated weight (reinforced recalls + merged variants) is exactly the
score § 6 thresholds against. Two knobs fall out: the **match threshold** (recall
vs merge vs seed) and the **promotion threshold** (accumulated weight → solid).

Cache discipline (load-bearing):
- Cache the **plan (program), not the execution result** — re-execute against live
  backends each time; backend state moves.
- Cache key = **intent + tool signatures only**; keep volatile context
  (timestamps, session ids, history) out of the hashed portion or hit-rate dies.
- Exact-match caching is solid to assume; **semantic caching status must be
  verified** against current Cloudflare docs before designing on it.

## 5. MCP-native exposure (the unused read/notify/async half)

The 5-tool freeze is on **tools**. Resources, notifications, completion, tasks,
and apps are *not tools* — they are the sanctioned growth axis. ch1tty currently
implements `resources/*` and `prompts/*` as **passthrough only**, with no
`subscribe`/`listChanged`/`completion`. The intelligence layer should use them:

| Capability | Role |
|---|---|
| ch1tty-native resources + templates | expose the program corpus / promotion scores as readable `ch1tty://program/{hash}`, `ch1tty://pattern/{intent}` |
| `notifications/tools/list_changed` | announce a newly-promoted vertical tool to live clients — the literal mechanism for "topology grows from use" |
| `subscribe` | a client watches a pattern's score as it heats |
| completion | pattern store surfaces likely arg values |
| `_meta` | carry archetype / affinity / confidence / provenance without polluting schemas |
| tasks (emerging) | long-running codemode executions as native async |
| apps (emerging) | `cast confirm:true` plan-preview as interactive UI |

`tasks` and `apps` are **not** in the stable 2025-06-18 spec ch1tty targets —
verify draft status before building on them. Exposing ch1tty's *own* resources
(vs. passthrough) is a deliberate extension of the CLAUDE.md "passthrough, low
cardinality" framing and needs the architecture owner's sign-off.

## 6. Open knob — the promotion threshold (genuinely unsolved)

Everything above is plumbing. The unsolved research question:

1. **Threshold** — what accumulated pattern weight (reinforced recalls + merged
   variants, see § 4) earns a molten program a slot in a vertical? Too low →
   vertical sprawl; too high → the re-poke tax never gets paid down. Paired with
   the **match threshold** that governs recall-vs-merge-vs-seed.
2. **Decay** — a composite hot last month but cold now should *not* hold a slot.
3. **Greenfield verticals** — can the Alchemist spin up a *new* vertical
   (`apps/comms-mcp` from nothing) on a new domain, or only accrete tools into
   existing verticals? Greenfield needs a higher bar.

## 6b. Cold-start — combos derived from skills

The promotion threshold has an empty-store problem: nothing crosses it until the
runtime log has accumulated recurrences. **Skills solve the cold start.** A skill
(e.g. `daily-meeting-update`: GitHub + Jira + session history → standup) is a
human-authored procedure over tools — a molten program someone already crystallized
*because it recurred enough to write down*. The ChittyMarket skill registry is
therefore a **pre-labeled combo corpus**, seeding the pattern store at weight ≥ 1
without waiting for runtime observation.

Both/and, not either/or:
- **Runtime observation** (codemode programs + AI Gateway log, § 4) discovers
  *unknown* combos nobody wrote down.
- **Skills** *seed* the *known* ones — the cold-start corpus.

Three encodings of the same composite at rising altitude — and the path is
bidirectional:

```
skill (NL procedure)  ──derive──▶  combo (observed program)  ──crystallize──▶  vertical typed tool
       ▲                                                                              │
       └──────────────────────────── re-emit as skill ◀──────────────────────────────┘
```

Caveat: a skill is NL instructions the model executes, not typed code. It gives the
combo *shape* (backends, order, params) for free, pre-clustered and labeled — but
crystallizing into a typed vertical tool is still a step. **Look at the skill
library first** for which verticals to stand up, before mining any runtime log.

## 6c. The loop closes — combos slim the skills back down

Once a combo is crystallized into a typed vertical tool, the skills that seeded it
**shrink**. A skill stops re-describing the procedure in prose (fat markdown, full
context cost every load) and instead *references* the tool:

```
Before (fat):  ~2k tokens — "to build a comms log, look up the contact, enumerate
               their numbers, list recent messages each, pull transcripts, merge…"
After (thin):  "Recent comms with a person → comms.recentLog({person, days})."
```

The procedural weight moves out of every skill that shared the combo and into the
typed tool, where it lives **once**. So the cycle is self-reinforcing:

```
fat skill seeds the combo
   → Alchemist crystallizes recurring combo into a typed vertical tool
   → skill rewritten to REFERENCE the tool → skill shrinks
   → context-per-load drops for every skill that shared that combo
```

Skills bootstrap combos (§ 6b); combos then slim the skills. They co-evolve, each
making the other leaner. This is the **fractal property** (`project_fractal_architecture`)
again: ch1tty slimmed *tool definitions* (5 meta-tools, search-on-demand vs 100+ in
context); combos now slim *skills* (reference the tool vs re-describe it). Same
"push weight into a durable layer, keep the surface thin" principle, one altitude
up — and the same progressive-disclosure ethos as `agent-md-refactor`, except the
disclosure target is a typed tool, not another doc.

## 7. Worked reference — `apps/comms-mcp`

The canonical first promotion to drive the mechanics:

- **Molten program:** find contact → numbers → messages → transcripts → fuse into
  a recent-comms view, across quo + imessage + email.
- **Solid tool:** `comms.recentLog({ person, channels: ["quo","imessage","email"], days })`.
- **Home:** new `apps/comms-mcp` vertical owning the cross-canonical fan-out;
  `imessage_unified_with_quo` migrates here from the imessage primitive.
- **Proof it's the right unit:** the hand-built `*_unified_with_quo` tools already
  exist — the Alchemist automates the promotion that produced them.

## Cross-references

- `CHITTY.md` § *Alchemical Self-Composition* — the behavior this note grounds
- `CLAUDE.md` § *Split Architecture* + `apps/README.md` — the vertical roster
- memory: `project_alchemist_integration`, `project_ch1tty_cast_latency_landmine`,
  `feedback_no_inline_facades`, `project_fractal_architecture`
