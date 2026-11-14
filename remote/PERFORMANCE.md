# Incremental presentation evidence

Initial opens, rebaselines and explicit history loads retain a full snapshot. Stream flushes use the projection's dirty message/trajectory journal and the publisher's existing id maps. They no longer call `projection.value()`, map every loaded row, or reconstruct history maps every 16 ms. The original frozen presentation helpers remain unchanged.

The journal preserves positional replacement, tool-call/result identity and ordering, transient attempt retirement, pending interactions, projection baselines and authoritative running state. A non-enumerable acknowledgement on an explicit full snapshot clears only its current journal generation; it is absent from JSON. Reads of a full snapshot alone do not consume pending updates.

`messageDelta` retains text/reasoning suffixes. Optional `textBlockIndex` and `reasoningBlockIndex` identify the existing text/reasoning block receiving the same suffix, without transmitting it twice. New block kinds, image/attachment changes, tool metadata, timing or other metadata changes require a complete **single-message** upsert. Receivers must preserve all `assistantBlocks` variants and move an existing message id when its upsert index changes.

`test/dirty-publisher.test.mjs` replays actual projection frames through the dirty publisher and reconstructs a wire mirror. It checks text/reasoning blocks, image metadata, tool preparation/settlement, committed attempts and positional replacement against the full source snapshot. Its scheduled-adapter test makes `snapshot()` throw, then flushes 100 chunks over 10,000 retained records without invoking it or visiting history maps. The native integration test additionally compares the real Node stdout notifications with Go state and compares expected JSON without decoding both sides through the same Go schema.

Reproduce the local synthetic benchmark:

```sh
node --expose-gc remote/bench/publisher-cost.mjs --dirty --output=remote/bench/results/publisher-dirty.json
```

The pre-change results are saved in `bench/results/publisher-baseline.json`, with source hashes matching the ready low-frequency source checkpoint. On this Mac, the 10,000-history/100-chunk baseline sampled about 181 ms wall time and 207 ms process CPU, versus below 3 ms CPU in the first dirty-path samples. Exact counters changed from 1,000,000 message lookups plus 1,000,000 trajectory lookups and 2,000,100 Map-entry initializations to zero history lookups and 200 active-entry initializations. Timing varies with JIT, GC and other work. The deterministic history counters are the regression gate.

Heap measurements are sampled live growth, **not total allocations**. The first 10,000-history samples changed from about 57.5 MB peak growth to below 1.3 MB. The index/journal maps retain additional small per-record bookkeeping; this is not proof that idle heap fell. The richer real-frame stream uses about 21.4 KB for 100 publications, including block indices; it contains no completed history. The earlier plain-text wire budget remains 16,598 bytes.

These are frontend fixture measurements on this Mac. They do not establish M1 full-application CPU/RSS, actual remote running-stream latency, or complete visual parity. No real task, approval, terminal or model request was used to manufacture a benchmark.
