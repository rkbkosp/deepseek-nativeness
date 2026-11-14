import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import Renderer, { act } from "react-test-renderer";

test("the original ModelSelect receives the slot fallback for its current model", async () => {
  globalThis.location = { search: "?page=models" };
  const { ModelSelect, createModelSlot, zh } = await import(
    "../.test-build/model-contract.mjs"
  );
  const state = {
    current: { provider: "fixture-provider", model: "fixture-model" },
    routable: true,
    groups: [
      {
        id: "fixture-provider",
        name: "Fixture Provider",
        models: [{ id: "fixture-model", name: "Fixture Current Model" }],
      },
    ],
    failures: [],
    status: "ready",
    pending: null,
    error: null,
  };
  const directory = { getSnapshot: () => state, subscribe: () => () => {} };
  let view;
  await act(async () => {
    view = Renderer.create(
      React.createElement(ModelSelect, {
        locked: false,
        available: true,
        directory,
        load: () => {},
        select: async () => ({ ok: true }),
        resolveText: (value) => value,
        t: (key) => zh[key] ?? key,
        renderSlot: createModelSlot({ sessionId: "fixture-session" }, {}),
      }),
    );
  });
  assert.match(JSON.stringify(view.toJSON()), /Fixture Current Model/);
  await act(async () => view.unmount());
  delete globalThis.location;
});
