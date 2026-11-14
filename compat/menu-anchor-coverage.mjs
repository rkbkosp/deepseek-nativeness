// Current packaged CSS consumers. Keep this inventory exhaustive against the metafile.
export const anchorConsumers = {
  "packages/client/ui-primitives/src/Menu.module.css": {
    owner: "Menu / useMenuSubmenu",
    refs: "listRef ↔ anchorRef ?? rootRef; panelRef ↔ listRef + trigger",
    side: "bottom by default; top/right and nested side/page supported",
    align: "prop start/end",
    gap: 4,
    GUI8: "shared fallback hook",
    patch: "unchanged",
  },
  "packages/client/ui-primitives/src/MenuSurface.module.css": {
    owner: "MenuSurface Darwin backing",
    refs: "backingRef ↔ captured surfaceRef",
    side: "same rect as surface",
    align: "same rect",
    gap: 0,
    GUI8: "bounded backing hook",
    patch: "unchanged",
  },
  "packages/client/ui-model-selection/src/client/ModelSelect.module.css": {
    owner: "ModelSelect direct MenuSurface",
    refs: "menuRef ↔ triggerRef",
    side: "top",
    align: "end",
    gap: 8,
    GUI8: "embedded native model-menu has explicit absolute viewport override; nonembedded reuse lacks fallback",
    patch:
      "add same bounded hook only for nonembedded menus; leave embedded override",
  },
  "packages/client/ui-plugin-manager/src/client/PluginManagerPage.module.css": {
    owner: "InstallSpecForm registry fieldset",
    refs: "registryPanelRef ↔ registryToggleRef",
    side: "bottom",
    align: "end",
    gap: 6,
    minTop: 12,
    GUI8: "independent registry portal lacks fallback",
    patch:
      "add same bounded placement hook; do not alter form or installation business",
  },
  "packages/client/ui-schedule/src/client/PickerPopover.module.css": {
    owner: "PickerPopover used by ClockPicker / DatePicker",
    refs: "panelRef ↔ anchorRef",
    side: "bottom",
    align: "start",
    gap: 4,
    minTop: 12,
    GUI8: "independent timing portal lacks fallback",
    patch:
      "add same bounded hook; retain dialog keyboard/dismissal and timing behavior",
  },
  "packages/client/ui-schedule/src/client/TaskMenu.module.css": {
    owner: "TaskMenu via RuleSelectRow: target/project/repeat/timezone",
    refs: "listRef ↔ rootRef",
    side: "bottom",
    align: "prop start/end (rule fields use end)",
    gap: 4,
    minTop: 12,
    GUI8: "independent schedule-local Menu copy lacks fallback",
    patch:
      "add same bounded hook; pinned header/search and keyboard remain source-owned",
  },
  "compat/src/shell.css": {
    owner: "native embedded model-menu reset",
    refs: "none",
    side: "explicit absolute viewport",
    align: "native viewport",
    gap: 0,
    GUI8: "position-anchor:auto intentionally disables anchoring",
    patch: "unchanged, not an anchor dependency",
  },
};

// Inline declarations either drive one of the classified CSS consumers or
// feature-detect support. They do not add a separate untracked portal owner.
export const anchorBindings = {
  "compat/src/menu-anchor-geometry.ts": "capability detection only",
  "packages/client/ui-primitives/src/Menu.tsx":
    "shared main/submenu CSS owner and external-trigger anchor assignment",
  "packages/client/ui-primitives/src/MenuSurface.tsx":
    "shared material/backing CSS owner variables",
  "packages/client/ui-model-selection/src/client/ModelSelect.tsx":
    "direct model menu/trigger variables",
  "packages/client/ui-plugin-manager/src/client/PluginManagerPage.tsx":
    "registry fieldset/trigger declarations",
  "packages/client/ui-schedule/src/client/TaskEditorFields.tsx":
    "timing trigger refs/names forwarded into DatePicker and ClockPicker",
  "packages/client/ui-schedule/src/client/DatePicker.tsx":
    "forwards refs/names to classified PickerPopover",
  "packages/client/ui-schedule/src/client/ClockPicker.tsx":
    "forwards refs/names to classified PickerPopover",
  "packages/client/ui-schedule/src/client/PickerPopover.tsx":
    "timing panel position-anchor declaration",
  "packages/client/ui-schedule/src/client/TaskMenu.tsx":
    "independent rule menu trigger/panel declarations",
};
