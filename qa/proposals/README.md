# Proposed backend interoperability work — not applied

This directory is a review artifact. Nothing here was applied to the original repository, installed plugin, official application, Host configuration or running service. The frontend continues to report schedule creation, bundle updates and arbitrary plugin resources as unavailable. No real task/configuration write was attempted to validate this proposal.

## Exact baseline and evidence

- Remote source: v0.6.4, commit `4670ae67cde91e1ac4c9df9d3400fb317c8eedf7`, `packages/plugin/src/harness-remote-bridge.ts`.
- Host source: dsh `0.2.2-rc.3`, commit `39163dd30f703a79079e2d2446545cff3c453738`.
- Installed official archive SHA-256: `c0ce89f77d25e98e11952728d1fc054b6e2300db17402af83a1a225c8b36e843`.
- Installed Remote bundle SHA-256: `805d33ca4dec0c0503fc7458db3f7b5b4e5bd69ad9a27cf0df816b018032af32`.
- Compiled installed-code confirmation and extracted-file hashes: [installed-compatibility.md](../../remote/installed-compatibility.md).
- The authorized read-only loopback probe found zero allowed ports. HTTP/WS transport exists in Remote, but the current frozen deployment supplies no permitted original HTTP resource entry through it. This is a deployment constraint, not proof that the protocol can never proxy resources.

## Minimal patch for review

[proposed-backend-compat.patch](./proposed-backend-compat.patch) changes **only the Remote plugin source**, targeting the pinned modern Host. It is not bundled into the new client.

1. Schedule: when the injected Host service has `remoteCreate`, accept the original typed `{args:{request:{title,prompt,timing,target?}}}` envelope and dispatch it to the Host's existing generated `schedule/create` descriptor. That descriptor performs full native type validation and calls the human-caller `remoteCreate(request, signal)` implementation. This avoids the erroneous legacy `create(sessionId, request, signal)` invocation. Older Hosts without that method retain their existing legacy branch. On a modern Host the old envelope is explicitly rejected, rather than being silently translated into a possibly different destination or recurrence.
2. Bundle updates: recognize the Host's actual `update:'registry'|'git'` eligibility discriminant in addition to the old boolean, and admit the actual optional `{registry,spec,requestId}` descriptor. Inventory lookup, `readOnlyReason` and the Remote-owned bundle prohibition remain in force. The Host continues to validate semver, repository identity/full commit, registry, installation locks and the requested options. No automatic update is introduced.

The proposal preserves the endpoint allowlist and encrypted/authenticated peer carrier. It does not open any port, add a generic fetch endpoint, disable permission checks, grant a new device, change settings enforcement or bypass the prohibition on remotely replacing Remote itself.

### Validation performed

- `git apply --check ../qa/proposals/proposed-backend-compat.patch` from the read-only reference checkout: passed (check only; not applied).
- esbuild TypeScript syntax transform of an isolated temporary proposed file: passed.
- Installed and source signatures were compared read-only.

This is **not** a compiled plugin release, full typecheck, upstream test result, deployment or successful real mutation. The proposal requires isolated upstream tests and explicit future authorization before installation/restart. Current frontend capability gates must stay false until the negotiated server implementation and behavior have actually been accepted.

### Required isolated upstream tests before adoption

- Modern typed schedule request reaches generated `remoteCreate` exactly once, with `request` as its first argument; unknown keys, invalid timing/target, missing session and subagent target reject with no durable write. Verify cancellation before queued persistence; acknowledge that abort after persistence does not roll back a task.
- Legacy Host keeps its prior supported envelope. Modern Host rejects legacy shape deterministically. Missing service refuses. Test after/at/every/daily/weekly/cron/rrule, target session/new_once/new and Host default destination.
- Registry and Git bundle inventory permit only their correct update forms; missing inventory, read-only entries, invalid update discriminants, malformed options and Remote-containing bundles reject without installation. The Remote-owned prohibition must be checked even for an otherwise update-eligible row.
- A lost response must not cause the client to replay a create/update automatically. Current frontend receipt handling preserves unknown intent; the proposed server patch does not add durable server idempotency. A future robust retry contract needs a separate, persisted intent identity rather than treating the progress `options.requestId` as deduplication.
- Retain authenticated peer/membership checks and all existing Remote-policy tests. No account credentials or package-source credentials may appear in error diagnostics.

## Resources: a separate bounded protocol proposal

[resource-contract.md](./resource-contract.md) describes the smallest additional carrier surface needed for unbundled third-party plugin assets and raw session exports. No resource patch is supplied: the current code lacks a suitable authenticated artifact/module resolver to wire safely by changing an allowlist alone. A generic URL/absolute-path proxy would be an unjustified capability expansion.

These changes are optional future backend work. The accepted frozen-backend native client uses explicitly pinned local original components, the same private Remote connection, and ephemeral owner-scoped WK pages. It does not claim arbitrary plugin-module or raw log-download parity. Complete Markdown has a separate client-only route through full canonical events and the original formatter; see `../../remote/ACTIONS.md`.
