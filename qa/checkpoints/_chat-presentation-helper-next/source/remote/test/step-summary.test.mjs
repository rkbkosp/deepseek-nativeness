import test from "node:test";
import assert from "node:assert/strict";
import { StepSummaryIndex } from "../step-summary.mjs";

test("body-free step prefix summary matches arbitrary-order corrections and sparse identifiers", () => {
  const index = new StepSummaryIndex(),
    source = new Map();
  let seed = 7;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  for (let i = 0; i < 1000; i++) {
    const key = next() % 200,
      evidence = next() % 3 === 0 ? Infinity : next() / 100,
      messages = next() % 10;
    source.set(key, { evidence, messages });
    index.set(key, evidence, messages);
    const before = next() % 201;
    const all = [...source],
      earlier = all.filter(([key]) => key < before).map(([, value]) => value);
    assert.deepEqual(index.before(before), {
      evidence: Math.min(Infinity, ...earlier.map((x) => x.evidence)),
      messages: earlier.reduce((sum, x) => sum + x.messages, 0),
    });
    assert.equal(
      index.minimum,
      Math.min(Infinity, ...all.map(([, x]) => x.evidence)),
    );
    assert.equal(
      index.total,
      all.reduce((sum, [, x]) => sum + x.messages, 0),
    );
  }
});
