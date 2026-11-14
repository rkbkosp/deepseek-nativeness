# Menu positioning in WKWebView

The macOS support floor is 15.8. That declaration does not establish which CSS anchor features the running WKWebView supports. The local compatibility build retains the original CSS path only when **all four** checks succeed:

- `position-anchor: --native-menu`
- `top: anchor(bottom)`
- `width: anchor-size(width)`
- `position-try-fallbacks: flip-block`

Otherwise the build adds placement hooks to the frozen `Menu.tsx`, `useMenuSubmenu.ts`, and `MenuSurface.tsx`. These hooks position the existing main portal, side/single-page submenu, and Darwin backing. They preserve the source menu's keyboard, composition, pointer grace, selection, transitions, and dismissal logic. The embedded native model popover keeps its existing dedicated viewport layout.

Placement uses the existing refs, side/alignment/point, parent card and row geometry. It flips and clamps within the source 12-DIP window margins and frame inset, matches requested anchor width, and preserves the original submenu side/page decision. Scroll and viewport resize are combined into one requested frame. Resize observers cover the mounted card, trigger and at most eight ancestors. The added mutation observer watches only that card's relevant attributes; no document-wide observer or polling loop is added. Closing removes listeners, observers, scheduled frames and temporary styles. Backing follows its own card's rectangle, including nested cards.

`node compat/build.mjs --engine-test` followed by `node --test compat/test/menu-anchor.test.mjs` exercises forced fallback geometry, partial support detection, resizing, captured points, nested side/page/backing, forwarded refs, supported-path bypass, and 20 open/close cycles. This is deterministic fixture evidence, **not** actual macOS 15.8/M1 or composed WK pixel acceptance. The new bundle is built separately with `node compat/build.mjs --out-layout-next`; the GUI7 and fallback assets remain unchanged. Build closure sizes are in `anchor-fallback-review.json` and `dist-layout-next/route-budgets.json`; these byte counts are not runtime memory measurements.

For actual WK QA, `node compat/build.mjs --force-menu-anchor-fallback` produces the independent `dist-layout-forced-test` tree. It compiles `NATIVE_DSH_FORCE_MENU_ANCHOR_FALLBACK=true`; the normal layout build explicitly compiles `false`. There is no runtime flag or product preference. `node scripts/compare-anchor-assets.mjs` verifies the identical source input set and records all normal/forced assets. `scripts/build-app.sh --use-forced-layout-assets` creates `build/Native DSH Remote Anchor QA.app` with bundle ID `cn.rkbkosp.native-dsh.remote.anchor-qa`. Normal GUI8 uses `--use-layout-assets`. Both use the same Go/Node/helper and existing private client state; run one review application at a time. Neither build packages or activates the separate NSTextView proof component.
