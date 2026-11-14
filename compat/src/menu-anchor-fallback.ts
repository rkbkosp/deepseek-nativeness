import {
  useCallback,
  useLayoutEffect,
  useRef,
  type Ref,
  type RefObject,
} from "react";
import { supportsMenuAnchors } from "./menu-anchor-geometry";
import {
  bindMenuPlacement,
  type MenuPlacementBinding,
} from "./menu-anchor-runtime";
import "./menu-anchor-fallback.css";

// A layout commit can move an unchanged-size trigger: ResizeObserver does not
// report that move. Refresh only this mounted owner after its React commits;
// the same bounded frame queue coalesces commits, scroll and resize. No render
// state is updated, and the frame never schedules another frame on its own.
function usePlacementCommit() {
  const current = useRef<MenuPlacementBinding | null>(null);
  useLayoutEffect(() => {
    current.current?.schedule();
  });
  return current;
}
function retainPlacement(
  ref: { current: MenuPlacementBinding | null },
  binding: MenuPlacementBinding,
) {
  ref.current = binding;
  return () => {
    if (ref.current === binding) ref.current = null;
    binding();
  };
}

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
    gap?: number;
    minTop?: number;
  },
) {
  const placement = usePlacementCommit();
  const {
    active,
    portal,
    side,
    align,
    point,
    matchWidth,
    external,
    gap,
    minTop,
  } = options;
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
    return retainPlacement(
      placement,
      bindMenuPlacement(menu.current, anchor.current, () => ({
        side,
        align,
        point:
          pointX === undefined || pointY === undefined
            ? undefined
            : { x: pointX, y: pointY },
        matchWidth,
        gap,
        minTop,
      })),
    );
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
    gap,
    minTop,
    placement,
  ]);
}
export function useNativeSubmenuAnchor(
  panel: RefObject<HTMLElement>,
  parent: RefObject<HTMLElement>,
  options: { active: boolean; page: boolean; trigger: HTMLElement | null },
) {
  const placement = usePlacementCommit();
  const { active, page, trigger } = options;
  useLayoutEffect(() => {
    if (supportsMenuAnchors() || !active || !panel.current || !parent.current)
      return;
    const anchor = parent.current;
    return retainPlacement(
      placement,
      bindMenuPlacement(panel.current, anchor, () => ({
        side: "submenu",
        page: panel.current?.getAttribute("data-submenu-layout") === "page",
        rowOffset: trigger
          ? trigger.getBoundingClientRect().top -
            anchor.getBoundingClientRect().top
          : 0,
      })),
    );
  }, [panel, parent, active, page, trigger, placement]);
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
  const placement = usePlacementCommit();
  useLayoutEffect(() => {
    if (
      supportsMenuAnchors() ||
      !surface.current ||
      !backing.current ||
      document.documentElement.dataset.platform !== "darwin"
    )
      return;
    return retainPlacement(
      placement,
      bindMenuPlacement(backing.current, surface.current, () => ({
        kind: "backing",
      })),
    );
  }, [surface, backing, placement]);
}

// The four independent source owners keep their own forms, keys and dismissal.
// These adapters name only the original CSS placement contract.
export function useTaskMenuAnchor(
  panel: RefObject<HTMLElement>,
  trigger: RefObject<HTMLElement>,
  open: boolean,
  portal: boolean,
  align: "start" | "end",
) {
  useNativeMenuAnchor(panel, trigger, {
    active: open,
    portal,
    side: "bottom",
    align,
    gap: 4,
    minTop: 12,
  });
}
export function useSchedulePickerAnchor(
  panel: RefObject<HTMLElement>,
  trigger: RefObject<HTMLElement>,
  open: boolean,
) {
  useNativeMenuAnchor(panel, trigger, {
    active: open,
    portal: true,
    side: "bottom",
    align: "start",
    gap: 4,
    minTop: 12,
  });
}
export function useModelPickerAnchor(
  panel: RefObject<HTMLElement>,
  trigger: RefObject<HTMLElement>,
  open: boolean,
  embedded: boolean,
) {
  useNativeMenuAnchor(panel, trigger, {
    active: open && !embedded,
    portal: true,
    side: "top",
    align: "end",
    gap: 8,
  });
}
export function useRegistryPickerAnchor(
  panel: RefObject<HTMLElement>,
  trigger: RefObject<HTMLElement>,
  open: boolean,
) {
  useNativeMenuAnchor(panel, trigger, {
    active: open,
    portal: true,
    side: "bottom",
    align: "end",
    gap: 6,
    minTop: 12,
  });
}
