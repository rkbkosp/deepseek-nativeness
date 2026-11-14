# Ephemeral original-component pages

This local static bundle runs only inside a dedicated trusted mygo WKWebView. It calls the existing native app's stdio client through `CompatAPI`; it creates no second Remote connection, login, `$events` answerer or HTTP server. Native chat, sidebar and composer remain native views.

The frozen upstream is dsh `0.2.2-rc.3`, commit `39163dd30f703a79079e2d2446545cff3c453738`. Original components and pure state machinery are bundled from that read-only checkout. `dist/source-manifest.json` records the selected source closure and the narrow transforms. `dist/DSH-LICENSE` preserves the source license.

Current routes:

| Route        | Original implementation used                                                                                        | Limits                                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `plugins`    | PluginManagerPage, package sorting/detail, Shell/Subagent/AgentLoop/WebSearch cards and staged settings controllers | Remote-owned bundle is explicitly a connection-only read-only entry; market, install/remove, incompatible updates and unavailable provider discovery are disabled. Arbitrary third-party frontend slots and relative detail resources are unavailable. |
| `models`     | ModelSelect, catalog/projection selection and reasoning controls                                                    | Full-page diagnostic entry; normal composer uses `model-menu`. Team state can be read but its setter is outside Remote.                                                                                                                                |
| `model-menu` | Same original ModelSelect menu, search, keyboard, provider, reasoning and detail panes                              | Exact source transform removes the extra trigger and opens the original pane directly. Selection waits for an accepted scoped receipt before closing the native popover.                                                                               |
| `trajectory` | Original assembler, definitions, assistant stream, snapshot builder, Timeline/Table/View                            | Own passive follow only while visible, no activate. Loaded raw event semantics are preserved. Image-gallery slot remains incomplete.                                                                                                                   |
| `terminal`   | Original TerminalView/Inventory/WindowHold/RemoteStream and LazyTerminalBody/xterm                                  | Page open only lists; explicit user creation is separate. Current-device ownership and legacy carrier limits apply. No live create/input test has been performed.                                                                                      |

`GetContext` supplies the captured Host/session/generation/owner, appearance, outer window inset and font preferences. `Request` exposes a native allowlist of low-frequency wrappers; authentication, prompts and arbitrary methods are not web capabilities. The helper verifies the same captured scope at dispatch. External navigation receives no bindings. The local page's CSP disallows network access; RPC travels through native bindings.

The native app registers an owner before loading the page and explicitly calls `closeOwnerStreams` on page destruction, page/Host/session replacement, load failure, renderer failure and window close. This is required even if React cleanup never runs. Stream events carry `ownerId` and only the current page receives its own events. Queued operations from retired owners are rejected; an admitted uncertain mutation is never silently retried.

Build and fixture checks from the repository root:

```sh
npm ci --prefix desktop/compat
npm run build --prefix desktop/compat
node desktop/compat/build.mjs --engine-test
node --test desktop/compat/test/*.test.mjs
cd desktop
node --test qa/owner-lifecycle.test.mjs qa/terminal-runtime.test.mjs
```

The current accepted-for-GUI-review slice is a single minified entry: JavaScript 5,186,481 bytes and CSS 225,393 bytes. Those are build bytes, not runtime memory. Route-level splitting is deliberately the next independent performance change after the current UI slice is reviewed. The application bundle must copy the complete `dist/` directory under `Contents/Resources/compat/`.

Fixtures exercise original trajectory and terminal state code, early stream frames, owner disposal, 20 repeated open/close cycles, stale scope, bounded terminal input and unknown-delivery handling. They do not establish live write behavior or complete visual parity. Actual read-only GUI comparison and M1 performance acceptance remain separate gates; no fixture starts a real shell or model task.
