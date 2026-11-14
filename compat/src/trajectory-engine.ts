// The frozen dsh target assembler and independent Trajectory definitions, without Cordis or Chat summaries.
import { ConversationNodeAssembler } from "../../../deepseek-harness/packages/client/ui-conversation/src/client/conversation/assembler.ts";
import { inspectSystemPrompt } from "../../../deepseek-harness/packages/client/ui-conversation/src/client/contract/system-prompt.ts";
import { inspectRequestPrompt } from "../../../deepseek-harness/packages/client/ui-conversation/src/client/contract/request-inspection.ts";
import { registerTrajectoryMessageDefinitions } from "../../../deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-message-definitions.ts";
import { registerTrajectoryRequestHeaderDefinition } from "../../../deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-request-header-definition.ts";
import { registerTrajectoryAssistantDefinition } from "../../../deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-assistant-definition.ts";
import { registerTrajectoryToolDefinition } from "../../../deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-tool-definition.ts";
import { registerTrajectoryCompactionDefinitions } from "../../../deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-compaction-definition.ts";
import {
  trajectoryViewDefinition,
  EMPTY_TRAJECTORY_SNAPSHOT,
} from "../../../deepseek-harness/packages/client/ui-trajectory/src/client/trajectory-snapshot-builder.ts";
import { ClientAssistantStream } from "../../../deepseek-harness/packages/api/session-controller/src/client/sessions/assistant-stream.ts";
export class TrajectoryEngine {
  readonly assembler: ConversationNodeAssembler;
  private assistant = new ClientAssistantStream();
  private revision = 0;
  private lastDurable = -1;
  constructor() {
    const definitions: any[] = [],
      routes = new Set<any>();
    const events = {
      register: (input: any) => {
        const table =
          typeof input.match === "function"
            ? undefined
            : new Map(Object.entries(input.match));
        const definition = table
          ? {
              ...input,
              match: (event: any) =>
                table.get(event.type)?.call(definition, event) ?? null,
            }
          : input;
        definitions.push(definition);
        routes.add({ definition, match: definition.match.bind(definition) });
        return () => {};
      },
      entries: () => definitions,
      fallbackEntry: () => undefined,
      forEvent: () => routes,
    };
    const ctx: any = {
      uiConversation: { events, inspectSystemPrompt, inspectRequestPrompt },
    };
    for (const register of [
      registerTrajectoryMessageDefinitions,
      registerTrajectoryRequestHeaderDefinition,
      registerTrajectoryAssistantDefinition,
      registerTrajectoryToolDefinition,
      registerTrajectoryCompactionDefinitions,
    ])
      register(ctx);
    this.assembler = new ConversationNodeAssembler(events, {
      entries: () => [trajectoryViewDefinition],
    } as any);
    this.assembler.activateTarget("trajectory");
  }
  replace(frame: any) {
    this.revision = frame.assistantStream?.revision ?? 0;
    this.lastDurable = frame.cursor;
    this.assembler.replaceWindow(
      this.assistant.replace(frame.records, frame.assistantStream),
      frame.hasMore,
    );
    this.assembler.flush();
    return this.snapshot();
  }
  append(frame: any) {
    let result: any;
    if (frame.type === "assistant-stream") {
      if (frame.frame.revision !== this.revision + 1)
        throw Object.assign(Error("轨迹流有缺口，请重新打开轨迹。"), {
          code: "REBASELINE_REQUIRED",
        });
      this.revision = frame.frame.revision;
      result = this.assistant.acceptFrame(frame.frame);
    } else if (frame.type === "event") {
      if (frame.event.seq <= this.lastDurable) return this.snapshot();
      this.lastDurable = frame.event.seq;
      result = this.assistant.acceptDurable(frame);
    } else return this.snapshot();
    if (result?.type === "rebaseline")
      throw Object.assign(Error("轨迹流有缺口，请重新打开轨迹。"), {
        code: "REBASELINE_REQUIRED",
      });
    if (result?.type === "publish") {
      this.assembler.append(result.entry);
      if (result.retireAttemptId)
        this.assembler.settleAssistant(result.retireAttemptId);
    }
    if (result?.type === "transient") this.assembler.append(result.entry);
    if (result?.type === "settlement")
      this.assembler.settleAssistant(result.attemptId, result.entry);
    if (result?.type === "abandonment")
      this.assembler.settleAssistant(result.attemptId);
    this.assembler.flush();
    return this.snapshot();
  }
  prepend(records: any[], hasMore: boolean) {
    this.assembler.prepend(records, hasMore);
    this.assembler.flush();
    return this.snapshot();
  }
  snapshot() {
    return this.assembler.snapshot("trajectory") ?? EMPTY_TRAJECTORY_SNAPSHOT;
  }
}
