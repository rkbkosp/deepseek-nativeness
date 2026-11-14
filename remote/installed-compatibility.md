# Installed compatibility evidence

Read-only inspection on 2026-11-14. No service call, write, restart or source modification was used to establish the findings below. These findings confirm installed **code contracts**, rather than a live mutation outcome.

The inspected official archive is `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`. Its `dsh/package.json` identifies `@deepseek-ai/dsh-desktop-runtime@0.2.2-rc.3`. The archive's schedule and plugin-manager packages both identify version `0.2.2-rc.3`. The separately installed desktop-profile Remote plugin identifies `ds-harness-remote@0.6.4`.

Selected compiled files and public package metadata were extracted into `installed_reference/` using `@electron/asar@4.0.1`. That directory is derived evidence, not a runtime dependency. The original application archive and installed plugin were only read.

| Artifact | SHA-256 |
| --- | --- |
| Official `app.asar` | `c0ce89f77d25e98e11952728d1fc054b6e2300db17402af83a1a225c8b36e843` |
| Extracted schedule `lib/index.js` | `f06a57f6fd5d7b0d2666b4d1b1a27d96aa3035a66de40ad2fc9cef3eba580040` |
| Extracted plugin-manager `lib/index.js` | `33cbad2bdce9679a9f4fbebe072db87ecbb162e0ceb93237f6a627de07d3ab74` |
| Installed Remote `dist/index.js` | `805d33ca4dec0c0503fc7458db3f7b5b4e5bd69ad9a27cf0df816b018032af32` |

## Schedule creation: installed-code-confirmed mismatch

The official compiled schedule service exposes `remoteCreate(request, signal)` at extracted line 2216, delegating to `create(request, undefined, signal)`. Its core `create(request, actorSessionId, signal)` at line 2233 reads `request.title`, `request.prompt`, `request.timing` and `request.target`.

The installed Remote compiled `createSchedule` instead requires exactly one legacy selector (`after_seconds`, `at`, `every_seconds`, `daily`, `weekly`, or `cron`) and extracts `sessionId`. At installed Remote line 99321 it calls `this.schedule.create(sessionId, request, AbortSignal.timeout(60000))`.

Consequently, the modern UI's typed timing/target request is rejected by the interceptor; adapting the frontend to the legacy envelope would pass a string as the modern service's first request parameter. The client capability is disabled before dispatch. Neither envelope was tried as a real write.

A future backend compatibility change would need to validate the modern human-caller request and delegate through `remoteCreate(request, signal)`, while deliberately retaining or translating any legacy wire contract. Merely adding an allowlist entry does not address this interceptor. Such a change is outside the frozen-backend implementation.

## Plugin update: installed-code-confirmed mismatch

The official compiled plugin-manager `listBundles()` at extracted line 2196 returns update eligibility as `update: target.kind` (line 2201), where the modern source describes registry/git targets. It does not emit an `updatable` property.

The installed Remote's `checkRemoteBundleUpdate` at line 99513 first validates a strict `{args:{name,version}}` envelope. At line 99524 it refuses inventory rows unless `row.updatable === true`. It also separately refuses updating Remote itself or a containing bundle. Current official inventory therefore cannot pass that eligibility gate. The frontend update operation is disabled before dispatch; no real update was attempted.

A future compatibility change would need to understand the installed Host's `update` discriminant and matching update request options, while preserving the Remote-owned bundle prohibition and the inventory/read-only checks. Loosening only the frontend button or request schema would not fix the carrier gate.

## Other boundaries

The full source-level inventory remains in `capability-matrix.json`. An allowlisted endpoint is not automatically compatible with the current Host's generated descriptor or its Remote interceptor. Existing read-only Host probes are recorded separately in `dist/live-surfaces.json` and `../qa/runtime-results/live-readonly.json`. Existing loopback describe returned zero allowed ports (`dist/live-loopback.json`): the protocol has an HTTP/WS carrier, but this deployment currently offers no permitted original HTTP resource entry through it. No port or configuration was changed.
