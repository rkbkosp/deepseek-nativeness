import test from "node:test";
import assert from "node:assert/strict";
import { installSettingsKeys } from "../.test-build/settings-keys.mjs";

class Target extends EventTarget {
  listeners = new Map();
  addEventListener(type, callback, options) {
    super.addEventListener(
      type,
      callback,
      typeof options === "boolean" ? { capture: options } : options,
    );
    const set = this.listeners.get(type) ?? new Set();
    set.add(callback);
    this.listeners.set(type, set);
  }
  removeEventListener(type, callback, options) {
    super.removeEventListener(
      type,
      callback,
      typeof options === "boolean" ? { capture: options } : options,
    );
    this.listeners.get(type)?.delete(callback);
  }
  get count() {
    return [...this.listeners.values()].reduce((n, set) => n + set.size, 0);
  }
}
const key = (props = {}) =>
  Object.assign(new Event("keydown", { cancelable: true }), {
    key: "Escape",
    isComposing: false,
    keyCode: 0,
    ...props,
  });
test("settings Escape follows original composition/modifier and inner-modal ownership", () => {
  const document = new Target();
  document.defaultView = new Target();
  document.innerModal = false;
  document.querySelector = () => (document.innerModal ? {} : null);
  let closes = 0;
  const off = installSettingsKeys(document, () => closes++);
  const consumed = key();
  consumed.preventDefault();
  document.dispatchEvent(consumed);
  assert.equal(closes, 0);
  document.innerModal = true;
  document.dispatchEvent(key());
  assert.equal(closes, 0);
  document.innerModal = false;
  document.dispatchEvent(new Event("compositionstart"));
  document.dispatchEvent(key());
  assert.equal(closes, 0);
  document.dispatchEvent(new Event("compositionend"));
  document.dispatchEvent(key());
  assert.equal(closes, 0);
  document.dispatchEvent(key({ metaKey: true }));
  document.dispatchEvent(key({ repeat: true }));
  assert.equal(closes, 0);
  document.dispatchEvent(key());
  assert.equal(closes, 1);
  off();
  assert.equal(document.count + document.defaultView.count, 0);
  for (let i = 0; i < 20; i++) installSettingsKeys(document, () => closes++)();
  assert.equal(document.count + document.defaultView.count, 0);
});
