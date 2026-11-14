# Native DSH Remote

A macOS client prototype using MyGo native UI and an on-demand WKWebView. The existing MacMini Harness backend and `ds-harness-remote@0.6.4` remain unchanged. There is no local Agent runtime in this application.

## Run

Requirements: Go 1.27.3+, Node 24.9+, and the adjacent frozen `../mygo` checkout. The Remote helper's locked dependencies and upstream browser-independent client code are described in [remote/README.md](remote/README.md).

```sh
cd /Volumes/SuperDisk/native-dsh/desktop
CGO_ENABLED=0 go run .
```

Normal startup loads the independently stored server preference, configures a client identity outside `~/.dsh`, and shows the real authentication state. It does not fabricate sessions. Enter credentials only in the native password field. Credentials cross the helper's private stdin; no credentials are written into this repository. The existing installed application's identity and expired credentials are not refreshed or overwritten.

```sh
sh scripts/build-app.sh
open 'build/Native DSH Remote.app'
```

The local `.app` has its own bundle identifier and includes Node, the client-only helper, and its dependencies. It resolves resources from its bundle and does not depend on the launch working directory. This is a local development artifact; it is not notarized or a published release.

## Explicit UI replay

```sh
go run . --demo
go run . --demo --demo-running 20 --metrics /tmp/native-dsh-metrics.json --exit-after 5s
go run . --demo --demo-running 1 --animation-time 375ms --capture /tmp/native-dsh-phase.png --exit-after 3s
```

`--demo` is visibly labeled and never starts the Remote helper. `--demo-running 0` exercises the settled path; `--hide-sidebar` collapses the sidebar. `--animation-time` freezes the indicator for deterministic visual inspection only. The default indicator retains the 1.5-second spin and cubic-bezier breathing arc and requests paint frames from `Painter`, so the business view is not rebuilt at every animation frame. The user's system Reduce Motion preference remains honored; it is not forced on.

## Verification boundaries

`CGO_ENABLED=0 go test ./...` covers the original question payload and answer labels, uncertain send receipts, animation geometry and paint-only scheduling, removal of animated elements, Go-to-Node JSON-lines with an explicit simulated Remote peer, notification backpressure, and a canceled blocked pipe write. The simulated peer is not live Host validation.

Actual read-only acceptance on this Mac has covered independent login restoration, LAN connection to the MacMini, three workspaces and twelve root sessions, completed history and older pagination, native Markdown, reading a workspace file, shared-connection plugin/model reads, and the original trajectory timeline with filtering and folding. The GUI 5.1 candidate also restored the saved Host and completed session automatically. Real streaming, recovery under load, sends, cancellation, approvals, questions, and Host mutations remain unverified; their current evidence is synthetic protocol/component tests. Existing tasks are never messaged, interrupted, or approved during development checks.

“Remote Web” is an independently authenticated, untrusted webpage connection. The separate locally packaged compatibility pages reuse original React components over the existing native client's connection and scoped, allowlisted RPC. Closing a page destroys its WKWebView and releases all of its subscriptions. Native question and approval answers use their owning Remote connection. Arbitrary third-party plugin web routes/resources and original raw Session log downloads remain confirmed frozen-protocol limits.

Each GUI candidate is checkpointed locally with a source commit and a manifest of packaged native/helper/browser hashes. `scripts/build-app.sh --use-next-assets` packages explicitly reviewed `dist-next` directories without rebuilding them. The split browser entry-size report is a build-size measurement, not a runtime memory or M1 performance result. Terminal visual composition, narrow composer controls, and newly added settings pages require GUI acceptance of their exact candidate; source, AX nodes, and separate WK screenshots alone do not establish that they are visible on screen.

Visual parity is in progress. Original DSH SVG artwork and the sidebar/header/composer proportions are reused; exact typography, all transitions, and M1 CPU/memory comparisons remain acceptance work. Do not infer M1 performance from local synthetic tests.

The source references `../deepseek-harness` and `../mygo` are read-only. No backend code, configuration, database schema, application installation, or installed plugin has been changed.
