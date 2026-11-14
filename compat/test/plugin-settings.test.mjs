import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import Renderer, { act } from "react-test-renderer";
import PluginSettingsPage, {
  createPluginSettings,
} from "../.test-build/plugin-settings.mjs";

test("settings plugins uses the original read-only section and inventory, never package management", async () => {
  let calls = 0;
  const snapshot = { entries: [], agentPresets: [] };
  const ctx = {
    hostId: "fixture-host",
    sessionId: "fixture-session",
    connectionGeneration: 2,
    ownerId: "fixture-owner",
    placement: "settingsContent",
    operations: { pluginInventory: true },
  };
  globalThis.window = {
    mygo: {
      call: async (method, operation) => {
        assert.equal(method, "CompatAPI.Request");
        assert.equal(operation, "pluginInventory");
        calls++;
        return snapshot;
      },
    },
  };
  let view;
  await act(async () => {
    view = Renderer.create(React.createElement(PluginSettingsPage, { ctx }));
  });
  const tree = JSON.stringify(view.toJSON());
  assert.match(tree, /内置插件/);
  assert.equal(/安装插件包|已安装|发现插件/.test(tree), false);
  assert.equal(calls, 1);
  await act(async () => view.unmount());
  delete globalThis.window;
  const face = createPluginSettings(ctx, async () => {
    calls++;
    return snapshot;
  });
  face.dispose();
  await assert.rejects(face.list(), /页面已关闭/);
  assert.equal(calls, 1);
});
