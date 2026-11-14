import { useSyncExternalStore } from "react";
export const translate =
  (dictionary: Record<string, string>) =>
  (key: string, params: Record<string, unknown> = {}) =>
    (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (_, name) =>
      String(params[name] ?? ""),
    );
export const resolveText = (value: any) =>
  typeof value === "string"
    ? value
    : (value?.zh ?? value?.en ?? Object.values(value ?? {})[0] ?? "");
export function hook(source: any) {
  return function useSnapshotSelector(
    selector: (s: any) => any = (s: any) => s,
  ) {
    return selector(useSyncExternalStore(source.subscribe, source.getSnapshot));
  };
}

export const no = () => {};
