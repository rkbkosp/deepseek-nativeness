import { observeComposition } from "../../../deepseek-harness/packages/client/ui-primitives/src/keyboard-composition.ts";
import { modalSelector } from "../../../deepseek-harness/packages/client/ui-primitives/src/useModalLayer.ts";

/** Native owns the outer settings dialog; original child controls own the first Escape. */
export function installSettingsKeys(document: Document, close: () => void) {
  const composition = observeComposition(document);
  const keydown = (event: KeyboardEvent) => {
    const composing = composition.guards(event);
    if (
      event.defaultPrevented ||
      composing ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.shiftKey ||
      event.key !== "Escape"
    )
      return;
    // The native parent is outside this document. Any web dialog/menu is an
    // inner foreground layer and must settle before the native dialog closes.
    if (document.querySelector(modalSelector)) return;
    event.preventDefault();
    if (!event.repeat) close();
  };
  document.addEventListener("keydown", keydown);
  return () => {
    document.removeEventListener("keydown", keydown);
    composition.dispose();
  };
}
