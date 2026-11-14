# Session actions: supported wire contracts and acceptance limits

These are frontend/helper contracts for frozen Remote v0.6.4 and dsh 0.2.2-rc.3. No new server API is required. All mutation validation below used local fixtures; no real feedback was recorded and no real session was forked. Native UI wiring and real read-only full export acceptance are separate stages. GUI7 resources remain frozen; this source belongs to the next helper candidate.

## Complete Session Markdown

`exportSessionMarkdown` takes:

```json
{"sessionId":"captured-session","clientScope":{"hostId":"captured-host","generation":12,"sessionId":"captured-session","ownerId":"unique-export-owner"}}
```

Register that owner first with `registerOwner {ownerId,clientScope:{hostId,generation,sessionId}}` (the registration's scope does not already contain the new owner id). Explicit native cancellation/window closure/navigation must call `closeOwnerStreams {ownerId}`. The operation uses the existing connection and does not open another follow stream or register another `$events` answerer. It works on read-only connections when the Host grants `session/events`.

The helper confirms `remote.history.configure {compact:false}` for **this peer's read projection only**, then reads `session/events` pages with `maxMessages:200`. The first response's inclusive `cursor` is fixed as `throughSeq` on every older page, with `beforeSeq` equal to the earliest returned event. Identical overlapping events are deduplicated; conflicting events, missing sequence numbers, moving cursors and non-progressing pages fail. A result is complete only if every canonical logical event from seq 0 through that cut was collected. A later live append is outside the captured cut, just as an export made at a point in time is. Fork-inherited prefixes arrive once on this logical event axis; the client does not recursively load parents.

The helper imports the exact pure `formatSessionMarkdown` from pinned `packages/session-query/session-log-export/src/markdown.ts`, bundled locally. The original HTTP route uses the same function over `sessionQuery.readSession(...).events`. The formatter's own rules remain intact: human prompts, intermediate assistant/tool sections, final answers and image/file labels; no reasoning, injected non-human context, runtime records or compaction replacements. The complete event log is the input; the visible chat surface is not.

Successful result:

```json
{"sessionId":"captured-session","markdown":"# ...\n","complete":true,"throughSeq":123,"eventCount":124,"source":"original-formatSessionMarkdown+session/events","sourcePathIncluded":false}
```

`sourcePathIncluded:false` is deliberate: the HTTP route can optionally add the Host's resolved artifact-file path. No equivalent metadata is requested here, so that path block is absent. Transcript formatting is the original formatter; byte identity with an HTTP document containing a path block is not claimed. Raw ZIP/session-file download still requires a separate resource carrier.

Budgets are explicit failure limits, never silent truncation: 200,000 logical events, 32 MiB summed raw-event JSON, 2,000 pages, and 8 MiB serialized result (below the native stdout scanner's 16 MiB line limit). Export is an occasional full-log operation with bounded temporary memory; it is not a streaming chat optimization. A limit, read failure or invalid page yields no purported complete partial document. The prior `exportLoadedHistory` remains labelled `complete:false`; do not use it under the original complete-copy label.

Capabilities expose `readSessionEvents` for the raw read and composed `exportSessionMarkdown` only when the Host grants that endpoint and advertises uncompacted-history negotiation. Native UI should capture Host/account/generation/session/client and keep one pending copy intent; owner destruction or stale late completion must not reach clipboard/file output. A successful helper read is not proof that an OS clipboard/file write succeeded.

## Message feedback

The installed generated descriptors confirm all three endpoints are present and Remote allows them:

- `listFeedback {sessionId}` → raw business result `{ok:true,value:{items:[...]}}` or `{ok:false,error}`.
- `putFeedback {sessionId,messageId,rating,ifVersion,note?,category?,requestId,clientScope}` → stable mutation receipt whose `value` is the **business** `{ok,value|error}` result.
- `deleteFeedback {sessionId,messageId,ifVersion,requestId,clientScope}` → same receipt shape, business success `{ok:true,value:{absent:true}}`.

Their exact Host envelopes are `{args:{request:{...businessFields}}}`. `requestId` and `clientScope` are helper fields and do not enter the Host request. `putFeedback.ifVersion` is required: `null` means no prior feedback exists; otherwise use the exact observed item version. Delete requires its observed nonempty version. `rating` is `positive|negative`. Categories are `task-result`, `instruction-following`, `product-interaction`, `service-stability`, `resource-cost`, `security-privacy-permission`, or `other`. An optional note must be nonblank; the Host owns its byte-size policy and may return `note-too-large`.

**Identity:** `messageId` is the committed original assistant-message identity (`data.message.id`), exposed by the projection as `sourceMessageId`. The renderer's stable row id such as `event:52`, transient `attempt:*`, tool row id, title or seq is not this identity. Do not offer feedback on a transient or unsupported row lacking that committed id. The Host validates an append-origin assistant message and returns `target-not-found` for a bad target. The selected Session id remains the target lifecycle; inherited feedback belongs to its recorded parent and must not be remapped to a different owner.

An outer `status:'accepted'` means the carrier delivered the request. It does **not** mean the business mutation succeeded. On `value.ok:false` inspect its error. `version-conflict` carries authoritative `current` (item or null); reconcile it and preserve the user's draft rather than optimistically changing the rating. Current-item retraction uses delete with its exact version. Original UI loads feedback once at first hover/focus; clicking the currently recorded matching rating retracts it, while another rating opens the original dialog and commits only on submit.

Unknown delivery retains the same unchanged request id/payload and cannot be automatically retried with a fresh id. A later user intent after explicit conflict reconciliation receives a new id. Real feedback may authorize log delivery through existing Host behavior: development fixtures did not invoke it on the live Host.

## Fork

`forkSession {sessionId,atSeq?,allowMigration?,requestId,clientScope}` sends exactly:

```json
{"args":{"request":{"sessionId":"source","atSeq":17,"allowMigration":false}}}
```

`atSeq` is an **inclusive event** boundary, not a display-row index or assistant message id. The original chat footer uses the completed turn's `turn.end.seq`. Omission chooses the latest completed-turn prefix, including subsequent standalone events up to the next prompt/turn. A source with no completed prefix is rejected. The Host synthesizes closers for a deliberately open cut. The installed descriptor confirms `request` and the three business fields; `increaseTitle` is not a wire field.

Original sidebar/menu flow sends `allowMigration:false` to avoid silently migrating a cold source and lets the user open/migrate it first after `session/migration-required`. The Host defaults this option to true when omitted; callers must choose deliberately. The already-open chat footer uses its captured turn boundary. Neither form sends a model prompt.

Accepted result is `{status:'accepted',requestId,hostId,connectionGeneration,value:{sessionId:<child>}}`. The original client then increases the title in a **separate** `session/rename` call, using an available trailing `(n)` or `（n）` suffix, and navigates only after the intended follow-up succeeds. A child rename failure never means the child was not created; never refork to recover it.

There is also an exact partial-success branch: `session/workspace-attach-failed` with a published `details.sessionId` means creation happened before workspace attachment failed. The helper now caches:

```json
{"status":"partial","requestId":"same-intent","hostId":"captured-host","connectionGeneration":12,"value":{"sessionId":"created-child","workspaceId":"optional-workspace"},"error":{"code":"session/workspace-attach-failed","message":"会话已创建，但未能加入工作区；请刷新核对，不要再次分叉。"}}
```

It must not be labelled definite rejection or safe to replay. The UI should retain the created child identity, explain incomplete grouping, refresh/read back, and avoid automatic open/rename/refork. Reusing the same request id returns that same cached receipt, without a second Host dispatch. If that failure supplies no child identity, the helper returns a cached `unknown` receipt rather than a replayable rejection, because creation may already have happened. Other definitive Host refusals remain `delivery:'rejected'`; transport uncertainty is `status:'unknown'` and is never replayed automatically. The helper ledger is process-local, not durable server deduplication, so restarting the app is not permission to repeat an unconfirmed fork.
