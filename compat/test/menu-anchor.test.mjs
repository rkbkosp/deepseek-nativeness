import test from "node:test";
import assert from "node:assert/strict";
import {
  menuPlacement,
  supportsMenuAnchors,
} from "../.test-build/menu-anchor-geometry.mjs";
import { bindMenuPlacement } from "../.test-build/menu-anchor-runtime.mjs";
const rect = (x, y, w, h) => ({
  left: x,
  top: y,
  right: x + w,
  bottom: y + h,
  width: w,
  height: h,
});
test("all four CSS anchor capabilities are required; supported WebKit keeps the original path", () => {
  const names = ["position-anchor", "top", "width", "position-try-fallbacks"];
  assert.equal(supportsMenuAnchors({ supports: () => true }), true);
  for (const missing of names)
    assert.equal(
      supportsMenuAnchors({ supports: (key) => key !== missing }),
      false,
      missing,
    );
  assert.equal(supportsMenuAnchors(undefined), false);
});
test("below/top/end/right/point placements flip and reserve original viewport edges", () => {
  assert.deepEqual(
    menuPlacement(rect(30, 40, 80, 20), 150, 100, { width: 500, height: 400 }),
    { left: 30, top: 64, maxWidth: 476, maxHeight: 376 },
  );
  assert.equal(
    menuPlacement(rect(300, 350, 80, 20), 150, 100, { width: 500, height: 400 })
      .top,
    246,
  );
  assert.equal(
    menuPlacement(
      rect(300, 10, 80, 20),
      150,
      100,
      { width: 500, height: 400 },
      { side: "top" },
    ).top,
    34,
  );
  assert.equal(
    menuPlacement(
      rect(200, 40, 80, 20),
      150,
      100,
      { width: 500, height: 400 },
      { align: "end" },
    ).left,
    130,
  );
  assert.equal(
    menuPlacement(
      rect(400, 40, 80, 20),
      150,
      100,
      { width: 500, height: 400 },
      { side: "right" },
    ).left,
    246,
  );
  const point = menuPlacement(
    rect(499, 399, 0, 0),
    150,
    100,
    { width: 500, height: 400 },
    { minTop: 48 },
  );
  assert.equal(point.left, 338);
  assert.equal(point.top, 288);
  const tall = menuPlacement(
    rect(40, 40, 50, 20),
    300,
    1000,
    { width: 360, height: 300 },
    { minTop: 48 },
  );
  assert.equal(tall.top, 48);
  assert.equal(tall.maxHeight, 240);
});
class Target extends EventTarget {
  listeners = new Map();
  addEventListener(type, cb, options) {
    super.addEventListener(type, cb, options);
    const s = this.listeners.get(type) || new Set();
    s.add(cb);
    this.listeners.set(type, s);
  }
  removeEventListener(type, cb, options) {
    super.removeEventListener(
      type,
      cb,
      typeof options === "boolean" ? { capture: options } : options,
    );
    this.listeners.get(type)?.delete(cb);
  }
  get count() {
    return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
  }
}
class Style {
  map = new Map();
  getPropertyValue(k) {
    return this.map.get(k)?.[0] || "";
  }
  getPropertyPriority(k) {
    return this.map.get(k)?.[1] || "";
  }
  setProperty(k, v, p = "") {
    this.map.set(k, [v, p]);
  }
  removeProperty(k) {
    this.map.delete(k);
  }
}
function world() {
  const frames = new Map(),
    resizes = new Set(),
    mutations = new Set();
  let next = 1;
  const win = new Target(),
    doc = new Target();
  doc.defaultView = win;
  doc.documentElement = { clientWidth: 500, clientHeight: 400 };
  win.visualViewport = new Target();
  win.requestAnimationFrame = (cb) => {
    const id = next++;
    frames.set(id, cb);
    return id;
  };
  win.cancelAnimationFrame = (id) => frames.delete(id);
  win.ResizeObserver = class {
    targets = new Set();
    constructor(cb) {
      this.cb = cb;
      resizes.add(this);
    }
    observe(n) {
      this.targets.add(n);
    }
    disconnect() {
      resizes.delete(this);
    }
  };
  win.MutationObserver = class {
    constructor(cb) {
      this.cb = cb;
      mutations.add(this);
    }
    observe() {}
    disconnect() {
      mutations.delete(this);
    }
  };
  win.getComputedStyle = (el) => ({
    maxWidth:
      el.getAttribute("data-submenu-layout") === "page"
        ? `${doc.documentElement.clientWidth - 24}px`
        : `${Math.min(360, doc.documentElement.clientWidth - 24)}px`,
    maxHeight: "none",
    getPropertyValue: () => "48px",
  });
  class Element extends Target {
    attrs = new Map();
    style = new Style();
    isConnected = true;
    parentElement = null;
    constructor(r) {
      super();
      this.r = r;
      this.ownerDocument = doc;
    }
    getAttribute(k) {
      return this.attrs.get(k) ?? null;
    }
    hasAttribute(k) {
      return this.attrs.has(k);
    }
    setAttribute(k, v) {
      this.attrs.set(k, v);
    }
    removeAttribute(k) {
      this.attrs.delete(k);
    }
    getBoundingClientRect() {
      if (!this.hasAttribute("data-native-anchor-fallback")) return this.r;
      const n = (k) => Number.parseFloat(this.style.getPropertyValue(k));
      let w = this.r.width,
        h = this.r.height;
      if (this.getAttribute("data-native-anchor-fallback") === "backing") {
        w = n("--native-menu-w");
        h = n("--native-menu-h");
      } else {
        if (
          this.hasAttribute("data-match-anchor-width") ||
          this.getAttribute("data-submenu-layout") === "page"
        )
          w = Math.max(w, n("--native-menu-min-w"));
        w = Math.min(w, n("--native-menu-max-w"));
        h = Math.min(h, n("--native-menu-max-h"));
      }
      return rect(n("--native-menu-x") || 0, n("--native-menu-y") || 0, w, h);
    }
  }
  const flush = () => {
    let safety = 0;
    while (frames.size) {
      if (++safety > 10) throw Error("placement loop");
      const entries = [...frames];
      frames.clear();
      for (const [, cb] of entries) cb();
    }
  };
  return {
    win,
    doc,
    Element,
    frames,
    resizes,
    mutations,
    flush,
    stats: () => ({
      listeners: win.count + doc.count + win.visualViewport.count,
      frames: frames.size,
      resize: resizes.size,
      mutation: mutations.size,
    }),
  };
}
test("mounted external menu tracks trigger/scroll/resize, match-width, then restores styles and observers", () => {
  const w = world(),
    a = new w.Element(rect(50, 70, 220, 24)),
    m = new w.Element(rect(0, 0, 150, 100));
  m.setAttribute("data-match-anchor-width", "");
  m.style.setProperty("--native-menu-x", "7px", "important");
  const off = bindMenuPlacement(m, a, () => ({
    side: "bottom",
    matchWidth: true,
  }));
  let r = m.getBoundingClientRect();
  assert.equal(r.left, 50);
  assert.equal(r.top, 98);
  assert.equal(r.width, 220);
  a.r = rect(250, 200, 220, 24);
  w.doc.dispatchEvent(new Event("scroll"));
  w.win.dispatchEvent(new Event("resize"));
  assert.equal(w.frames.size, 1);
  w.flush();
  r = m.getBoundingClientRect();
  assert.equal(r.left, 250);
  assert.equal(r.top, 224 + 4);
  w.doc.documentElement.clientWidth = 200;
  w.win.dispatchEvent(new Event("resize"));
  w.flush();
  assert.equal(m.getBoundingClientRect().width, 176);
  w.doc.documentElement.clientWidth = 500;
  w.win.dispatchEvent(new Event("resize"));
  w.flush();
  assert.equal(
    m.getBoundingClientRect().width,
    220,
    "narrow-window cap must not stick",
  );
  off();
  off();
  assert.equal(m.style.getPropertyValue("--native-menu-x"), "7px");
  assert.equal(m.style.getPropertyPriority("--native-menu-x"), "important");
  assert.equal(m.hasAttribute("data-native-anchor-fallback"), false);
  assert.deepEqual(w.stats(), {
    listeners: 0,
    frames: 0,
    resize: 0,
    mutation: 0,
  });
});
test("point remains captured; nested side/page follows parent and backing matches its own card", () => {
  const w = world(),
    a = new w.Element(rect(0, 0, 0, 0)),
    parent = new w.Element(rect(0, 0, 190, 160)),
    child = new w.Element(rect(0, 0, 180, 90)),
    backing = new w.Element(rect(0, 0, 0, 0));
  const off = bindMenuPlacement(parent, a, () => ({
    point: { x: 300, y: 90 },
  }));
  let page = false;
  const off2 = bindMenuPlacement(child, parent, () => ({
    side: "submenu",
    page,
    rowOffset: 35,
  }));
  const off3 = bindMenuPlacement(backing, child, () => ({ kind: "backing" }));
  assert.equal(
    child.getBoundingClientRect().left,
    parent.getBoundingClientRect().left - 184,
    "side card flips left at viewport edge",
  );
  assert.deepEqual(
    backing.getBoundingClientRect(),
    child.getBoundingClientRect(),
  );
  page = true;
  child.setAttribute("data-submenu-layout", "page");
  w.win.dispatchEvent(new Event("resize"));
  w.flush();
  assert.equal(
    child.getBoundingClientRect().left,
    parent.getBoundingClientRect().left,
  );
  assert.equal(
    child.getBoundingClientRect().width,
    parent.getBoundingClientRect().width,
  );
  assert.deepEqual(
    backing.getBoundingClientRect(),
    child.getBoundingClientRect(),
  );
  a.r = rect(70, 70, 0, 0);
  w.doc.dispatchEvent(new Event("scroll"));
  w.flush();
  assert.equal(
    parent.getBoundingClientRect().left,
    298,
    "captured point is clamped but does not follow an unrelated trigger",
  );
  off3();
  off2();
  off();
  assert.deepEqual(w.stats(), {
    listeners: 0,
    frames: 0,
    resize: 0,
    mutation: 0,
  });
});
test("20 opens/closes leave no listeners, observed targets or pending frame; detached callbacks stay inert", () => {
  const w = world(),
    a = new w.Element(rect(20, 50, 80, 20)),
    m = new w.Element(rect(0, 0, 170, 200));
  for (let i = 0; i < 20; i++) {
    const off = bindMenuPlacement(m, a, () => ({}));
    w.win.dispatchEvent(new Event("resize"));
    assert.equal(w.frames.size, 1);
    off();
    w.flush();
  }
  assert.deepEqual(w.stats(), {
    listeners: 0,
    frames: 0,
    resize: 0,
    mutation: 0,
  });
});

import React, { useRef } from "react";
import TestRenderer, { act } from "react-test-renderer";
import {
  useNativeMenuAnchor,
  useNativeSubmenuAnchor,
  useNativeMenuSurfaceRef,
  useNativeMenuBacking,
} from "../.test-build/menu-anchor-fallback.mjs";
test("React lifecycle gates supported CSS, preserves forwarded refs, and disposes main/submenu/backing together", () => {
  const oldCSS = globalThis.CSS,
    oldDocument = globalThis.document;
  try {
    for (const supported of [true, false]) {
      const w = world();
      w.doc.documentElement.dataset = { platform: "darwin" };
      w.doc.body = new w.Element(rect(0, 0, 500, 400));
      globalThis.document = w.doc;
      globalThis.CSS = { supports: () => supported };
      const trigger = new w.Element(rect(30, 70, 120, 24)),
        menu = new w.Element(rect(0, 0, 180, 160)),
        sub = new w.Element(rect(0, 0, 170, 100)),
        backing = new w.Element(rect(0, 0, 0, 0));
      let captured;
      const forward = (element) => {
        captured = element;
      };
      function Harness({ active, portal = true }) {
        const anchor = useRef(null),
          child = useRef(null),
          back = useRef(null);
        const [surface, capture] = useNativeMenuSurfaceRef(forward);
        useNativeMenuAnchor(surface, anchor, {
          active,
          portal,
          side: "bottom",
          align: "start",
        });
        useNativeSubmenuAnchor(child, surface, {
          active,
          page: false,
          trigger,
        });
        useNativeMenuBacking(surface, back);
        return React.createElement(
          React.Fragment,
          null,
          React.createElement("span", { id: "trigger", ref: anchor }),
          React.createElement("div", { id: "menu", ref: capture }),
          active && React.createElement("div", { id: "sub", ref: child }),
          React.createElement("div", { id: "backing", ref: back }),
        );
      }
      let renderer;
      act(() => {
        renderer = TestRenderer.create(
          React.createElement(Harness, { active: true }),
          {
            createNodeMock: (el) =>
              ({ trigger, menu, sub, backing })[el.props.id],
          },
        );
      });
      assert.equal(captured, menu);
      assert.equal(w.resizes.size, supported ? 0 : 3);
      assert.equal(
        menu.hasAttribute("data-native-anchor-fallback"),
        !supported,
      );
      assert.equal(
        backing.hasAttribute("data-native-anchor-fallback"),
        !supported,
      );
      act(() =>
        renderer.update(React.createElement(Harness, { active: false })),
      );
      assert.equal(
        w.resizes.size,
        supported ? 0 : 1,
        "main and child observers end when closed; the mounted surface backing remains",
      );
      act(() => renderer.unmount());
      assert.equal(captured, null);
      assert.deepEqual(w.stats(), {
        listeners: 0,
        frames: 0,
        resize: 0,
        mutation: 0,
      });
    }
  } finally {
    if (oldCSS === undefined) delete globalThis.CSS;
    else globalThis.CSS = oldCSS;
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  }
});

test("QA compile define forces the same fallback gate even when all native features report support", async () => {
  const { build } = await import("esbuild");
  const result = await build({
    entryPoints: [
      new URL("../src/menu-anchor-geometry.ts", import.meta.url).pathname,
    ],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    define: { NATIVE_DSH_FORCE_MENU_ANCHOR_FALLBACK: "true" },
  });
  const forced = await import(
    "data:text/javascript;base64," +
      Buffer.from(result.outputFiles[0].text).toString("base64")
  );
  assert.equal(
    supportsMenuAnchors({ supports: () => true }),
    true,
    "normal test build remains feature-detected",
  );
  assert.equal(
    forced.supportsMenuAnchors({ supports: () => true }),
    false,
    "only the compile-time QA artifact bypasses detection",
  );
});
