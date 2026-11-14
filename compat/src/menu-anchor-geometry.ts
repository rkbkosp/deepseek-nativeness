/** Narrow placement substitute for the frozen menu's CSS anchors. No menu behavior lives here. */
declare const NATIVE_DSH_FORCE_MENU_ANCHOR_FALLBACK: boolean;
export interface MenuRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}
export interface PlacementOptions {
  side?: "top" | "bottom" | "right" | "submenu";
  align?: "start" | "end";
  page?: boolean;
  rowOffset?: number;
  minTop?: number;
  gap?: number;
}
export function supportsMenuAnchors(
  css: Pick<typeof CSS, "supports"> | undefined = globalThis.CSS,
): boolean {
  // Compile-time QA define only: no runtime preference, URL flag or OS feature
  // override is exposed. Production always compiles this branch to false.
  if (
    typeof NATIVE_DSH_FORCE_MENU_ANCHOR_FALLBACK !== "undefined" &&
    NATIVE_DSH_FORCE_MENU_ANCHOR_FALLBACK
  )
    return false;
  return (
    !!css &&
    [
      ["position-anchor", "--native-menu"],
      ["top", "anchor(bottom)"],
      ["width", "anchor-size(width)"],
      ["position-try-fallbacks", "flip-block"],
    ].every(([key, value]) => css.supports(key, value))
  );
}
export function menuPlacement(
  anchor: MenuRect,
  width: number,
  height: number,
  viewport: { width: number; height: number },
  options: PlacementOptions = {},
) {
  const minTop = Math.max(12, options.minTop ?? 12),
    right = viewport.width - 12,
    bottom = viewport.height - 12;
  const w = Math.min(width, Math.max(0, viewport.width - 24)),
    h = Math.min(height, Math.max(0, bottom - minTop));
  const gap = options.gap ?? 4;
  let x = options.align === "end" ? anchor.right - w : anchor.left,
    y = anchor.bottom + gap;
  if (options.side === "top") {
    y = anchor.top - gap - h;
    if (y < minTop && anchor.bottom + gap + h <= bottom)
      y = anchor.bottom + gap;
  } else if (options.side === "right" || options.side === "submenu") {
    x = anchor.right + gap;
    y = anchor.top + (options.rowOffset ?? 0);
    if (x + w > right && anchor.left - gap - w >= 12) x = anchor.left - gap - w;
    if (options.page) {
      x = anchor.left;
      y = anchor.top;
    }
  } else if (y + h > bottom && anchor.top - gap - h >= minTop)
    y = anchor.top - gap - h;
  x = Math.max(12, Math.min(x, Math.max(12, right - w)));
  y = Math.max(minTop, Math.min(y, Math.max(minTop, bottom - h)));
  return {
    left: x,
    top: y,
    maxWidth: Math.max(0, viewport.width - 24),
    maxHeight: Math.max(0, bottom - minTop),
  };
}
