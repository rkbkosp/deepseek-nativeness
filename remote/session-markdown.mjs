// Exact pure formatter from the frozen dsh source. Type-only imports are erased by the helper build.
import { formatSessionMarkdown } from "../../deepseek-harness/packages/session-query/session-log-export/src/markdown.ts";
import { isDeepStrictEqual } from "node:util";

export const SESSION_MARKDOWN_LIMITS = Object.freeze({
  maxEvents: 200000,
  maxEventBytes: 32 * 1024 * 1024,
  maxResultBytes: 8 * 1024 * 1024,
  maxPages: 2000,
  pageMessages: 200,
});
const reject = (code, message) => {
  throw Object.assign(Error(message), { code, delivery: "rejected" });
};

/** A passive, fixed-cut export. It never changes the visible session projection or starts an Agent. */
export async function collectSessionMarkdown({
  sessionId,
  gateway,
  client,
  signal,
  assertCurrent,
  limits = SESSION_MARKDOWN_LIMITS,
}) {
  const check = () => {
    assertCurrent();
    if (signal.aborted) reject("EXPORT_CANCELLED", "会话Markdown准备已取消。");
  };
  check();
  // This changes only this authenticated peer's read projection, not Host settings or task state.
  const configuration = await client.rpc(
    "remote.history.configure",
    { compact: false },
    signal,
  );
  check();
  if (configuration?.compact !== false)
    reject(
      "UNCOMPACTED_HISTORY_REQUIRED",
      "Host未确认完整历史读取，不能生成完整Markdown。",
    );
  const events = new Map();
  let eventBytes = 0,
    throughSeq,
    beforeSeq,
    pages = 0;
  while (true) {
    check();
    if (++pages > limits.maxPages)
      reject(
        "EXPORT_LIMIT",
        "会话超出本客户端导出分页预算，未生成不完整副本。",
      );
    const value = await gateway.invoke({
      namespace: "session",
      method: "events",
      args: {
        request: {
          address: { kind: "session", sessionId },
          maxMessages: limits.pageMessages,
          ...(throughSeq === undefined ? {} : { throughSeq }),
          ...(beforeSeq === undefined ? {} : { beforeSeq }),
        },
      },
      signal,
    });
    check();
    if (
      !Number.isSafeInteger(value?.cursor) ||
      value.cursor < -1 ||
      !Array.isArray(value.records) ||
      typeof value.hasMore !== "boolean"
    )
      reject("INVALID_HISTORY", "Host历史分页格式无效。");
    if (throughSeq === undefined) {
      throughSeq = value.cursor;
      if (throughSeq + 1 > limits.maxEvents)
        reject(
          "EXPORT_LIMIT",
          "会话超出本客户端导出事件预算，未生成不完整副本。",
        );
    } else if (value.cursor !== throughSeq)
      reject(
        "INCONSISTENT_HISTORY",
        "Host历史读取截点发生变化，未生成不完整副本。",
      );
    let earliest = Infinity;
    for (const record of value.records) {
      const event = record?.type === "event" ? record.event : undefined;
      if (
        !event ||
        !Number.isSafeInteger(event.seq) ||
        event.seq < 0 ||
        event.seq > throughSeq ||
        typeof event.type !== "string"
      )
        reject("INVALID_HISTORY", "Host历史事件格式或截点无效。");
      earliest = Math.min(earliest, event.seq);
      const existing = events.get(event.seq);
      if (existing) {
        if (!isDeepStrictEqual(existing, event))
          reject("INCONSISTENT_HISTORY", "Host返回相同序号的不同历史事件。");
        continue;
      }
      eventBytes += Buffer.byteLength(JSON.stringify(event));
      if (events.size >= limits.maxEvents || eventBytes > limits.maxEventBytes)
        reject(
          "EXPORT_LIMIT",
          "会话超出本客户端导出内存预算，未生成不完整副本。",
        );
      events.set(event.seq, event);
    }
    if (!value.hasMore) break;
    if (!Number.isFinite(earliest) || earliest >= (beforeSeq ?? throughSeq + 1))
      reject("INCONSISTENT_HISTORY", "Host历史分页未前进。");
    beforeSeq = earliest;
  }
  check();
  const ordered = [...events.values()].sort((a, b) => a.seq - b.seq);
  if (
    ordered.length !== throughSeq + 1 ||
    ordered.some((event, index) => event.seq !== index)
  )
    reject("INCOMPLETE_HISTORY", "Host历史存在缺页，不能生成完整Markdown。");
  let markdown;
  try {
    markdown = formatSessionMarkdown(ordered);
  } catch {
    reject("INVALID_HISTORY", "原版Markdown转换器无法读取此历史格式。");
  }
  check();
  const result = {
    sessionId,
    markdown,
    complete: true,
    throughSeq,
    eventCount: ordered.length,
    source: "original-formatSessionMarkdown+session/events",
    sourcePathIncluded: false,
  };
  // The native bridge accepts at most 16MiB per stdout line; leave ample room for the response envelope.
  if (Buffer.byteLength(JSON.stringify(result)) > limits.maxResultBytes)
    reject(
      "EXPORT_LIMIT",
      "完整Markdown超出本客户端传输预算，未生成截断副本。",
    );
  return result;
}
