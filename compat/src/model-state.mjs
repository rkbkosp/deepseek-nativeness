// Frozen ui-model-selection/directory.ts syncInputs semantics, without the Cordis service.
export function modelDirectoryState(catalog, baseline) {
  const projected = baseline?.values?.modelSelection;
  if (projected === undefined)
    return {
      current: null,
      routable: null,
      groups: catalog.groups,
      failures: catalog.failures,
      status: "error",
      pending: null,
      error: "当前会话未返回模型选择投影。",
    };
  const current = projected.next ?? catalog.default;
  const group = catalog.groups.find((group) => group.id === current.provider),
    model = group?.models.find((model) => model.id === current.model);
  const reasoning = model?.reasoning,
    effort = current.reasoningEffort ?? reasoning?.defaultEffort;
  const retainedEffort =
    effort === undefined
      ? undefined
      : (reasoning?.efforts.find((level) => level.id === effort)?.name ??
        effort);
  return {
    current,
    routable: !!model,
    groups: catalog.groups,
    failures: catalog.failures,
    status: "ready",
    pending: null,
    error: null,
    ...(retainedEffort === undefined ? {} : { retainedEffort }),
  };
}
