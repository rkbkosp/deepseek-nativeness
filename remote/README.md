# Remote client wiring

This is a client-only Node communication helper for Native DSH. It does not launch Cordis, the local Harness Host, an Agent, a WebView, or a listening HTTP server. It uses the frozen Remote protocol and has no service-side changes.

## Source and build

The selected transport, Noise handshake, identity, credentials, capability discovery and Typert carrier come from `liguobao/ds-harness-remote` tag `v0.6.4`, commit `4670ae67cde91e1ac4c9df9d3400fb317c8eedf7`. `../remote_reference` is an unchanged reference checkout. `src/upstream.ts` lists the selected modules. `UPSTREAM-LICENSE` preserves the upstream MIT license; dependency licenses remain in the installed runtime packages.

From `desktop/`:

```sh
npm ci --prefix remote
npm run --prefix remote build
npm test --prefix remote
node --test qa/projection-acceptance.test.mjs qa/remote-contract.test.mjs qa/owner-lifecycle.test.mjs qa/terminal-runtime.test.mjs
node remote/package-runtime.mjs /path/to/app/Contents/Resources/remote
```

The application resource entry is `remote/bridge.mjs`, copied from `dist/bridge.bundle.mjs`. The bundled JavaScript is about 1.3 MB. Its installed production dependency staging is about 74 MiB on this Mac, including the optional native WebRTC module and the original werift fallback. Those are disk sizes, not runtime memory measurements. Node >=24.9 is required; an app should carry a same-architecture Node executable rather than rely on a developer NVM path. The native RTC path in an ordinary Node process does not use the Electron-specific RTC subprocess. The expected client process tree is the Go application plus one Node process, with WebKit processes appearing only when a compatibility page is opened.

## Authentication boundary

`configure` creates/reads a separate identity under `~/Library/Application Support/Native DSH/remote/<server-hash>/`. It never imports, refreshes, migrates or writes `~/.dsh` credentials. The helper rejects `~/.dsh` as a custom identity location. Account/password login and supported OAuth QR methods use existing server APIs; passwords travel only through the private stdio pipe and are not returned or logged.

The current configured service `https://dsh.rkbkosp.cn` returned an empty OAuth provider list in a read-only probe. Its supported shortest flow is therefore: open the new app, leave that server URL selected, enter the existing account/password in the app, then select a host. This registers the new app's client identity through the existing authentication API; it does not modify the dsh installation or its configuration. The user subsequently authorized this new client directly in the application. Agents did not submit a password or reuse the existing dsh credential chain. A read-only acceptance run then connected over LAN, read three workspaces and twelve root sessions, opened one completed session, and loaded one older page. Real running-stream updates and approval/question submission remain unverified; no task was created to manufacture those cases.

Existing on-disk access tokens were inspected only for availability/expiry metadata. They were expired. Their refresh tokens were not copied or consumed, because doing so could alter the existing authorization chain.

For post-authorization read-only validation:

```sh
node remote/probe.mjs https://dsh.rkbkosp.cn
node remote/probe.mjs https://dsh.rkbkosp.cn HOST_ID SESSION_ID
```

The probe uses only the new app's identity. It sets `readOnly: true`, does not register `$events`, does not answer approvals/questions, omits `activate` on `session/follow`, and does not submit any model task. It prints identifiers and counts, not session content or credentials. Using it while the UI holds the same client identity may replace an existing Remote transport; close the new UI connection before probing.

## Stdio contract

Requests are one JSON object per newline: `{ "id": 1, "method": "status", "params": {} }`. Responses echo the id with `result`, or `error: {code,message,delivery?}`. Definite pre-send or Host refusals use `delivery: "rejected"`; an uncertain mutation delivery returns an `unknown` receipt and must not be replayed with a new id. Notifications use `{method,params}`. The helper writes only this protocol to stdout.

Methods:

- `configure {serverUrl, deviceName?, forceRelay?}`; `authStatus {}`; `authProviders {}`.
- `login {email,password}`; `startQr {provider}`; `pollQr {qrId}`. QR UI must be absent when no returned provider has `qrAvailable`.
- `devices {}` returns `[{id,name,online,platform}]`.
- `connect {hostId,readOnly?}`. Normal connections wait for the `$events` ready frame before enabling sends. Read-only connections do not register an interaction answerer and reject mutations.
- `workspaces {}` preserves Host metadata and returns `[{id,name,path,sessionIds,...}]`; `selectWorkspace {workspaceId}` selects locally. `sessions {all:true}` returns the full root catalog. Shared `sessions` notifications always contain the full catalog, so selecting a workspace cannot erase other sidebar groups.
- `openSession {sessionId}` returns a passive, bounded initial history snapshot and continues following it; `history {beforeSeq?,throughSeq?}` explicitly loads an older page. The `hasMore` flag is preserved. No message count is silently discarded.
- `sendMessage {sessionId,text,mode?,requestId}` supports the original `queue` and `steer` modes; `cancel {sessionId,requestId}` requests interruption. Every explicit user action needs a stable request id of at least 16 characters. A lost receipt returns `status: "unknown"` and is not replayed automatically. Reusing that id with different content is rejected. An `accepted` receipt confirms request admission, not successful completion of the task.
- `answerApproval {requestId,outcome}` accepts `allowed-once`, `rejected`, or `cancelled`. `requestId` is the pending event id, not a new mutation id.
- `answerQuestions {requestId,answers:[{id,selected:[optionLabel],custom?}]}` or `{requestId,cancelled:true}`. Option labels are the wire values. Question dismissal becomes the existing `ASK_CANCELLED` rejection.
- `clearSession {}` aborts only the current frontend follow and delegates held interactions without changing Host tasks, connection or workspace selection. `disconnect {}` and `close {}` release the connection.

`operations.mjs` is the authoritative wrapper registry, including exact flat/nested wire parameter construction and validation. `capability-matrix.json` separates wired methods, frozen compatibility failures, missing endpoints and dedicated non-Typert RPC. Additional wrappers cover session/workspace operations, models, presets, commands, revision-fenced settings, plugin inventory/configuration, schedules, files, jobs, terminal and workspace uploads. A source entry does not imply a working UI or a real-write acceptance result. The schedule-create and plugin-update incompatibilities are disabled and documented in `installed-compatibility.md` using the actual installed compiled code.

Every scoped page call includes `clientScope: {hostId,generation,sessionId?,ownerId?}`. The helper checks the captured Host, generation, selection and owner ticket immediately before dispatch, fixes the gateway and abort signal for that call, and echoes the Host/generation in accepted mutation receipts. A queued request cannot silently execute on a replacement Host. `status` exposes `connectionGeneration`; authentication DTOs expose an opaque `identityScope`/`accountScope` for account-separated UI preferences, never a token or account address.

Compatibility pages register a unique owner using `registerOwner`, open bounded streams under that owner, and receive `remoteStream`/`remoteStreamEnd` notifications carrying its `ownerId`. `closeOwnerStreams` is a native lifecycle operation, not a web-page capability. Native destruction explicitly releases owners even when JavaScript cleanup cannot run. Closing a page does not close a Host terminal process. Terminal write/resize use a separate contiguous, acknowledged per-attachment sequence with bounded receipt retention; they do not consume the global durable mutation ledger for every key press. Unknown delivery breaks that attachment rather than replaying input.

Notifications are `status`, `sessions`, `snapshot`, `messageUpsert`, `messageRemove`, `messageDelta`, `sessionState`, `pending`, and `error`. Initial opens, rebaselines and explicit history batches carry complete snapshots. Streaming changes carry only a changed message or text/reasoning suffix, never the complete retained history. `messageUpsert` has `{sessionId,message,index}`; `messageRemove` has `{sessionId,ids}`; `messageDelta` has `{sessionId,messageId,textAppend,reasoningAppend,streaming}`. `sessionState` has `{sessionId,running,cursor,hasMore}` and `pending` has `{sessionId,items}`. A snapshot contains `{sessionId,messages,pending,running,cursor,hasMore}`. Messages have `{id,role,text,reasoning?,streaming,seq?,blocks?,callId?,toolName?,toolStatus?}`. Pending items contain `{id,sessionId,kind,title,reason,questions?}`; kind is `approval` or `questions`. Questions retain the existing `{id,question,detail?,header?,options?:[{label,description?}],multiSelect?,intent?}` fields.

Only the currently opened session and catalog-confirmed descendants can claim an interaction. With no opened session, or for unrelated sessions, the helper immediately delegates the waterfall with `next`. Switching sessions delegates held requests; disconnect cancels/delegates them. Cancelled or old-generation decisions cannot grant permission later. Child-session identifiers are preserved rather than relabelled as the selected root session.

## Validation limits

The protocol tests cover official envelopes, stable request ids, lost responses, interaction correlation, cancellation, current chunk forms, snapshot replacement, surface replacement positions and revision gaps. They are local fixtures. The separate post-authorization read-only acceptance evidence is `../qa/runtime-results/live-readonly.json`: LAN connection, passive completed-session snapshot with 188 unique display records, then one older page with 384 unique display records. Cursor remained 3786 with `hasMore: true`; the probe registered no `$events` answerer and issued no mutations. The `--fixture` flag runs a deterministic simulated client for Go-to-Node UI acceptance and labels status/data as fixture. Normal startup never enables it.

The native presentation projection uses the frozen original context producer/form, assistant block and steering-history semantics, while preserving loaded raw events for trajectory. It provides text, reasoning, context/compaction, command and tool-call/result metadata. It does not reproduce every plugin-specific renderer. The separate ephemeral compatibility UI now reuses the original plugin manager and configuration cards, model picker, trajectory engine/view and terminal model/xterm renderer. Complete image galleries, arbitrary third-party module pages and several resource GET routes remain gaps. Workspace upload returns a file path reference; it does not claim the original image-attachment receipt semantics. See `../compat/README.md` and the capability matrix.

The incremental transport budget test retains 1,000 completed messages of about 1 KiB each and flushes 100 short chunks. It emits one transient upsert and 99 suffix deltas, totalling 16,598 serialized bytes, with no completed history in those frames. This is a protocol fixture measurement, not end-to-end screen latency. A single passive core `session/control` stream also forwards the selected session's actual projection values as small `sessionProjections` notifications; it does not reload history or poll models on each token.

The frozen dsh `0.2.2-rc.3` generated descriptor names the `session/list` argument `_request`, so this client sends `{args:{_request:{}}}` there. `session/follow`, `page`, `prompt`, and `cancel` retain the parameter name `request`; `workspace/follow` has no application arguments. This was corrected from an actual read-only Host rejection, then covered by the fixture and independent contract test.
