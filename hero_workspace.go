package main

import (
	"strings"

	"github.com/egoist/mygo/ui"
)

// heroWorkspace is the Workspace the blank-Session hero names: the selected
// one, or the owner of the selected Session when navigation only knows the
// Session. The boolean is false when no Workspace resolves, which leaves the
// chip in its placeholder state.
func (a *app) heroWorkspace() (workspace, bool) {
	id := a.workspaceID
	if id == "" && a.sessionID != "" {
		id = a.sessionOwners()[a.sessionID]
	}
	if id == "" {
		return workspace{}, false
	}
	for _, w := range a.workspaces {
		if w.ID == id {
			return w, true
		}
	}
	return workspace{}, false
}

// heroWorkspaceLabel is the chip and menu title: the Workspace's own name, or
// the directory's base name when the name only repeats the automatic path.
func heroWorkspaceLabel(w workspace) string {
	if name := strings.TrimSpace(w.Name); name != "" && name != w.Path {
		return name
	}
	path := strings.TrimRight(w.Path, "/")
	if index := strings.LastIndex(path, "/"); index >= 0 && index+1 < len(path) {
		return path[index+1:]
	}
	if path != "" {
		return path
	}
	return "未命名工作区"
}

// heroWorkspaceRow draws the blank Session's Workspace seat above the composer.
// The original client keeps the Workspace switchable until the first message:
// picking another one moves the New Session flow to that Workspace's blank
// Session, reusing it or creating one, so the switch never leaves two rows.
func (a *app) heroWorkspaceRow(c *ui.Context) {
	// The preset roster is a Host read, so the seat asks for it on the frame
	// that draws it. Both seats live in this row, as the original hero's
	// workspace chip and agent-preset chip do.
	a.ensureHeroPresets()
	ui.Row(c).FillWidth().Padding(0, 12).Gap(4).AlignItems(ui.Center).Children(func() {
		if a.connected && !a.demo {
			a.heroWorkspaceChip(c)
		}
		a.heroPresetChip(c)
	})
}

// heroWorkspaceChip is the Workspace seat itself: the switchable half of the
// row, which the preset chip sits beside.
func (a *app) heroWorkspaceChip(c *ui.Context) {
	w, known := a.heroWorkspace()
	label := "选择工作区"
	if known {
		label = heroWorkspaceLabel(w)
	}
	ui.Row(c).AlignItems(ui.Center).Children(func() {
		chip := ui.ButtonBase(c).Label("选择工作区").Height(28).Padding(0, 8).Gap(4).Radius(8)
		chip.Tooltip("切换新会话所在的工作区")
		chip.Children(func() {
			glyph := "folder-close"
			if known {
				glyph = "folder-open-outline"
			}
			icon(c, glyph, 16).TextColor(a.theme.Text)
			ui.Text(c, label).FontSize(13).FontWeight(500).MinWidth(0).SingleLine().Ellipsis("…").MaxWidth(300)
			icon(c, "chevron-down-outline", 12).TextColor(a.theme.TextMuted)
		})
		if chip.Hovered() {
			chip.Background(a.colors.RowHover)
		}
		selected := ""
		if known {
			selected = w.ID
		}
		chip.Menu(func(m *ui.Menu) { a.heroWorkspaceMenu(m, selected) })
	})
}

// heroWorkspaceMenu lists the Workspaces plus the one add action, and applies
// the same capability gates as the sidebar's Workspace controls.
func (a *app) heroWorkspaceMenu(m *ui.Menu, selected string) {
	names := map[string]int{}
	for _, w := range a.workspaces {
		names[heroWorkspaceLabel(w)]++
	}
	for _, w := range a.workspaces {
		label := heroWorkspaceLabel(w)
		item := m.Item(label).Radio(w.ID == selected)
		if names[label] > 1 {
			item.Subtitle(w.Path)
		} else {
			item.Tooltip(w.Path)
		}
		if !a.can("createSession") {
			item.Disabled(true).Tooltip(a.actionBlockedDetail("createSession", "当前连接不允许新建会话。"))
			continue
		}
		if item.Chosen() && w.ID != selected {
			a.chooseHeroWorkspace(w)
		}
	}
	if len(a.workspaces) > 0 {
		m.Separator()
	}
	add := m.Item("添加工作区…")
	if !a.can("createWorkspace") {
		add.Disabled(true).Tooltip(a.actionBlockedDetail("createWorkspace", "当前连接不允许新建工作区。"))
	} else if add.Chosen() {
		a.openWorkspaceCreate()
	}
}

// chooseHeroWorkspace moves the New Session flow to w's blank Session. The
// selected Workspace already shows that blank, so choosing it changes nothing.
func (a *app) chooseHeroWorkspace(w workspace) {
	if w.ID == "" || w.ID == a.workspaceID {
		return
	}
	// The row the request selects lives in that Workspace's sidebar group, so
	// reveal the group. This is a navigation nudge, not a saved view preference:
	// the reader's stored collapse choice stays as they left it.
	if a.uiPrefs.Expanded == nil {
		a.uiPrefs.Expanded = map[string]bool{}
	}
	a.uiPrefs.Expanded[w.ID] = true
	a.createSessionIn(w.ID)
}
