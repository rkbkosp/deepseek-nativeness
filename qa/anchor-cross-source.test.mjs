import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { bindMenuPlacement } from "../compat/.test-build/menu-anchor-runtime.mjs";
import {
  useTaskMenuAnchor,
  useSchedulePickerAnchor,
  useModelPickerAnchor,
  useRegistryPickerAnchor,
} from "../compat/.test-build/menu-anchor-fallback.mjs";
const require = createRequire(
  new URL("../compat/package.json", import.meta.url),
);
const React = require("react"),
  Renderer = require("react-test-renderer");
const { act } = Renderer;
const rect = (left, top, width, height) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});
class Target extends EventTarget {
  listeners = new Map();
  addEventListener(t, fn, o) {
    super.addEventListener(t, fn, o);
    const list = this.listeners.get(t) ?? new Set();
    list.add(fn);
    this.listeners.set(t, list);
  }
  removeEventListener(t, fn, o) {
    super.removeEventListener(
      t,
      fn,
      typeof o === "boolean" ? { capture: o } : o,
    );
    this.listeners.get(t)?.delete(fn);
  }
  count() {
    return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
  }
}
class Style {
  values = new Map();
  getPropertyValue(k) {
    return this.values.get(k)?.[0] ?? "";
  }
  getPropertyPriority(k) {
    return this.values.get(k)?.[1] ?? "";
  }
  setProperty(k, v, p = "") {
    this.values.set(k, [v, p]);
  }
  removeProperty(k) {
    this.values.delete(k);
  }
}
function world() {
  const win = new Target(),
    doc = new Target(),
    frames = new Map(),
    resize = new Set(),
    mutation = new Set(),
    elements = [];
  let serial = 0;
  doc.defaultView = win;
  doc.documentElement = {
    clientWidth: 500,
    clientHeight: 400,
    dataset: { platform: "darwin" },
  };
  win.visualViewport = new Target();
  win.innerWidth = 500;
  win.innerHeight = 400;
  win.requestAnimationFrame = (fn) => {
    frames.set(++serial, fn);
    return serial;
  };
  win.cancelAnimationFrame = (id) => frames.delete(id);
  win.ResizeObserver = class {
    constructor(fn) {
      this.fn = fn;
      resize.add(this);
    }
    observe() {}
    disconnect() {
      resize.delete(this);
    }
  };
  win.MutationObserver = class {
    constructor(fn) {
      this.fn = fn;
      mutation.add(this);
    }
    observe() {}
    disconnect() {
      mutation.delete(this);
    }
  };
  win.getComputedStyle = () => ({
    maxWidth: "360px",
    maxHeight: "none",
    getPropertyValue: () => "48px",
  });
  class Element extends Target {
    style = new Style();
    attributes = new Map();
    isConnected = true;
    parentElement = null;
    constructor(r) {
      super();
      this.r = r;
      this.ownerDocument = doc;
      elements.push(this);
    }
    hasAttribute(k) {
      return this.attributes.has(k);
    }
    getAttribute(k) {
      return this.attributes.get(k) ?? null;
    }
    setAttribute(k, v) {
      this.attributes.set(k, v);
    }
    removeAttribute(k) {
      this.attributes.delete(k);
    }
    getBoundingClientRect() {
      if (!this.hasAttribute("data-native-anchor-fallback")) return this.r;
      const value = (k) =>
        Number.parseFloat(this.style.getPropertyValue(k)) || 0;
      return rect(
        value("--native-menu-x"),
        value("--native-menu-y"),
        Math.min(this.r.width, value("--native-menu-max-w") || this.r.width),
        Math.min(this.r.height, value("--native-menu-max-h") || this.r.height),
      );
    }
  }
  doc.body = new Element(rect(0, 0, 500, 400));
  const stats = () => ({
    listeners:
      doc.count() +
      win.count() +
      win.visualViewport.count() +
      elements.reduce((sum, e) => sum + e.count(), 0),
    frames: frames.size,
    resize: resize.size,
    mutation: mutation.size,
  });
  const flush = () => {
    for (let i = 0; frames.size; i++) {
      assert.ok(i < 5, "unbounded RAF placement loop");
      const queued = [...frames.values()];
      frames.clear();
      for (const fn of queued) fn();
    }
  };
  return { win, doc, frames, resize, mutation, Element, stats, flush };
}
const profiles = {
  task: (p, a, open) => useTaskMenuAnchor(p, a, open, true, "end"),
  picker: (p, a, open) => useSchedulePickerAnchor(p, a, open),
  model: (p, a, open) => useModelPickerAnchor(p, a, open, false),
  registry: (p, a, open) => useRegistryPickerAnchor(p, a, open),
};
function withGlobals(w, fn) {
  const css = globalThis.CSS,
    doc = globalThis.document;
  globalThis.CSS = { supports: () => false };
  globalThis.document = w.doc;
  try {
    return fn();
  } finally {
    if (css === undefined) delete globalThis.CSS;
    else globalThis.CSS = css;
    if (doc === undefined) delete globalThis.document;
    else globalThis.document = doc;
  }
}
test("independent four-profile lifetime stress restores node listeners, queued RAFs, style priority and attributes", () => {
  for (const [name, hook] of Object.entries(profiles)) {
    const w = world();
    withGlobals(w, () => {
      for (let i = 0; i < 20; i++) {
        const anchor = new w.Element(rect(220, 200, 80, 24)),
          panel = new w.Element(rect(0, 0, 140, 70));
        panel.style.setProperty("--native-menu-x", "7px", "important");
        panel.setAttribute("data-native-submenu-fallback", "prior");
        function Harness({ open = true }) {
          const p = React.useRef(null),
            a = React.useRef(null);
          hook(p, a, open);
          return React.createElement(
            React.Fragment,
            null,
            React.createElement("span", { id: "a", ref: a }),
            React.createElement("div", { id: "p", ref: p }),
          );
        }
        let view;
        act(() => {
          view = Renderer.create(React.createElement(Harness), {
            createNodeMock: (el) => (el.props.id === "a" ? anchor : panel),
          });
        });
        assert.ok(w.resize.size > 0, name);
        w.doc.dispatchEvent(new Event("scroll"));
        const queued = [...w.frames.values()],
          retired = [...w.resize, ...w.mutation];
        assert.equal(w.frames.size, 1);
        act(() => view.unmount());
        for (const fn of queued) fn();
        for (const observer of retired) observer.fn();
        w.flush();
        assert.deepEqual(
          w.stats(),
          { listeners: 0, frames: 0, resize: 0, mutation: 0 },
          name + " lifetime " + i,
        );
        assert.equal(panel.style.getPropertyValue("--native-menu-x"), "7px");
        assert.equal(
          panel.style.getPropertyPriority("--native-menu-x"),
          "important",
        );
        assert.equal(panel.hasAttribute("data-native-anchor-fallback"), false);
        assert.equal(
          panel.getAttribute("data-native-submenu-fallback"),
          "prior",
        );
      }
    });
  }
});
test("independent runtime scroll/resize updates have one scheduled frame and remain fenced after disposal", () => {
  const w = world(),
    a = new w.Element(rect(100, 100, 90, 24)),
    m = new w.Element(rect(0, 0, 140, 70));
  const off = bindMenuPlacement(m, a, () => ({
    side: "bottom",
    gap: 6,
    minTop: 12,
  }));
  a.r = rect(250, 180, 90, 24);
  for (let i = 0; i < 20; i++) {
    w.doc.dispatchEvent(new Event("scroll"));
    w.win.dispatchEvent(new Event("resize"));
    w.win.visualViewport.dispatchEvent(new Event("scroll"));
  }
  assert.equal(w.frames.size, 1);
  w.flush();
  assert.equal(m.getBoundingClientRect().top, 210);
  const rectBefore = m.getBoundingClientRect();
  off();
  w.doc.dispatchEvent(new Event("scroll"));
  assert.deepEqual(w.stats(), {
    listeners: 0,
    frames: 0,
    resize: 0,
    mutation: 0,
  });
  assert.ok(rectBefore.left >= 12);
});
test("KNOWN_GAP active anchor moved by a same-size React reflow must follow without a resize or scroll event", async (t) => {
  for (const [name, hook] of Object.entries(profiles)) {
    await t.test(name, () => {
      const w = world();
      withGlobals(w, () => {
        const anchor = new w.Element(rect(100, 180, 80, 24)),
          panel = new w.Element(rect(0, 0, 140, 70));
        function Harness({ revision }) {
          const p = React.useRef(null),
            a = React.useRef(null);
          hook(p, a, true);
          return React.createElement(
            React.Fragment,
            null,
            React.createElement("span", {
              id: "a",
              ref: a,
              "data-revision": revision,
            }),
            React.createElement("div", { id: "p", ref: p }),
          );
        }
        let view;
        act(() => {
          view = Renderer.create(
            React.createElement(Harness, { revision: 0 }),
            { createNodeMock: (el) => (el.props.id === "a" ? anchor : panel) },
          );
        });
        const before = panel.getBoundingClientRect();
        anchor.r = rect(220, 180, 80, 24);
        act(() => view.update(React.createElement(Harness, { revision: 1 })));
        w.flush();
        const after = panel.getBoundingClientRect();
        act(() => view.unmount());
        assert.equal(
          after.left - before.left,
          120,
          name +
            " remains at its old viewport position when only anchor position changes",
        );
      });
    });
  }
});
