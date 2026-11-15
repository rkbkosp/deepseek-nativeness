import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { PAGE_CONTRACTS } from "../page-contracts.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const exists = async (path) => {
  try {
    return (await stat(new URL(path, root))).isFile();
  } catch {
    return false;
  }
};

/**
 * Every route `route-loader.ts` can mount, its module, and the export the
 * loader reads. The loader is the single place a page is named, so parsing it is
 * the only way to see a route that was declared but never packaged.
 */
function declaredRoutes(loader) {
  const routes = {};
  for (const match of loader.matchAll(
    /^\s{2}"?([a-z-]+)"?:\s*\{\s*file:\s*"([a-z-]+)",\s*exportName:\s*"([a-zA-Z]+)",\s*load:\s*\(\)\s*=>\s*import\("\.\/routes\/([a-z-]+)\.js"\)/gm,
  )) {
    routes[match[1]] = {
      file: match[2],
      exportName: match[3],
      importFile: match[4],
    };
  }
  return routes;
}

const loader = await read("src/route-loader.ts");
const routes = declaredRoutes(loader);
const build = await read("build.mjs");
const main = await read("src/main.tsx");

test("every declared route resolves to a packaged module and export", async () => {
  assert.ok(Object.keys(routes).length >= 9, "route loader shape changed");
  for (const [page, route] of Object.entries(routes)) {
    assert.equal(
      route.importFile,
      route.file,
      `${page}: the loader imports a different file than it names`,
    );
    const source = await read(`src/${route.file}.tsx`);
    const exported =
      route.exportName === "default"
        ? /export\s+default\s+/.test(source)
        : new RegExp(
            `export\\s+(?:async\\s+)?(?:function|const|class)\\s+${route.exportName}\\b`,
          ).test(source);
    assert.ok(exported, `${page}: src/${route.file}.tsx lacks ${route.exportName}`);
    // A route the build does not emit 404s at runtime even though the loader
    // names it, so the packaging entry is part of the contract.
    assert.match(
      build,
      new RegExp(`"routes/${route.file}"\\s*:\\s*join\\(root,\\s*"src/${route.file}\\.tsx"\\)`),
      `${page}: no build entry for src/${route.file}.tsx`,
    );
    assert.ok(
      PAGE_CONTRACTS[page],
      `${page}: no reviewed RPC closure in page-contracts.mjs`,
    );
  }
});

test("every declared route has a page boundary and its multi-region cards keep theirs", async () => {
  assert.match(
    main,
    /<CompatBoundary scope="page" label=\{page\}>/,
    "main.tsx must keep the page boundary",
  );
  // A page that renders independently failing cards keeps a boundary around
  // each region; the rest render one original component inside the page
  // boundary above.
  for (const page of ["plugins", "plugin-settings"]) {
    const source = await read(`src/${page}.tsx`);
    assert.ok(
      /<CompatBoundary scope="card"/.test(source),
      `${page}: independent card regions need a card boundary`,
    );
  }
});

test("each route module evaluates in the engine build where it is testable", async () => {
  const checked = [];
  for (const [page, route] of Object.entries(routes)) {
    const modulePath = `.test-build/${route.file}.mjs`;
    if (!(await exists(modulePath))) continue;
    const module = await import(new URL(modulePath, root));
    assert.equal(
      typeof module[route.exportName],
      "function",
      `${page}: ${modulePath} does not export a component`,
    );
    checked.push(page);
  }
  // plugin-settings and plugins are the entries the test build always carries;
  // the rest are verified by the production build and the route catalogue.
  assert.ok(checked.includes("plugin-settings"), "engine build lost plugin-settings");
});
