import {
  useCallback,
  useLayoutEffect,
  useRef,
  type Ref,
  type RefObject,
} from "react";
import { supportsMenuAnchors } from "./menu-anchor-geometry";
import { bindMenuPlacement } from "./menu-anchor-runtime";
import "./menu-anchor-fallback.css";

export function useNativeMenuAnchor(
  menu: RefObject<HTMLElement>,
  anchor: RefObject<HTMLElement>,
  options: {
    active: boolean;
    portal: boolean;
    side: "top" | "bottom" | "right";
    align: "start" | "end";
    point?: { x: number; y: number };
    matchWidth?: boolean;
    external?: HTMLElement | null;
  },
) {
  const { active, portal, side, align, point, matchWidth, external } = options;
  const pointX = point?.x,
    pointY = point?.y;
  useLayoutEffect(() => {
    if (
      supportsMenuAnchors() ||
      !active ||
      !portal ||
      !menu.current ||
      !anchor.current
    )
      return;
    // ModelSelect's embedded root has its own native popover viewport and layout.
    if (
      menu.current.hasAttribute("data-model-menu") &&
      document.body.hasAttribute("data-native-model-menu")
    )
      return;
    return bindMenuPlacement(menu.current, anchor.current, () => ({
      side,
      align,
      point:
        pointX === undefined || pointY === undefined
          ? undefined
          : { x: pointX, y: pointY },
      matchWidth,
    }));
  }, [
    menu,
    anchor,
    active,
    portal,
    side,
    align,
    pointX,
    pointY,
    matchWidth,
    external,
  ]);
}
export function useNativeSubmenuAnchor(
  panel: RefObject<HTMLElement>,
  parent: RefObject<HTMLElement>,
  options: { active: boolean; page: boolean; trigger: HTMLElement | null },
) {
  const { active, page, trigger } = options;
  useLayoutEffect(() => {
    if (supportsMenuAnchors() || !active || !panel.current || !parent.current)
      return;
    const anchor = parent.current;
    return bindMenuPlacement(panel.current, anchor, () => ({
      side: "submenu",
      page: panel.current?.getAttribute("data-submenu-layout") === "page",
      rowOffset: trigger
        ? trigger.getBoundingClientRect().top -
          anchor.getBoundingClientRect().top
        : 0,
    }));
  }, [panel, parent, active, page, trigger]);
}
export function useNativeMenuSurfaceRef(forwarded: Ref<HTMLDivElement>) {
  const surface = useRef<HTMLDivElement | null>(null);
  const capture = useCallback(
    (element: HTMLDivElement | null) => {
      surface.current = element;
      if (typeof forwarded === "function") forwarded(element);
      else if (forwarded)
        (forwarded as { current: HTMLDivElement | null }).current = element;
    },
    [forwarded],
  );
  return [surface, capture] as const;
}
export function useNativeMenuBacking(
  surface: RefObject<HTMLElement>,
  backing: RefObject<HTMLElement>,
) {
  useLayoutEffect(() => {
    if (
      supportsMenuAnchors() ||
      !surface.current ||
      !backing.current ||
      document.documentElement.dataset.platform !== "darwin"
    )
      return;
    return bindMenuPlacement(backing.current, surface.current, () => ({
      kind: "backing",
    }));
  }, [surface, backing]);
}
