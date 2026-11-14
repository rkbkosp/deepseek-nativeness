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

Native UI has been built, run, and captured on this Mac. The current prototype has authentication, device/workspace/session selection, message history and stream presentation, send/cancel controls, and native approval and question forms. Live login, Host pairing, stream recovery, send, approval, question, and all remote plugin behaviors require separate real-connection acceptance. No existing task is messaged, interrupted, or approved as part of local tests.

“Remote Web” is an independently authenticated webpage connection, created only when requested and destroyed on Close. It is not a verified implementation of shared-session plugin embedding. Native question and approval answers use their owning Remote connection instead of opening another webpage.

Visual parity is in progress. Original DSH SVG artwork and the sidebar/header/composer proportions are reused; exact typography, all transitions, and M1 CPU/memory comparisons remain acceptance work. Do not infer M1 performance from local synthetic tests.

The source references `../deepseek-harness` and `../mygo` are read-only. No backend code, configuration, database schema, application installation, or installed plugin has been changed.
