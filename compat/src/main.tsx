import "../../../deepseek-harness/packages/client/web/src/base.css";
import "../../../deepseek-harness/packages/client/ui-theme/src/client/styles.ts";
import "./shell.css";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { installIconSprite } from "../../../deepseek-harness/packages/client/ui-theme/src/client/icon-sprite.ts";
import { context } from "./bridge";
import {
  CompatBoundary,
  recordFailure,
  recordWindowFailure,
} from "./error-boundary";
import { no } from "./presentation";
import { loadRoute } from "./route-loader";
import { installSettingsKeys } from "./settings-keys";
const routeName = () =>
  new URLSearchParams(location.search).get("page") ?? "plugins";
function App() {
  const page = routeName();
  const [Page, setPage] = useState<React.ComponentType<{ ctx: any }> | null>(
    null,
  );
  const [ctx, setContext] = useState<any>(),
    [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    document.body.toggleAttribute(
      "data-native-model-menu",
      page === "model-menu",
    );
    Promise.all([context(), loadRoute(page)])
      .then(([c, Component]) => {
        if (disposed) return;
        setContext(c);
        setPage(() => Component);
        document.body.dataset.compatPlacement = c.placement ?? "";
        if (c.placement === "settingsContent")
          cleanup.push(
            installSettingsKeys(document, () => {
              void window.mygo?.call("CompatAPI.Close").catch(() => {});
            }),
          );
        const inset =
          c.globalPageInset ??
          Math.min(48, Math.max(24, 0.04 * (c.windowWidth ?? innerWidth)));
        document.body.style.setProperty(
          "--native-dsh-global-page-inset",
          `${inset}px`,
        );
        document.body.style.setProperty(
          "--dsh-content-font-size",
          `${c.fontSize ?? 14}px`,
        );
        document.body.style.setProperty(
          "--dsh-code-font-size",
          `${c.codeFontSize ?? 11}px`,
        );
        if (c.fontFamily?.trim())
          document.body.style.setProperty(
            "--dsh-font-family-text",
            c.fontFamily,
          );
        if (c.codeFontFamily?.trim())
          document.body.style.setProperty(
            "--dsh-font-family-code",
            c.codeFontFamily,
          );
        document.body.toggleAttribute(
          "data-ds-dark-theme",
          c.theme === "dark" ||
            (c.theme === "system" &&
              matchMedia("(prefers-color-scheme:dark)").matches),
        );
        document.documentElement.style.setProperty(
          "--dsh-font-size",
          `${c.fontSize ?? 14}px`,
        );
      })
      .catch((e) => {
        // No route, no context: the page genuinely cannot work.
        setError(e.message);
        recordFailure({
          scope: "page",
          label: page,
          message: String(e?.message ?? e),
          stack: e instanceof Error ? e.stack : undefined,
          at: new Date().toISOString(),
        });
        fatal();
      });
    const cleanup: Array<() => void> = [];
    installIconSprite(
      {
        effect: (fn: any) => {
          const off = fn();
          if (typeof off === "function") cleanup.push(off);
        },
        on: no,
      } as any,
      undefined,
    );
    return () => {
      disposed = true;
      cleanup.forEach((fn) => fn());
    };
  }, []);
  if (error)
    return (
      <p role="alert" className="notice">
        {error}
      </p>
    );
  if (!ctx)
    return (
      <p role="status" className="notice">
        正在连接原生客户端…
      </p>
    );
  return Page ? (
    <CompatBoundary scope="page" label={page}>
      <Page ctx={ctx} />
    </CompatBoundary>
  ) : null;
}
/** Report the page as failed; the shell closes it and shows its banner. */
const fatal = () => {
  void window.mygo
    ?.call("CompatAPI.ReportFailure")
    .catch(() => window.mygo?.call("CompatAPI.Close").catch(() => {}));
};
// A page that cannot name its own failure must not report itself dead: these
// are recorded for the probe and the page keeps rendering. Only `loadRoute` and
// `context()` failures below still report, because then there is no page at all.
window.addEventListener("error", (event) => recordWindowFailure("error", event));
window.addEventListener("unhandledrejection", (event) =>
  recordWindowFailure("unhandledrejection", event),
);
createRoot(document.getElementById("root")!).render(<App />);
