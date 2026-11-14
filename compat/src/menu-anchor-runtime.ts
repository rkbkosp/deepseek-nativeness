import {
  menuPlacement,
  type MenuRect,
  type PlacementOptions,
} from "./menu-anchor-geometry";
export interface MenuPlacementConfig extends PlacementOptions {
  kind?: "menu" | "backing";
  matchWidth?: boolean;
  point?: { x: number; y: number };
}
const properties = [
  "--native-menu-x",
  "--native-menu-y",
  "--native-menu-w",
  "--native-menu-h",
  "--native-menu-min-w",
  "--native-menu-max-w",
  "--native-menu-max-h",
];
/** Bind only while this menu is mounted; all observers/listeners/frames are removed on disposal. */
export function bindMenuPlacement(
  menu: HTMLElement,
  anchor: HTMLElement,
  config: () => MenuPlacementConfig,
): () => void {
  const doc = menu.ownerDocument,
    win = doc.defaultView!;
  const previous = new Map(
    properties.map((key) => [
      key,
      [menu.style.getPropertyValue(key), menu.style.getPropertyPriority(key)],
    ]),
  );
  const oldAttribute = menu.getAttribute("data-native-anchor-fallback");
  const oldSubmenu = menu.getAttribute("data-native-submenu-fallback");
  let stopped = false,
    frame = 0;
  const set = (key: string, value: number) => {
    const text = `${Math.max(0, value)}px`;
    if (menu.style.getPropertyValue(key) !== text)
      menu.style.setProperty(key, text);
  };
  const place = () => {
    frame = 0;
    if (stopped || !menu.isConnected || !anchor.isConnected) return;
    const options = config(),
      size = {
        width: doc.documentElement.clientWidth || win.innerWidth,
        height: doc.documentElement.clientHeight || win.innerHeight,
      };
    const real = anchor.getBoundingClientRect(),
      a: MenuRect = options.point
        ? {
            left: options.point.x,
            right: options.point.x,
            top: options.point.y,
            bottom: options.point.y,
            width: 0,
            height: 0,
          }
        : real;
    if (options.kind === "backing") {
      menu.setAttribute("data-native-anchor-fallback", "backing");
      set("--native-menu-x", a.left);
      set("--native-menu-y", a.top);
      set("--native-menu-w", a.width);
      set("--native-menu-h", a.height);
      return;
    }
    // Read the original cap at the current viewport. Capturing its resolved
    // value once would permanently retain a narrow-window cap after resize.
    menu.removeAttribute("data-native-anchor-fallback");
    const original = win.getComputedStyle(menu),
      originalMax = Number.parseFloat(original.maxWidth),
      originalMaxH = Number.parseFloat(original.maxHeight);
    menu.setAttribute("data-native-anchor-fallback", "menu");
    if (options.side === "submenu")
      menu.setAttribute("data-native-submenu-fallback", "");
    const minTop =
      options.minTop ??
      (menu.hasAttribute("data-context-menu") ||
      menu.hasAttribute("data-contextual")
        ? 12
        : Math.max(
            12,
            Number.parseFloat(
              win
                .getComputedStyle(menu)
                .getPropertyValue("--dsh-frame-overlay-top"),
            ) || 12,
          ));
    const maxW = Math.max(0, size.width - 24),
      maxH = Math.max(0, size.height - minTop - 12);
    set(
      "--native-menu-max-w",
      options.page
        ? maxW
        : Math.min(maxW, Number.isFinite(originalMax) ? originalMax : maxW),
    );
    set(
      "--native-menu-max-h",
      Math.min(maxH, Number.isFinite(originalMaxH) ? originalMaxH : maxH),
    );
    set("--native-menu-min-w", Math.min(a.width, maxW));
    const rect = menu.getBoundingClientRect();
    const placed = menuPlacement(a, rect.width, rect.height, size, {
      ...options,
      minTop,
    });
    set("--native-menu-x", placed.left);
    set("--native-menu-y", placed.top);
    // Backing geometry follows this placement without polling or observing our style writes.
    menu.dispatchEvent(new Event("native-menu-position"));
  };
  const schedule = () => {
    if (!stopped && !frame) frame = win.requestAnimationFrame(place);
  };
  const observer = new win.ResizeObserver(schedule);
  observer.observe(menu);
  observer.observe(anchor);
  // A bounded ancestor chain catches surrounding reflow as well as trigger resize.
  let parent = anchor.parentElement;
  for (let n = 0; parent && n < 8; n++, parent = parent.parentElement)
    observer.observe(parent);
  const mutations = new win.MutationObserver(schedule);
  mutations.observe(menu, {
    attributes: true,
    attributeFilter: [
      "data-submenu-layout",
      "data-anchor-side",
      "data-anchor-align",
      "data-match-anchor-width",
      "data-context-menu",
      "data-contextual",
    ],
  });
  doc.addEventListener("scroll", schedule, { capture: true, passive: true });
  win.addEventListener("resize", schedule);
  win.visualViewport?.addEventListener("resize", schedule);
  win.visualViewport?.addEventListener("scroll", schedule);
  anchor.addEventListener("native-menu-position", place);
  place();
  return () => {
    if (stopped) return;
    stopped = true;
    if (frame) win.cancelAnimationFrame(frame);
    observer.disconnect();
    mutations.disconnect();
    doc.removeEventListener("scroll", schedule, true);
    win.removeEventListener("resize", schedule);
    win.visualViewport?.removeEventListener("resize", schedule);
    win.visualViewport?.removeEventListener("scroll", schedule);
    anchor.removeEventListener("native-menu-position", place);
    for (const [key, [value, priority]] of previous) {
      if (value) menu.style.setProperty(key, value, priority);
      else menu.style.removeProperty(key);
    }
    if (oldAttribute === null)
      menu.removeAttribute("data-native-anchor-fallback");
    else menu.setAttribute("data-native-anchor-fallback", oldAttribute);
    if (oldSubmenu === null)
      menu.removeAttribute("data-native-submenu-fallback");
    else menu.setAttribute("data-native-submenu-fallback", oldSubmenu);
  };
}
