/** Reviewable RPC closure for each locally packaged page. Native keeps its own deny-by-default allowlist. */
export const PAGE_CONTRACTS = {
  "plugin-settings": { read: ["pluginInventory"], write: [], native: [] },
  "model-menu": {
    read: ["modelCatalog", "sessionProjections"],
    write: ["selectModel"],
    native: ["Close", "ResizeModelMenu"],
  },
  trajectory: {
    read: [
      "watchSession",
      "sessionPage",
      "watchToolResult",
      "closeStream",
      "readAttachment",
    ],
    write: [],
    native: [],
  },
  terminal: {
    read: [
      "listTerminals",
      "terminalEnvironment",
      "terminalShells",
      "watchTerminal",
      "retainTerminal",
      "closeStream",
    ],
    write: [
      "createTerminal",
      "renameTerminal",
      "closeTerminal",
      "writeTerminal",
      "resizeTerminal",
    ],
    native: [],
  },
  "agent-presets": {
    read: ["listAgentPresets", "readAgentPreset", "describeSettings"],
    write: ["updateSettings"],
    native: ["StartDraft"],
  },
  "model-settings": {
    read: [
      "listProviders",
      "listConfigurableProviders",
      "discoverModels",
      "modelCatalog",
      "describeSettings",
      "describeCredentials",
    ],
    write: ["mutateSettings", "setCredential", "unsetCredential"],
    native: [],
  },
  automation: {
    read: ["scheduleCatalog", "scheduleDeliveryLimits", "scheduleHistory"],
    write: ["editSchedule", "runSchedule", "deleteInactiveSchedules"],
    native: ["OpenSession", "StartDraft"],
    blocked: ["createSchedule"],
  },
};
