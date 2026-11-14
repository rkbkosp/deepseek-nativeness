import { performance } from "node:perf_hooks";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { SessionProjection } from "../projection.mjs";
import { PresentationPublisher } from "../updates.mjs";

const rows = [];
for (const historyCount of [1000, 10000]) {
  const projection = new SessionProjection("fixture-session");
  projection.snapshot({
    cursor: historyCount,
    records: Array.from({ length: historyCount }, (_, i) => ({
      event: {
        seq: i + 1,
        type: "user/message",
        time: i,
        data: {
          source: { kind: "user" },
          content: [
            {
              type: "text",
              text: "completed-fixture-" + i + "-" + "x".repeat(1024),
            },
          ],
        },
      },
    })),
  });
  projection.running = true;
  let wireBytes = 0,
    notifications = 0;
  const publisher = new PresentationPublisher((method, params) => {
    notifications++;
    wireBytes += Buffer.byteLength(JSON.stringify({ method, params }));
  });
  publisher.replace(projection.value());
  const frames = Array.from({ length: 100 }, (_, i) => ({
    type: "chunk",
    revision: i + 2,
    attemptId: "fixture-attempt",
    index: i,
    time: 10001 + i,
    chunk: { type: "text-delta", index: 0, text: "12345678" },
  }));
  projection.frame({
    type: "start",
    revision: 1,
    attemptId: "fixture-attempt",
    turn: 1,
    step: 1,
  });
  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed,
    cpuBefore = process.cpuUsage(),
    timeBefore = performance.now();
  let peak = heapBefore;
  const dirty = process.argv.includes("--dirty");
  for (const frame of frames) {
    projection.frame(frame);
    if (dirty) publisher.patch(projection.pullUpdates());
    else publisher.flush(projection.value());
    peak = Math.max(peak, process.memoryUsage().heapUsed);
  }
  const elapsedMs = performance.now() - timeBefore,
    cpu = process.cpuUsage(cpuBefore);
  const heapAfter = process.memoryUsage().heapUsed;
  const timedWireBytes = wireBytes,
    timedNotifications = notifications;
  // Count exact history lookups separately so instrumentation does not inflate timings.
  let messageReads = 0,
    trajectoryReads = 0,
    mapEntries = 0,
    mapCreates = 0;
  const getMessage = projection.messages.get.bind(projection.messages),
    getTrajectory = projection.trajectory.get.bind(projection.trajectory);
  projection.messages.get = (key) => {
    messageReads++;
    return getMessage(key);
  };
  projection.trajectory.get = (key) => {
    trajectoryReads++;
    return getTrajectory(key);
  };
  const MapOriginal = globalThis.Map;
  globalThis.Map = class extends MapOriginal {
    constructor(...args) {
      super(...args);
      mapCreates++;
      mapEntries += this.size;
    }
  };
  let revision = 102,
    index = 100;
  try {
    for (let i = 0; i < 100; i++) {
      projection.frame({
        type: "chunk",
        revision: revision++,
        attemptId: "fixture-attempt",
        index: index++,
        time: 10101 + i,
        chunk: { type: "text-delta", index: 0, text: "12345678" },
      });
      if (dirty) publisher.patch(projection.pullUpdates());
      else publisher.flush(projection.value());
    }
  } finally {
    globalThis.Map = MapOriginal;
  }
  rows.push({
    historyCount,
    chunkFlushes: 100,
    path: dirty ? "dirty" : "full-snapshot",
    elapsedMs,
    cpuMs: (cpu.user + cpu.system) / 1000,
    baselineHeapUsedBytes: heapBefore,
    heapPeakGrowthBytes: peak - heapBefore,
    heapRetainedGrowthBytes: heapAfter - heapBefore,
    historyMessageReads: messageReads,
    historyTrajectoryReads: trajectoryReads,
    mapCreates,
    mapEntriesInitialized: mapEntries,
    wireBytes: timedWireBytes,
    notifications: timedNotifications,
  });
}
const sources = {};
for (const name of ["projection.mjs", "updates.mjs"])
  sources[name] = createHash("sha256")
    .update(await readFile(new URL("../" + name, import.meta.url)))
    .digest("hex");
const report = {
  scope:
    "Synthetic actual SessionProjection frames plus PresentationPublisher. CPU/heap on this Mac, not M1 end-to-end. Heap peak is sampled live growth, not total allocation. Map entry initialization and history lookup counts are exact instrumentation in a separate pass.",
  sources,
  rows,
};
const out = process.argv.find((a) => a.startsWith("--output="))?.slice(9);
if (out) {
  await mkdir(new URL("./results/", import.meta.url), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + "\n");
}
console.log(JSON.stringify(report, null, 2));
