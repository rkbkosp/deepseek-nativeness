import test from "node:test";
import assert from "node:assert/strict";
import { RemoteAdapter } from "../client.mjs";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBzQAAAAASUVORK5CYII=";
const png2 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII=";
const limits = {
  maxImageBytes: 1000,
  maxImagesPerMessage: 2,
  maxMessageImageBytes: 2000,
  maxImagePixels: 10,
  maxImageDimension: 10,
  mediaTypes: ["image/png"],
};
function fixture(
  overrides = {},
  dispatch = async () => ({ ok: true, value: { accepted: true } }),
) {
  const adapter = new RemoteAdapter();
  const calls = [];
  adapter.hostId = "fixture-host";
  adapter.interactionReady = true;
  adapter.sessionRows = [{ id: "fixture-session" }];
  adapter.projection = {
    sessionId: "fixture-session",
    projections: {
      asOfSeq: 1,
      values: { imageLimits: { ...limits, ...overrides } },
    },
  };
  adapter.gateway = {
    dispatch: async (...args) => {
      calls.push(args);
      return dispatch(...args);
    },
  };
  return { adapter, calls };
}
const request = (extra = {}) => ({
  sessionId: "fixture-session",
  requestId: "fixture-image-request-0001",
  mode: "queue",
  content: [
    { type: "image", mediaType: "image/png", data: png, name: "fixture.png" },
  ],
  ...extra,
});
test("image-only prompts use the existing request envelope and stable receipt identity", async () => {
  const { adapter, calls } = fixture();
  const params = request();
  const first = await adapter.sendMessage(params);
  const second = await adapter.sendMessage(params);
  assert.equal(first.status, "accepted");
  assert.equal(first, second);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    "session/prompt",
    {
      args: {
        request: {
          sessionId: params.sessionId,
          requestId: params.requestId,
          mode: "queue",
          content: params.content,
        },
      },
    },
    adapter.lifetime.signal,
  ]);
});
test("all six Host image limits, source format and local framing are checked before dispatch", async () => {
  const cases = [
    [{ maxImageBytes: 1 }, request(), "IMAGE_TOO_LARGE"],
    [
      { maxImagesPerMessage: 1 },
      request({ content: Array(2).fill(request().content[0]) }),
      "TOO_MANY_IMAGES",
    ],
    [{ maxMessageImageBytes: 1 }, request(), "IMAGES_TOO_LARGE"],
    [{ maxImagePixels: 0 }, request(), "IMAGE_LIMITS_UNAVAILABLE"],
    [
      { maxImagePixels: 1 },
      request({ content: [{ ...request().content[0], data: png2 }] }),
      "IMAGE_PIXELS_TOO_LARGE",
    ],
    [
      { maxImageDimension: 1 },
      request({ content: [{ ...request().content[0], data: png2 }] }),
      "IMAGE_DIMENSION_TOO_LARGE",
    ],
    [{ maxImageDimension: undefined }, request(), "IMAGE_LIMITS_UNAVAILABLE"],
    [{ mediaTypes: [] }, request(), "UNSUPPORTED_MEDIA_TYPE"],
    [
      {},
      request({
        content: [{ ...request().content[0], mediaType: "image/jpeg" }],
      }),
      "UNSUPPORTED_MEDIA_TYPE",
    ],
    [
      { mediaTypes: ["image/jpeg", "image/png"] },
      request({
        content: [{ ...request().content[0], mediaType: "image/jpeg" }],
      }),
      "MEDIA_TYPE_MISMATCH",
    ],
    [
      {},
      request({ content: [{ ...request().content[0], data: "AQID" }] }),
      "INVALID_IMAGE",
    ],
    [
      {},
      request({
        content: [
          { ...request().content[0], data: "x".repeat(1024 * 1024 + 1) },
        ],
      }),
      "REQUEST_TOO_LARGE",
    ],
    [{}, request({ text: "conflict" }), "CONTENT_CONFLICT"],
    [
      {},
      request({
        content: [{ type: "file", receiptId: "not-a-workspace-path" }],
      }),
      "UNSUPPORTED_REMOTE_ATTACHMENT",
    ],
  ];
  for (const [overrides, params, code] of cases) {
    const { adapter, calls } = fixture(overrides);
    await assert.rejects(
      adapter.sendMessage(params),
      (error) => error.code === code && error.delivery === "rejected",
      code,
    );
    assert.equal(calls.length, 0, code);
  }
  const { adapter, calls } = fixture();
  adapter.projection.projections.values = {};
  await assert.rejects(adapter.sendMessage(request()), {
    code: "IMAGE_LIMITS_UNAVAILABLE",
  });
  assert.equal(calls.length, 0);
});
test("uncertain image delivery remains one unchanged request and is never blindly replayed", async () => {
  const { adapter, calls } = fixture({}, async () => {
    throw Error("fixture transport vanished");
  });
  const first = await adapter.sendMessage(request()),
    second = await adapter.sendMessage(request());
  assert.equal(first.status, "unknown");
  assert.equal(first, second);
  assert.equal(calls.length, 1);
});
