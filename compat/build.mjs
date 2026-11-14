import { build } from "esbuild";
import { existsSync } from "node:fs";
import { readFile, readdir, mkdir, writeFile, cp, rm } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(fileURLToPath(import.meta.url)),
  source = resolve(root, "../../deepseek-harness"),
  packages = new Map();
async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !["node_modules", ".git", "lib", "dist"].includes(entry.name),
      )
      .map(async (entry) => {
        const dir = join(path, entry.name);
        try {
          const pkg = JSON.parse(
            await readFile(join(dir, "package.json"), "utf8"),
          );
          if (pkg.name) packages.set(pkg.name, { dir, pkg });
        } catch {}
        await walk(dir);
      }),
  );
}

await walk(join(source, "packages"));
const primitivesRoot = join(source, "packages/client/ui-primitives/src");
const primitivesIndex = await readFile(
  join(primitivesRoot, "index.ts"),
  "utf8",
);
const primitivesIcons = await readFile(
  join(primitivesRoot, "icons/index.tsx"),
  "utf8",
);
const primitiveLeaves = new Map();
for (const match of primitivesIndex.matchAll(
  /export\s+(?:type\s+)?\{([^{}]+)\}\s+from\s+'([^']+)'/gm,
)) {
  for (const item of match[1].split(",")) {
    const parts = item
      .trim()
      .replace(/^type\s+/, "")
      .split(/\s+as\s+/);
    primitiveLeaves.set(parts.at(-1), resolve(primitivesRoot, match[2]));
  }
}
const plugin = {
  name: "frozen-source-workspace",
  setup(b) {
    // Keep the original menu's business behavior and CSS on capable WebKit.
    // Older WK receives only a mounted-menu placement observer, never a global
    // polyfill or a modified copy of the frozen reference repository.
    b.onLoad(
      {
        filter:
          /ui-primitives\/src\/(Menu\.tsx|MenuSurface\.tsx|useMenuSubmenu\.ts)$/,
        namespace: "file",
      },
      async (args) => {
        let contents = await readFile(args.path, "utf8");
        const module = JSON.stringify(
          join(root, "src/menu-anchor-fallback.ts"),
        );
        const swap = (from, to) => {
          if (!contents.includes(from))
            throw Error(`Frozen menu anchor seam changed: ${args.path}`);
          contents = contents.replace(from, to);
        };
        if (args.path.endsWith("/Menu.tsx")) {
          contents =
            `import {useNativeMenuAnchor} from ${module};\n` + contents;
          swap(
            "const positioned = !portal || anchorRef === undefined || externalAnchor !== null",
            `const positioned = !portal || anchorRef === undefined || externalAnchor !== null
  useNativeMenuAnchor(listRef,anchorRef ?? rootRef,{active:open || exiting !== undefined,portal,side,align,point,matchWidth:minWidthFromAnchor,external:externalAnchor})`,
          );
        } else if (args.path.endsWith("/useMenuSubmenu.ts")) {
          contents =
            `import {useNativeSubmenuAnchor} from ${module};\n` + contents;
          swap(
            "const focusFirstChild = (): void => {",
            `useNativeSubmenuAnchor(panelRef,listRef,{active:visible,page,trigger})
  const focusFirstChild = (): void => {`,
          );
        } else {
          contents =
            `import {useNativeMenuBacking,useNativeMenuSurfaceRef} from ${module};\n` +
            contents;
          swap(
            "const id = useId()",
            "const id = useId()\n  const [surfaceRef,captureSurface] = useNativeMenuSurfaceRef(ref)",
          );
          swap(
            "const anchorStyle: CSSProperties",
            "useNativeMenuBacking(surfaceRef,backingRef)\n  const anchorStyle: CSSProperties",
          );
          swap(
            "<div {...props} ref={ref}",
            "<div {...props} ref={captureSurface}",
          );
        }
        return {
          contents,
          loader: args.path.endsWith("tsx") ? "tsx" : "ts",
          resolveDir: dirname(args.path),
        };
      },
    );
    b.onResolve({ filter: /^\.\/routes\/[a-z-]+\.js$/ }, (args) => ({
      path: args.path,
      external: true,
    }));
    b.onResolve({ filter: /^rrule$/ }, () => ({
      path: join(root, "node_modules/rrule/dist/es5/rrule.js"),
    }));
    b.onLoad(
      {
        filter: /ui-schedule\/src\/client\/TaskManagerPage\.tsx$/,
        namespace: "file",
      },
      async (args) => {
        let contents = await readFile(args.path, "utf8");
        const edits = [
          [
            "onClick={onNewTask}>{t('new.action')}",
            "disabled={(props as any).nativeStartDraftAvailable === false} onClick={onNewTask}>{t('new.action')}",
          ],
          [
            "onSelect={() => { setCreateMenuOpen(false); onNewTask() }}>",
            "disabled={(props as any).nativeStartDraftAvailable === false} onSelect={() => { setCreateMenuOpen(false); onNewTask() }}>",
          ],
          [
            "onSelect={() => { setCreateMenuOpen(false); createManually(createTriggerRef.current) }}>",
            'disabled={(props as any).nativeManualCreateAvailable === false} title="Remote0.6.4与当前Host创建接口不兼容" onSelect={() => { setCreateMenuOpen(false); createManually(createTriggerRef.current) }}>',
          ],
        ];
        for (const [from, to] of edits) {
          if (!contents.includes(from))
            throw Error("Frozen schedule capability seam changed");
          contents = contents.replace(from, to);
        }
        return { contents, loader: "tsx", resolveDir: dirname(args.path) };
      },
    );
    b.onLoad(
      { filter: /ui-settings\/src\/client\/schema\.ts$/, namespace: "file" },
      async (args) => {
        let contents = await readFile(args.path, "utf8");
        const edits = [
          ["import { Service } from '@deepseek-ai/cordis'", ""],
          [
            "export class SettingsSchemaService extends Service {",
            "export class SettingsSchemaService {",
          ],
          ["    super(ctx, 'settingsSchema')", "    void ctx"],
        ];
        for (const [from, to] of edits) {
          if (!contents.includes(from))
            throw Error("Frozen settings schema seam changed");
          contents = contents.replace(from, to);
        }
        return { contents, loader: "ts", resolveDir: dirname(args.path) };
      },
    );
    b.onResolve(
      { filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ },
      async (args) => {
        const importer = await readFile(args.importer, "utf8"),
          names = new Set();
        for (const match of importer.matchAll(
          /import\s*\{([^{}]+)\}\s*from\s*['"]@deepseek-ai\/dsh-client-ui-primitives['"]/gm,
        )) {
          for (const item of match[1].split(",")) {
            const name = item.trim();
            if (name && !name.startsWith("type "))
              names.add(name.split(/\s+as\s+/)[0]);
          }
        }
        if (!names.size)
          throw Error(
            "Primitive imports require an explicit named source seam: " +
              args.importer,
          );
        const exports = [...names]
          .map((name) => {
            const leaf =
              primitiveLeaves.get(name) ??
              (new RegExp(`\\b${name}\\b`).test(primitivesIcons)
                ? join(primitivesRoot, "icons/index.tsx")
                : null);
            if (!leaf)
              throw Error("Frozen primitive export not found: " + name);
            return `export {${name}} from ${JSON.stringify(leaf)};`;
          })
          .join("\n");
        return {
          path: args.importer,
          namespace: "selected-original-primitives",
          pluginData: exports,
        };
      },
    );
    b.onLoad(
      { filter: /.*/, namespace: "selected-original-primitives" },
      (args) => ({
        contents: args.pluginData,
        loader: "ts",
        resolveDir: source,
      }),
    );
    b.onLoad(
      {
        filter: /ui-model-selection\/src\/client\/ModelSelect\.tsx$/,
        namespace: "file",
      },
      async (args) => {
        let contents = await readFile(args.path, "utf8");
        const edits = [
          [
            "  const [open, setOpen] = useState(false)",
            "  const embedded = new URLSearchParams(location.search).get('page') === 'model-menu'\n  const [open, setOpen] = useState(embedded)",
          ],
          [
            "  const close = (restoreFocus = false): void => {",
            "  const close = (restoreFocus = false): void => {\n    if (embedded) void (window as any).mygo.call('CompatAPI.Close').catch(() => {})",
          ],
          [
            "const paneFocus = useRef<'drill' | DrilledPane | null>(null)",
            "const paneFocus = useRef<'drill' | DrilledPane | null>(embedded ? 'drill' : null)",
          ],
          [
            "      <button\n        ref={triggerRef}",
            "      {!embedded && (<button\n        ref={triggerRef}",
          ],
          [
            "      </button>\n\n      {/* Portaled",
            "      </button>)}\n\n      {/* Portaled",
          ],
          [
            '          data-model-menu=""',
            '          data-model-menu=""\n          data-native-model-pane={embedded ? pane.kind : undefined}',
          ],
        ];
        for (const [from, to] of edits) {
          if (!contents.includes(from))
            throw Error("Frozen ModelSelect embedding seam changed");
          contents = contents.replace(from, to);
        }
        return { contents, loader: "tsx", resolveDir: dirname(args.path) };
      },
    );

    b.onLoad(
      { filter: /PluginManagerPage\.module\.css$/, namespace: "file" },
      async (args) => {
        const contents = await readFile(args.path, "utf8"),
          original = "--plugin-page-inset: clamp(24px, 4vw, 48px);";
        if (!contents.includes(original))
          throw Error("Frozen plugin viewport declaration changed");
        return {
          contents: contents.replace(
            original,
            "--plugin-page-inset: var(--native-dsh-global-page-inset, clamp(24px, 4vw, 48px));",
          ),
          loader: "local-css",
          resolveDir: dirname(args.path),
        };
      },
    );
    b.onLoad(
      { filter: /TaskManagerPage\.module\.css$/, namespace: "file" },
      async (args) => {
        const contents = await readFile(args.path, "utf8"),
          from = "padding: 0 clamp(24px, 4vw, 48px) 48px;";
        if (!contents.includes(from))
          throw Error("Frozen automation viewport declaration changed");
        return {
          contents: contents.replace(
            from,
            "padding: 0 var(--native-dsh-global-page-inset, clamp(24px, 4vw, 48px)) 48px;",
          ),
          loader: "local-css",
          resolveDir: dirname(args.path),
        };
      },
    );
    b.onResolve({ filter: /^@deepseek-ai\// }, (args) => {
      if (
        args.path === "@deepseek-ai/dsh-api-gateway/client" &&
        args.importer.endsWith("/api/terminal-controller/src/client/model.ts")
      )
        return {
          path: resolve(
            source,
            "packages/api/gateway/src/client/stream-client.ts",
          ),
        };
      const name = args.path.split("/").slice(0, 2).join("/"),
        record = packages.get(name);
      if (!record) return;
      const sub = args.path.slice(name.length);
      let target = record.pkg.exports?.[sub ? "./" + sub.slice(1) : "."];
      if (typeof target === "object")
        target = target.browser ?? target.import ?? target.default;
      if (typeof target !== "string")
        target = sub
          ? "lib" + sub + ".js"
          : (record.pkg.main ?? "lib/index.js");
      target = target
        .replace(/^\.\//, "")
        .replace(/^lib\//, "src/")
        .replace(/\.js$/, ".ts");
      if (!existsSync(resolve(record.dir, target)))
        target = target.replace(/^src\/types\//, "src/");
      if (!existsSync(resolve(record.dir, target)))
        target = target.replace(/\.(?:browser|node)\.ts$/, "/index.ts");
      if (
        !existsSync(resolve(record.dir, target)) &&
        existsSync(resolve(record.dir, target.replace(/\.ts$/, ".tsx")))
      )
        target = target.replace(/\.ts$/, ".tsx");
      return { path: resolve(record.dir, target) };
    });
  },
};
if (process.argv.includes("--engine-test")) {
  await mkdir(join(root, ".test-build"), { recursive: true });
  await build({
    entryPoints: [
      join(root, "src/trajectory-engine.ts"),
      join(root, "src/owned-stream.ts"),
      join(root, "src/rpc-adapter.ts"),
      join(root, "src/model-contract.ts"),
      join(root, "src/model-settings.tsx"),
      join(root, "src/agent-presets.tsx"),
      join(root, "src/automation.tsx"),
      join(root, "src/bridge.ts"),
      join(root, "src/plugin-settings.tsx"),
      join(root, "src/settings-keys.ts"),
      join(root, "src/menu-anchor-geometry.ts"),
      join(root, "src/menu-anchor-runtime.ts"),
      join(root, "src/menu-anchor-fallback.ts"),
    ],
    outdir: join(root, ".test-build"),
    outExtension: { ".js": ".mjs" },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    nodePaths: [join(root, "node_modules")],
    plugins: [plugin],
    jsx: "automatic",
    external: ["react", "react/*", "react-dom", "react-dom/*"],
    loader: {
      ".woff2": "dataurl",
      ".woff": "dataurl",
      ".ttf": "dataurl",
      ".svg": "dataurl",
      ".png": "dataurl",
    },
  });
  process.exit(0);
}
const output = join(
  root,
  process.argv.includes("--out-layout-next")
    ? "dist-layout-next"
    : process.argv.includes("--out-settings-fix")
      ? "dist-settings-fix"
      : process.argv.includes("--out-perf-next")
        ? "dist-perf-next"
        : process.argv.includes("--out-next")
          ? "dist-next"
          : "dist",
);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const result = await build({
  entryPoints: {
    app: join(root, "src/main.tsx"),
    "routes/models": join(root, "src/models.tsx"),
    "routes/plugins": join(root, "src/plugins.tsx"),
    "routes/trajectory": join(root, "src/trajectory.tsx"),
    "routes/terminal": join(root, "src/terminal.tsx"),
    "routes/agent-presets": join(root, "src/agent-presets.tsx"),
    "routes/model-settings": join(root, "src/model-settings.tsx"),
    "routes/automation": join(root, "src/automation.tsx"),
    "routes/plugin-settings": join(root, "src/plugin-settings.tsx"),
  },
  outdir: output,
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  assetNames: "assets/[name]-[hash]",
  bundle: true,
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  format: "esm",
  platform: "browser",
  target: "safari17.4",
  jsx: "automatic",
  nodePaths: [join(root, "node_modules")],
  plugins: [plugin],
  loader: {
    ".woff2": "file",
    ".woff": "file",
    ".ttf": "file",
    ".svg": "file",
    ".png": "file",
  },
  metafile: true,
  legalComments: "eof",
});
const outputs = result.metafile.outputs;
const appOutput = Object.keys(outputs).find((key) => key.endsWith("/app.js"));
if (!appOutput) throw Error("Initial page entry was not emitted");
const outputBase = appOutput.slice(0, -6);
function staticClosure(key, seen = new Set()) {
  if (seen.has(key)) return seen;
  seen.add(key);
  for (const entry of outputs[key]?.imports ?? [])
    if (!entry.external && entry.kind !== "dynamic-import")
      staticClosure(entry.path, seen);
  return seen;
}
const budgets = Object.keys(result.metafile.outputs)
  .filter(
    (key) =>
      key.endsWith(".js") &&
      (key === appOutput || key.startsWith(outputBase + "routes/")),
  )
  .map((key) => {
    const entries = new Set([
      ...staticClosure(outputBase + "app.js"),
      ...staticClosure(key),
    ]);
    return {
      entry: key.slice(outputBase.length),
      initialJavaScriptBytes: [...entries].reduce(
        (total, name) => total + outputs[name].bytes,
        0,
      ),
      initialJavaScriptFiles: [...entries].map((name) =>
        name.slice(outputBase.length),
      ),
      cssBytes: outputs[key.replace(/\.js$/, ".css")]?.bytes ?? 0,
      cssInputs: [
        ...new Set(
          [outputBase + "app.css", key.replace(/\.js$/, ".css")].flatMap(
            (name) => Object.keys(outputs[name]?.inputs ?? {}),
          ),
        ),
      ],
      inputs: [
        ...new Set(
          [...entries].flatMap((name) => Object.keys(outputs[name].inputs)),
        ),
      ],
    };
  });
await writeFile(
  join(output, "route-budgets.json"),
  JSON.stringify(
    {
      baseline: { javaScriptBytes: 5186481, cssBytes: 225393 },
      scope:
        "Static initial JS closure including app; lazy imports such as original xterm/language loading excluded until requested. Build bytes, not runtime memory.",
      routes: budgets,
    },
    null,
    2,
  ) + "\n",
);
await cp(join(root, "index.html"), join(output, "index.html"));
await cp(join(source, "LICENSE"), join(output, "DSH-LICENSE"));
await cp(join(root, "page-contracts.mjs"), join(output, "page-contracts.mjs"));
await writeFile(
  join(output, "source-manifest.json"),
  JSON.stringify(
    {
      dshCommit: "39163dd30f703a79079e2d2446545cff3c453738",
      platformBaseline: {
        macOS: "15.8+",
        javascriptTarget: "safari17.4",
        runtimeAcceptance: "macOS15.8 WK remains unverified",
      },
      entryComponents: [
        "ui-plugin-manager/PluginManagerPage",
        "ui-model-selection/ModelSelect",
        "ui-settings-shell/ShellCard + controller",
        "ui-settings-subagent/SubagentCard + controllers",
        "ui-settings-agent-loop/AgentLoopCard + controller",
        "ui-settings-web-search/WebSearchCard + controller",
        "ui-trajectory/TrajectoryView + original assembler/definitions/snapshot/timeline/table",
        "ui-sidebar-terminal/LazyTerminalBody + original TerminalView/Inventory/WindowHold/RemoteStream",
        "ui-agent-preset/AgentPresetSection + original section controller",
        "ui-settings-models/ModelsSection + original store/schema/operations and SettingsDescribeMirror",
        "ui-schedule/TaskManagerPage + original catalog/editor/history/deletion machinery",
        "ui-settings-plugins/PluginsSettingsSection + ui-settings-plugin-inventory/PluginInventorySettingsTab",
      ],
      transforms: [
        "TaskManagerPage keeps original controls and disables manual creation at the known frozen carrier mismatch; native draft navigation is capability-gated",
        "SettingsSchemaService retains original schema/path method bodies with only its Cordis registration inheritance removed for standalone instantiation",
        "Named ui-primitives imports resolve directly to their original exported leaves, avoiding side effects from unrelated barrel exports",
        "PluginManagerPage viewport inset accepts native outer-window token (fallback unchanged)",
        "TaskManagerPage viewport inset accepts the same outer-window token; settings sections use original modal options padding instead",
        "ModelSelect embedded presentation: initial open, no trigger, native close after original settlement; original panes and keyboard logic retained",
      ],
      inputs: Object.keys(result.metafile.inputs),
      outputs: result.metafile.outputs,
    },
    null,
    2,
  ) + "\n",
);
