# M1 / macOS 15.8+ acceptance

This is a future acceptance procedure, not a measured result. Current GUI11 evidence is Apple M4 / macOS 27.2.1. The packaged bundle declares macOS 15.8 and contains arm64 binaries; load-command/API-floor checks do not establish an actual 15.8 run.

The current distributable is `build/notary-gui11/Native DSH Remote-macOS-arm64-notarized.zip`, SHA256 `68c587285692678764559be22c6359fe92f7435690f555d1e35886ebddc08a6e`. Apple accepted submission `8431530d-dd42-4365-a64c-f254f3245451`; root independently extracted all 3601 inventory entries and passed strict signature, stapled-ticket and Gatekeeper checks. Signing and notarization do not establish visual, operation or performance parity. Source-only native input component work is excluded from this fixed bundle.

Use the user's M1 MacBook Air as a Remote client to the existing MacMini. Keep the Host, official installation, Remote plugin, permissions and tasks unchanged. Do not create prompts, approvals, terminal input or synthetic Host work to populate a benchmark.

## Comparable scenes

1. Same completed session, same viewport/theme/font size, sidebar expanded with the same naturally running session indicators.
2. Same session and viewport, sidebar collapsed.
3. A session naturally producing updates, observed passively; record its actual text/tool update rate and indicator count.
4. Open an original-component compatibility settings/plugin page, navigate read-only, then close it.
5. Repeated open/close of the same page to inspect native owners, child process retirement and whether memory settles.

Preserve normal animations. The user's previous reduced-motion measurements are a separate baseline. Do not restart/reconfigure the frozen official app to alter its motion flag; the owner can prepare the intended original-app scene when this experiment is authorized.

## Measurements

- Record OS build, chip, app source commit and full bundle manifest hash.
- Count the native process, Node helper and application-associated WebKit processes together. Report process identities and allocation method; do not accidentally include another app's WebKit renderer or omit detached WebKit processes.
- CPU is CPU-time delta divided by elapsed wall time, reported as percent of one core. Retain median, p95 and maximum 1-second samples after a stated warm-up; include at least three comparable windows, and account for scene updates changing naturally between windows.
- Report physical footprint and peak physical footprint where available. RSS, JavaScript heap, Go allocation counters and disk bundle bytes are separate measurements.
- Record scrolling/input response and visible animation continuity. Screenshot/AX presence alone does not prove correct compositing or smooth frames.
- For streaming scenes, correlate content update count/bytes with CPU; a quiet session cannot stand in for an actively updating session.
- Observe WebKit close cleanup and settling over time. A resource cache limit is not the entire app's peak memory bound.

Keep credentials and session captures private. The owner signs into the new client's separate identity on the test machine; do not transfer the official app's tokens. Local fixture results must remain labeled separately from live read-only results.

## Acceptance boundary

The target is original visual timing and operations with lower full-client CPU/memory. Do not claim an improvement from M4 synthetic counters or the existing one-off footprint sample. Record any OS/M1 launch failure and any unsupported original operation explicitly; backend-frozen resource and compatibility limits remain limitations rather than completed parity.
