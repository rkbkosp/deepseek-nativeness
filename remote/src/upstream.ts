// Selected client-only modules from the frozen v0.6.4 reference checkout.
export { ClientConnection } from "../../remote_reference/packages/plugin/src/client-connection.js";
export { ClientServerApi } from "../../remote_reference/packages/plugin/src/server-api.js";
export { IdentityStore } from "../../remote_reference/packages/plugin/src/identity-store.js";
export { ServerCredentialStore } from "../../remote_reference/packages/plugin/src/server-credentials.js";
export { RemoteTypertGateway } from "../../remote_reference/packages/plugin/src/remote-typert-gateway.js";
export { resolveConfig } from "../../remote_reference/packages/plugin/src/config.js";
export { loadNodeRtcFactory } from "../../remote_reference/packages/plugin/src/werift-rtc.js";
// React-free presentation rules from the frozen dsh 0.2.2-rc.3 client.
export {
  contextProducer,
  contextForm,
  toAssistantBlocks,
  displayFailure,
} from "../../../deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/event-projection.ts";
export { reasoningText as displayReasoningText } from "../../../deepseek-harness/packages/client/ui-chat/src/client/reasoning-text.ts";
export { SteeringHistory } from "../../../deepseek-harness/packages/client/ui-chat/src/client/model/steering-history.ts";
export { processActivity } from "../../../deepseek-harness/packages/client/ui-chat/src/client/conversation-nodes/process-activity.ts";
export { uploadRemoteFile } from '../../remote_reference/packages/plugin/src/remote-file-upload.js'
