# Ch1tty — Agent Guide

Canonical URI: `chittycanon://core/services/ch1tty`  
Runtime: local stdio + Cloudflare Worker at `ch1tty.chitty.cc`

## Development

- `servers.json` is the broad source configuration used by local/runtime tooling.
- The Cloudflare Worker cannot read that file dynamically; its remote projection lives in `src/config-data.ts`.
- When adding a Worker remote backend, keep its server ID identical to the namespaced ID used by `ch1tty/execute`.
- Use an existing ChittyConnect/ChittySecrets token path. Never embed bearer values.

## Code Mode

Dynamic/Code Mode calls eventually dispatch through `ch1tty/execute`. A domain is executable only when:

1. its manifest is discoverable by the Code Mode SDK,
2. the same server ID exists in Ch1tty's executable remote registry,
3. upstream authentication is valid, and
4. any downstream actor/tenant authorization can be preserved.

The durable `chittyagent-scrape` surface satisfies this path with server ID `scrape`; it delegates portal I/O to ChittyScrape and exposes completed task results through `get_job`.

ChittyFinance is intentionally excluded from Ch1tty's executable registry until verified actor identity can be propagated into Finance. Do not use a hard-coded `X-Chitty-User-Id`, shared super-user, or invented automation principal to bypass the existing L2/L4 trust path.

## Verification

Before declaring a new remote backend healthy:

- run repository tests/typecheck,
- prove the deployed Worker lists the namespaced tools,
- execute a harmless read-only call through Ch1tty/Code Mode,
- then test any write path only with its normal downstream authorization.
