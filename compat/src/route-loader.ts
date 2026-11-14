import type { ComponentType } from "react";

const routes: Record<
  string,
  { file: string; exportName: string; load: () => Promise<any> }
> = {
  plugins: {
    file: "plugins",
    exportName: "default",
    load: () => import("./routes/plugins.js"),
  },
  models: {
    file: "models",
    exportName: "default",
    load: () => import("./routes/models.js"),
  },
  "model-menu": {
    file: "models",
    exportName: "default",
    load: () => import("./routes/models.js"),
  },
  trajectory: {
    file: "trajectory",
    exportName: "TrajectoryPage",
    load: () => import("./routes/trajectory.js"),
  },
  terminal: {
    file: "terminal",
    exportName: "TerminalPage",
    load: () => import("./routes/terminal.js"),
  },
  "agent-presets": {
    file: "agent-presets",
    exportName: "default",
    load: () => import("./routes/agent-presets.js"),
  },
  "model-settings": {
    file: "model-settings",
    exportName: "default",
    load: () => import("./routes/model-settings.js"),
  },
  automation: {
    file: "automation",
    exportName: "default",
    load: () => import("./routes/automation.js"),
  },
};

/** Independent page entries keep unrelated CSS and renderer code out of a popup. */
export async function loadRoute(
  page: string,
): Promise<ComponentType<{ ctx: any }>> {
  const route = routes[page];
  if (!route) throw new Error("此兼容页面尚未接入。");
  const css = new URL(`routes/${route.file}.css`, document.baseURI).href;
  const [, module] = await Promise.all([
    new Promise<void>((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = css;
      link.onload = () => resolve();
      link.onerror = () => {
        link.remove();
        reject(new Error("页面样式加载失败。"));
      };
      document.head.append(link);
    }),
    // Keep this as a runtime import: each route is a separate bundler entry,
    // so esbuild does not merge its styles into the initial app.css.
    route.load(),
  ]);
  const Page = module[route.exportName];
  if (typeof Page !== "function") throw new Error("页面模块不完整。");
  return Page;
}
