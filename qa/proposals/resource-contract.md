# Resource interoperability proposal — design only

No endpoint below exists in the deployed Remote 0.6.4 contract. Names are illustrative review labels, not client capabilities. No server code/configuration was changed and no port was opened.

## Why the existing surface is insufficient here

The original plugin UI depends on the Host's browser module graph and compiled JS/CSS/assets. Its authenticated HTTP resource routes are separate from Typert unary/stream calls. Original session ZIP downloads use GET/HEAD routes after a command has prepared an export; the original Markdown HTTP document also has its own route. A complete Markdown transcript can separately be generated on the client from fixed-cut full `session/events` pages using the unchanged original formatter, so it does not require this proposed resource carrier. The allowlisted `commands/execute` response is not the exported bytes. The existing workspace upload RPC returns a file path reference, not a staged composer attachment receipt, and must not be renamed into either resource API.

Remote already has encrypted RPC, bounded binary-transfer chunks and HTTP/WS loopback carriage. The actual frozen Host advertises zero permitted loopback ports. Opening or permitting an original HTTP port would itself change the frozen deployment; no such change was made. Even if later permitted, an HTTP entry must preserve the original authentication and resource routing semantics, rather than exposing arbitrary localhost services.

## Narrow proposed carrier

Use the existing authenticated device connection and its binary-transfer framing. Resolve resources on the Host by opaque typed identifiers; do not accept arbitrary URLs, filesystem paths or caller-supplied origin headers.

| Proposed operation | Input | Output / constraint |
| --- | --- | --- |
| `uiResources.describe` | negotiated client UI/protocol version | Immutable module graph revision; plugin/module IDs; entry IDs; public dependency edges; asset MIME/length/content hash. No installed filesystem path, secrets or credential values. |
| `uiResources.open` | graph revision, declared module/asset ID | Read-only bounded transfer handle for that exact graph member, MIME/length/hash and cache identity. A revision mismatch explicitly invalidates the client graph. |
| `sessionArtifacts.open` | authorized session ID, enum `raw-session-zip` or `full-markdown`, explicit export options | One read-only generated artifact transfer, exact MIME/size/name and completeness metadata. It must use the original exporter/authorization rather than a visible-history reconstruction. |
| existing transfer read/close equivalents | connection-owned opaque handle plus sequential offset/chunk identity | Backpressure and existing frame-size limits; abort on owner/connection closure; finite idle timeout and per-peer byte/handle limits. No unbounded base64 unary reply. |

### Host resolver requirements

- Authenticate and authorize the peer/membership through the existing Noise/Remote path on every operation. Resource handles belong to that connection; they cannot be guessed or reused across accounts/devices/hosts.
- Public UI resources must come from a declared browser-build/module registry with validated dependency edges and realpath confinement, never from arbitrary package files. Deny symlinks/paths escaping the exact resource roots, dotfiles, source maps with private paths, package-manager auth, configuration and environment files. Avoid adding native filesystem access to plugin JavaScript.
- Session artifacts require the same session access policy as the current read/history route. Validate the requested session before opening and before delivery; cancellation closes only the transfer, never a running task. Preserve original export format/version/completeness. Avoid command-triggered write side effects merely to test downloads.
- Enforce compressed and decompressed budgets, exact MIME, immutable revision and hash, and a strict module CSP. Do not allow a graph to load new network modules or an arbitrary remote origin with native bindings.
- The client pins a graph revision while the page is open. A module change invalidates and destroys that WK owner. Native bindings stay limited to the explicit same-connection wrapper allowlist and captured host/account/session generation. External navigation remains untrusted and receives no RPC.
- Destroying/closing WK, switching Host/account/session, loading failure and native window close explicitly close owner transfers; JS unmount is only an additional cleanup path.

## Compatibility and acceptance

Advertise a versioned optional capability only after the resolver exists. Old Host behavior remains unchanged. The native client must continue to show an unavailable reason while the capability is missing; it must not silently launch a full standing React client, expose a different login, or claim the currently loaded history is a complete export.

Before deployment, use isolated fixtures for graph revision invalidation, cross-owner/peer handle refusal, missing asset, hostile traversal/symlink, MIME mismatch, decompression limits, partial transfer, abrupt disconnect, and twenty open/close cycles. Then, after explicit authorization, verify real Host assets and a harmless completed-session export without changing configuration or invoking a model. This proposal supplies none of those live acceptance results.
