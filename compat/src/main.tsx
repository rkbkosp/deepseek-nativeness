import "../../../deepseek-harness/packages/client/web/src/base.css";
import "../../../deepseek-harness/packages/client/ui-theme/src/client/styles.ts";
import "./shell.css";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { installIconSprite } from "../../../deepseek-harness/packages/client/ui-theme/src/client/icon-sprite.ts";
import { context } from "./bridge";
import { no } from "./presentation";
import { loadRoute } from "./route-loader";
function App() {
  const [Page, setPage] = useState<React.ComponentType<{ ctx: any }> | null>(
    null,
  );
  const [ctx, setContext] = useState<any>(),
    [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    const page = new URLSearchParams(location.search).get("page") ?? "plugins";
    document.body.toggleAttribute(
      "data-native-model-menu",
      page === "model-menu",
    );
    Promise.all([context(), loadRoute(page)])
      .then(([c, Component]) => {
        if (disposed) return;
        setContext(c);
        setPage(() => Component);
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
        setError(e.message);
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
  return Page ? <Page ctx={ctx} /> : null;
}
const fatal = () => {
  void window.mygo
    ?.call("CompatAPI.ReportFailure")
    .catch(() => window.mygo?.call("CompatAPI.Close").catch(() => {}));
};
window.addEventListener("error", fatal);
window.addEventListener("unhandledrejection", fatal);
createRoot(document.getElementById("root")!).render(<App />);
