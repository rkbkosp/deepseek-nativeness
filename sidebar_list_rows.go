package main

import (
	"github.com/egoist/mygo/ui"
)

// sidebarListRows is the scrollable body the reference draws: the three global
// navigation rows and the Workspace section header sit in the same scroll
// region as the Session tree, so scrolling to a Session pushes them out of
// view. sidebarRows stays the testable tree-only projection.
func (a *app) sidebarListRows() []sidebarRow {
	out := []sidebarRow{
		{Key: "nav:plugins", Kind: "nav"},
		{Key: "nav:automation", Kind: "nav"},
		{Key: "nav:more", Kind: "nav"},
	}
	if a.searchOpen {
		// The inline search field replaces the nav and section header; the
		// reference shows neither while the field is open.
		return a.sidebarRows()
	}
	out = append(out, sidebarRow{Key: "gap:nav", Kind: "gap"})
	out = append(out, sidebarRow{Key: "header", Kind: "header"})
	return append(out, a.sidebarRows()...)
}

// sidebarNavArea keeps the three primary destinations above the inline search
// field, the way the reference sidebar stacks them.
func (a *app) sidebarNavArea(c *ui.Context) {
	ui.Column(c).FillWidth().Gap(8).Margin(0, 0, 8, 0).Children(func() {
		for _, key := range []string{"nav:plugins", "nav:automation", "nav:more"} {
			a.sidebarNavRow(c, key)
		}
	})
}

func (a *app) sidebarNavRow(c *ui.Context, key string) {
	a.sidebarNavRowHeight(c, key, 32)
}

func (a *app) sidebarNavRowHeight(c *ui.Context, key string, height float32) {
	row := ui.Row(c.Key(key)).Height(height).FillWidth().AlignItems(ui.Center)
	row.Children(func() {
		switch key {
		case "nav:plugins":
			a.navButton(c, "插件", "plugin-pinwheel-outline", func() { a.openCompat("plugins") }).Disabled(!a.connected).Tooltip("管理工作主机上的插件")
		case "nav:automation":
			a.navButton(c, "自动化任务", "alarm-clock-outline", func() { a.openCompat("automation") }).Disabled(!a.can("scheduleCatalog"))
		case "nav:more":
			a.moreNavButton(c)
		}
	})
}

func (a *app) moreNavButton(c *ui.Context) ui.Element {
	return ui.ButtonBase(c).Height(32).FillWidth().Padding(0, 8).Gap(8).Justify(ui.Start).Label("更多").Children(func() {
		icon(c, "apps-add-compact-outline", 16)
		ui.Text(c, "更多").FontSize(11.5)
	}).Menu(func(m *ui.Menu) {
		if m.Item("模型设置").Disabled(!a.can("listProviders")).Chosen() {
			a.openSettingsSection("models")
		}
		if m.Item("Agent 预设").Disabled(!a.can("listAgentPresets")).Chosen() {
			a.openSettingsSection("agent-presets")
		}
		if a.hostMenuItemVisible(hostMenuRemoteWeb) {
			if m.Item("Remote Web · 独立网页").Chosen() {
				a.openWeb()
			}
		}
		if a.hostMenuItemVisible(hostMenuRemoteConnection) {
			if m.Item("Remote 连接").Chosen() {
				a.closeCompat()
				a.closeWeb()
				a.connectionOpen = true
				a.fetchDevices()
			}
		}
		if m.Item("设置").Chosen() {
			a.settingsOpen = true
		}
	})
}

func (a *app) sidebarSectionHeader(c *ui.Context) {
	ui.Row(c).Height(36).Padding(0, 8, 3).Gap(8).AlignItems(ui.Center).Draw(func(_ *ui.Painter, r ui.Rect) { a.qaLayout("section", r) }).Children(func() {
		ui.Text(c, "工作区").FontSize(14).TextColor(a.theme.TextMuted).Grow(1)
		if ui.ButtonBase(c).Label("搜索会话").Tooltip(a.searchTooltip()).Children(func() { icon(c, "search-outline", 16).TextColor(a.theme.TextMuted) }).Clicked() {
			a.toggleSearch()
		}
		ui.ButtonBase(c).Label("视图选项").Tooltip(a.sidebarViewTooltip()).Children(func() { icon(c, a.sidebarViewIcon(), 16).TextColor(a.theme.TextMuted) }).Menu(a.sidebarViewMenu)
		addTip := "在主机上新建工作区"
		if reason := a.operationCaps["createWorkspace"].Reason; reason != "" {
			addTip = reason
		}
		if ui.ButtonBase(c).Label("添加工作区").Disabled(!a.can("createWorkspace")).Tooltip(addTip).Children(func() { icon(c, "plus-outline", 16).TextColor(a.theme.TextMuted) }).Clicked() {
			a.openWorkspaceCreate()
		}
	})
}
