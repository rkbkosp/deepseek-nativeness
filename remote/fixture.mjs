// Explicit deterministic gateway fixture. Requests run through the real RemoteAdapter validation.
import { RemoteAdapter } from "./client.mjs";
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
  constructor(emit) {
    super(emit);
    this.identity = { deviceId: "fixture-client" };
    this.authenticated = true;
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
      client: { getStats: () => ({ mode: "Fixture" }), close: async () => {} },
    };
    this.interactionReady = true;
    this.gateway = {
      invoke: async ({ namespace, method, args }) => {
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
        if (namespace === "session" && method === "page")
          return { records: history().records, hasMore: false };
        throw Object.assign(new Error("Unknown fixture unary endpoint"), {
          code: "METHOD_NOT_FOUND",
        });
      },
      open: async function* (endpoint, payload, signal) {
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
