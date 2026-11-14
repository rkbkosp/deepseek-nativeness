// Explicit deterministic gateway fixture. Requests run through the real RemoteAdapter validation.
import { RemoteAdapter } from "./client.mjs";
import { SessionProjection } from "./projection.mjs";
import { PresentationPublisher } from "./updates.mjs";
const WORKSPACE = "fixture-workspace",
  SESSION = "fixture-session",
  HOST = "fixture-host";
const history = () => ({
  type: "snapshot",
  cursor: 2,
  hasMore: false,
  assistantStream: { revision: 0 },
  records: [
    {
      type: "event",
      event: {
        type: "user/message",
        seq: 1,
        surfaceOp: "append",
        data: { content: [{ type: "text", text: "请保留界面风格和动效。" }] },
      },
    },
    {
      type: "event",
      event: {
        type: "assistant/message",
        seq: 2,
        surfaceOp: "append",
        data: {
          turn: 1,
          step: 1,
          message: {
            content: [
              {
                type: "text",
                text: '# Native DSH\n\n这是**显式协议夹具**，用于验证 Go ↔ Node 接线。\n\n- 状态栏与侧栏\n- Markdown 与代码\n- 审批和问题回答\n\n```go\nui.Text(c, "Hello")\n```',
              },
            ],
          },
          stream: [],
        },
      },
    },
  ],
});
export class FixtureAdapter extends RemoteAdapter {
  async request(method, params = {}) {
    if (method === "fixtureEmitNotifications") {
      if (!Array.isArray(params.events) || params.events.length > 16)
        throw Error("Invalid fixture events");
      const allowed = new Set([
        "sessions",
        "workspaces",
        "snapshot",
        "sessionState",
        "messageUpsert",
        "messageDelta",
        "sessionProjections",
      ]);
      for (const event of params.events) {
        if (
          !allowed.has(event.method) ||
          typeof event.scope?.hostId !== "string" ||
          !Number.isSafeInteger(event.scope?.generation) ||
          typeof event.scope?.accountScope !== "string"
        )
          throw Error("Invalid fixture notification");
        this.emit(
          event.method,
          event.params,
          Object.freeze({ ...event.scope }),
        );
      }
      this.emit("fixtureComplete", {
        marker: params.marker ?? "notification-scope",
        dataSource: "fixture",
      });
      return { emitted: params.events.length };
    }
    if (method === "fixtureHoldOwnerRegistration") {
      this.fixtureHoldRegistrations = params.hold === true;
      if (!this.fixtureHoldRegistrations)
        for (const release of this.fixtureRegistrationWaiters.splice(0))
          release();
      return this.fixtureUnaryStats();
    }
    if (method === "registerOwner" && this.fixtureHoldRegistrations)
      await new Promise((resolve) =>
        this.fixtureRegistrationWaiters.push(resolve),
      );
    if (method === "fixtureHoldAttachments") {
      this.fixtureHoldAttachments = params.hold === true;
      this.fixtureIgnoreAttachmentAbort = params.ignoreAbort === true;
      if (!this.fixtureHoldAttachments)
        for (const pending of [...this.fixtureAttachmentReads.values()])
          pending.release();
      return this.fixtureUnaryStats();
    }
    if (method === "fixtureStats") return this.fixtureUnaryStats();
    if (method === "fixtureStructuredStream") return this.structuredStream();
    return super.request(method, params);
  }
  fixtureUnaryStats() {
    return {
      dataSource: "fixture",
      activeAttachments: this.fixtureAttachmentReads.size,
      startedAttachments: this.fixtureAttachmentStarted,
      abortedAttachments: this.fixtureAttachmentAborted,
      activeOwners: this.owners.size,
      heldRegistrations: this.fixtureRegistrationWaiters.length,
    };
  }
  structuredStream() {
    const sessionId = "fixture-structured-session";
    const projection = new SessionProjection(sessionId);
    const image = {
      attachmentId: "fixture-image",
      mediaType: "image/png",
      bytes: 24,
      width: 2,
      height: 3,
      name: "fixture.png",
    };
    const file = {
      attachmentId: "fixture-file",
      name: "fixture.txt",
      bytes: 3,
    };
    const event = (seq, type, data) => ({ seq, type, time: seq, data });
    projection.snapshot({
      cursor: 2,
      records: [
        {
          event: event(1, "assistant/message", {
            message: {
              content: [
                { type: "text", text: "Durable fixture" },
                { type: "image", attachment: image },
                { type: "file", attachment: file },
              ],
            },
          }),
        },
        {
          event: event(2, "user/message", {
            source: { kind: "user" },
            content: [{ type: "text", text: "Fixture request" }],
          }),
        },
      ],
    });
    const publisher = new PresentationPublisher(this.emit);
    const initial = projection.value();
    publisher.replace(initial);
    this.emit("snapshot", initial);
    let revision = 1,
      index = 0;
    projection.frame({
      type: "start",
      revision: revision++,
      attemptId: "fixture-attempt",
      turn: 1,
      step: 1,
    });
    const chunk = (chunk) =>
      projection.frame({
        type: "chunk",
        revision: revision++,
        attemptId: "fixture-attempt",
        index: index++,
        time: 10,
        chunk,
      });
    const flush = () => publisher.patch(projection.pullUpdates());
    chunk({ type: "text-delta", index: 0, text: "hello" });
    chunk({ type: "reasoning-delta", index: 1, text: "Thinking" });
    flush();
    chunk({ type: "text-delta", index: 0, text: " world" });
    chunk({ type: "reasoning-delta", index: 1, text: " more" });
    flush();
    chunk({
      type: "block-end",
      index: 2,
      block: { type: "image", attachment: image },
    });
    flush();
    chunk({
      type: "tool-call-delta",
      index: 3,
      id: "fixture-call",
      name: "fixture-tool",
      argumentsDelta: '{"text":',
    });
    flush();
    chunk({
      type: "tool-call-delta",
      index: 3,
      id: "fixture-call",
      argumentsDelta: '"value"}',
    });
    flush();
    projection.event(
      event(3, "tool/call", {
        callId: "fixture-call",
        name: "fixture-tool",
        arguments: '{"text":"value"}',
        turn: 1,
        step: 1,
      }),
    );
    flush();
    projection.event(
      event(4, "assistant/message", {
        turn: 1,
        step: 1,
        message: {
          content: [
            { type: "text", text: "hello world" },
            { type: "reasoning", text: "Thinking more" },
            { type: "image", attachment: image },
            {
              type: "tool-call",
              id: "fixture-call",
              name: "fixture-tool",
              arguments: '{"text":"value"}',
            },
          ],
        },
      }),
    );
    flush();
    const expected = projection.value();
    this.emit("fixtureComplete", {
      sessionId,
      marker: "structured-v1",
      dataSource: "fixture",
    });
    return { expected };
  }
  constructor(emit) {
    super(emit);
    this.identity = { deviceId: "fixture-client" };
    this.authenticated = true;
    this.fixtureAttachmentReads = new Map();
    this.fixtureAttachmentStarted = 0;
    this.fixtureAttachmentAborted = 0;
    this.fixtureRegistrationWaiters = [];
    this.server = {
      baseUrl: "fixture://local",
      close() {},
      hasStoredAuthorization: async () => true,
      oauthProviders: async () => [],
      authorizeWithAccount: async () => ({ authorized: true }),
    };
  }
  status() {
    return {
      ...super.status(),
      detail: "模拟协议夹具 · 非真实远程连接",
      dataSource: "fixture",
      backend: "fixture",
    };
  }
  async configure() {
    return this.status();
  }
  async devices() {
    return [{ id: HOST, name: "测试 MacMini（模拟）", online: true }];
  }
  async connect(hostId) {
    if (hostId !== HOST)
      throw Object.assign(new Error("Unknown fixture host"), {
        code: "HOST_OFFLINE",
      });
    await this.disconnect();
    this.hostId = HOST;
    this.connected = {
      client: {
        getStats: () => ({ mode: "Fixture" }),
        close: async () => {},
        rpc: async (method, args) => {
          if (method === "remote.history.configure" && args.compact === false)
            return { compact: false };
          if (method === "harness.transport.describe")
            return { capabilities: ["remote.history.compact.v1"] };
          throw Error("Unknown fixture client RPC");
        },
      },
    };
    this.interactionReady = true;
    this.gateway = {
      invoke: async ({ namespace, method, args, signal }) => {
        if (namespace === "session" && method === "attachment") {
          this.fixtureAttachmentStarted++;
          const value = {
            attachment: args.request.attachment,
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBzQAAAAASUVORK5CYII=",
          };
          if (!this.fixtureHoldAttachments) return value;
          return new Promise((resolve, reject) => {
            const key = this.fixtureAttachmentStarted;
            const cleanup = () => {
              signal?.removeEventListener("abort", abort);
              this.fixtureAttachmentReads.delete(key);
            };
            const abort = () => {
              this.fixtureAttachmentAborted++;
              if (!this.fixtureIgnoreAttachmentAbort) {
                cleanup();
                reject(
                  Object.assign(Error("Fixture read aborted"), {
                    code: "CANCELLED",
                  }),
                );
              }
            };
            this.fixtureAttachmentReads.set(key, {
              release: () => {
                cleanup();
                resolve(value);
              },
            });
            if (signal?.aborted) abort();
            else signal?.addEventListener("abort", abort, { once: true });
          });
        }
        if (
          namespace === "session" &&
          method === "list" &&
          (Object.keys(args ?? {}).join() !== "_request" ||
            typeof args._request !== "object")
        )
          throw Object.assign(
            new Error("session/list requires frozen Host descriptor _request"),
            { code: "gateway/arguments-invalid" },
          );
        if (namespace === "session" && method === "list")
          return {
            items: [
              {
                sessionId: SESSION,
                title: "原生远程客户端 · 协议夹具",
                running: true,
                updatedAt: 1,
              },
            ],
          };
        if (namespace === "session" && method === "events") {
          if (
            args.request?.address?.kind !== "session" ||
            args.request.address.sessionId !== SESSION
          )
            throw Error("Wrong fixture export session");
          const records = [
            {
              type: "event",
              event: {
                seq: 0,
                type: "session/title",
                data: { title: "完整Markdown协议夹具" },
              },
            },
            ...history().records.map((row) => ({
              type: "event",
              event: {
                ...row.event,
                data:
                  row.event.type === "user/message"
                    ? {
                        ...row.event.data,
                        id: "fixture-user-id",
                        source: { kind: "user" },
                      }
                    : row.event.data,
              },
            })),
          ];
          return { cursor: 2, hasMore: false, records };
        }
        if (namespace === "session" && method === "page")
          return { records: history().records, hasMore: false };
        throw Object.assign(new Error("Unknown fixture unary endpoint"), {
          code: "METHOD_NOT_FOUND",
        });
      },
      open: async function* (endpoint, payload, signal) {
        if (endpoint === "remoteAccess/follow") {
          yield { owner: true, grants: [] };
          return;
        }
        if (endpoint === "workspace/follow") {
          yield {
            type: "baseline",
            value: {
              items: [
                {
                  workspaceId: WORKSPACE,
                  title: "协议夹具",
                  path: "/fixture",
                  sessionIds: [SESSION],
                },
              ],
            },
          };
          return;
        }
        if (endpoint === "session/follow") {
          if (payload.args.request.address.sessionId !== SESSION)
            throw Error("Wrong fixture session");
          yield history();
          await new Promise((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener("abort", resolve, { once: true });
          });
          return;
        }
        throw Object.assign(new Error("Unknown fixture stream endpoint"), {
          code: "METHOD_NOT_FOUND",
        });
      },
      dispatch: async (endpoint, payload) => {
        if (endpoint === "session/prompt" || endpoint === "session/cancel") {
          if (payload.args?.request?.sessionId !== SESSION)
            throw Error("Wrong fixture mutation session");
          return { ok: true, value: { fixture: true } };
        }
        if (endpoint === "$events/result") return { ok: true, value: {} };
        throw Object.assign(new Error("Unknown fixture dispatch endpoint"), {
          code: "METHOD_NOT_FOUND",
        });
      },
    };
    await this.workspaces();
    await this.sessions();
    this.notifyStatus();
    return this.status();
  }
  async openSession(sessionId) {
    await super.openSession(sessionId);
    this.pending.set("fixture-approval", {
      id: "fixture-approval",
      sessionId: SESSION,
      kind: "approval",
      title: "读取工作区文件",
      reason: "本地协议夹具，不执行工具。",
      abort: new AbortController(),
      wire: { clientId: "fixture-client", eventId: "fixture-approval" },
    });
    this.pending.set("fixture-question", {
      id: "fixture-question",
      sessionId: SESSION,
      kind: "questions",
      title: "测试问题",
      reason: "仅验证原生问答接线",
      questions: [
        {
          id: "choice",
          question: "选择一个界面选项",
          options: [
            { label: "保留动效", description: "使用原版动画节奏" },
            { label: "查看详情", description: "打开兼容面板" },
          ],
          multiSelect: false,
        },
      ],
      abort: new AbortController(),
      wire: { clientId: "fixture-client", eventId: "fixture-question" },
    });
    this.emit("snapshot", this.snapshot());
    return this.snapshot();
  }
  snapshot() {
    return { ...super.snapshot(), dataSource: "fixture" };
  }
}
