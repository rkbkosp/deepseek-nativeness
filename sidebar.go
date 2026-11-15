package main

import (
	"fmt"
	"github.com/egoist/mygo/ui"
	"time"
)

func (a *app) sidebarView(c *ui.Context) {
	background := a.colors.Sidebar
	if c.Vibrancy() {
		background = ui.Transparent
	}
	ui.Column(c).Width(280).FillHeight().Shrink(0).Background(background).Draw(func(_ *ui.Painter, r ui.Rect) { a.sidebarLayoutWidth = r.W }).BorderWidth(0, .5, 0, 0).BorderColor(a.theme.Border).Padding(10, 12, 12).Gap(5).Children(func() {
		ui.Row(c).Height(30).Margin(0, 0, 8, 0).AlignItems(ui.Center).DragWindow().Children(func() {
			ui.Spacer(c)
			if ui.ButtonBase(c).Label("收起侧栏").Tooltip("收起侧栏 ⌘B").Padding(4).Children(func() { icon(c, "panel-left-outline", 16).TextColor(a.theme.TextMuted) }).Clicked() {
				a.sidebar = false
			}
		})
		ui.Row(c).AlignItems(ui.Center).Padding(4, 6, 14).Children(func() {
			logo := brand
			if a.theme.Dark {
				logo = brandDark
			}
			ui.Image(c, logo).Width(190).Height(25).Label("DeepSeek Harness")
		})
		label := a.newSessionLabel()
		newBg := a.theme.Surface
		if c.Vibrancy() {
			if a.theme.Dark {
				newBg = ui.RGBA(255, 255, 255, .15)
			} else {
				newBg = ui.RGBA(255, 255, 255, .55)
			}
		}
		if ui.ButtonBase(c).Height(38).Padding(0, 10).Gap(8).Radius(10).Background(newBg).Border(1, a.theme.Border).Label(label).Disabled(a.connected && !a.can("createSession")).Justify(ui.Center).Children(func() { icon(c, "new-chat-outline", 16); ui.Text(c, label) }).Clicked() {
			a.applyNewSessionIntent()
		}
		a.navButton(c, "插件", "plugin-pinwheel-outline", func() { a.openCompat("plugins") }).Disabled(!a.connected).Tooltip("管理工作主机上的插件")
		a.navButton(c, "自动化任务", "alarm-clock-outline", func() { a.openCompat("automation") }).Disabled(!a.can("scheduleCatalog"))
		ui.ButtonBase(c).Height(32).Padding(0, 8).Gap(8).Justify(ui.Start).Label("更多").Children(func() { icon(c, "apps-add-compact-outline", 16); ui.Text(c, "更多") }).Menu(func(m *ui.Menu) {
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
		ui.Row(c).Padding(16, 8, 3).Gap(8).AlignItems(ui.Center).Children(func() {
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
		rows := a.sidebarRows()
		if a.searchOpen {
			a.searchView(c, rows)
		} else {
			a.sessionList.Selected = nil
		}
		a.sessionList.Key = func(i int) any { return rows[i].Key }
		ui.List(c, &a.sessionList, len(rows), func(i int) {
			r := rows[i]
			switch r.Kind {
			case "workspace":
				expanded, ok := a.uiPrefs.Expanded[r.Workspace.ID]
				expanded = !ok || expanded
				host, scope := a.hostID, a.accountScope
				rename := a.activeWorkspaceRename()
				editing := rename != nil && rename.WorkspaceID == r.Workspace.ID
				row := ui.Row(c.Key(r.Key)).Height(32).Padding(0, 8+float32(r.Depth)*12).Gap(6).Radius(7).AlignItems(ui.Center)
				if row.Hovered() && !editing {
					row.Background(a.colors.RowHover)
				}
				row.Children(func() {
					name := "folder-open-outline"
					color := a.theme.TextMuted
					if r.Workspace.ID == a.workspaceID {
						color = a.theme.Accent
					}
					if row.Hovered() && !editing {
						name = "chevron-right-outline"
						if expanded {
							name = "chevron-down-outline"
						}
					}
					icon(c, name, 16).TextColor(color)
					if editing {
						// Inline rename: Enter saves, the ✕ abandons it. The row
						// itself keeps drawing the Workspace it is renaming.
						input := ui.TextInput(c, &rename.Title).Label("工作区名称").Placeholder("工作区名称").AutoFocus().Grow(1)
						if input.Submitted() {
							a.commitWorkspaceRename()
						}
						if ui.ButtonBase(c).Label("取消重命名").Padding(2).Children(func() { icon(c, "close-outline", 14).TextColor(a.theme.TextMuted) }).Clicked() {
							a.cancelWorkspaceRename()
						}
						return
					}
					ui.Text(c, r.Workspace.Name).FontSize(14).Grow(1).SingleLine().Ellipsis("…")
				})
				if !editing && row.Clicked() {
					a.uiPrefs.Expanded[r.Workspace.ID] = !expanded
					a.savePreferences()
				}
				row.ContextMenu(func(m *ui.Menu) {
					if host == a.hostID && scope == a.accountScope {
						a.workspaceMenu(m, r.Workspace)
					}
				})
			case "more":
				if ui.ButtonBase(c.Key(r.Key)).Height(30).Padding(0, 30+float32(r.Depth)*12).Label("展开更多 " + r.Workspace.Name).Children(func() {
					ui.Text(c, fmt.Sprintf("展开更多 (%d)", r.Count)).FontSize(12).TextColor(a.theme.TextMuted)
				}).Clicked() {
					a.watermarks[r.Workspace.ID] += 50
					if a.watermarks[r.Workspace.ID] < 55 {
						a.watermarks[r.Workspace.ID] = 55
					}
				}
			case "session":
				a.sessionRow(c, r)
			}
		}).Grow(1).Gap(2)
		if len(rows) == 0 {
			ui.Text(c, a.workspaceHintLabel()).FontSize(12).TextColor(a.theme.TextMuted).Padding(8).Wrap()
		}
		ui.Row(c).Padding(8).Gap(7).Children(func() {
			backing := indicatorBacking{Color: a.colors.Sidebar}
			if c.Vibrancy() {
				backing = a.indicatorSidebarBacking(c)
			}
			stateIndicator(c, a.busy, a.epoch, a.theme.TextMuted, &a.metrics, backing)
			ui.Text(c, a.status).FontSize(12).TextColor(a.theme.TextMuted).Grow(1).SingleLine().Ellipsis("…")
		})
		if len(a.mutations) > 0 {
			if ui.Button(c, "核对未确认操作").Clicked() {
				a.mutationReview = true
				a.mutationAcknowledge = false
			}
		}
		ui.Row(c).Height(34).Gap(6).Children(func() {
			a.navButton(c, a.hostNavLabel(), "globe-outline", func() {
				a.closeCompat()
				a.closeWeb()
				if a.localMode() {
					// There is no Remote login or device list to fall back to;
					// the Host facts live on the settings surface.
					a.settingsOpen = true
					return
				}
				a.connectionOpen = !a.connectionOpen
				if a.connectionOpen {
					a.fetchDevices()
				}
			}).Grow(1)
			if ui.ButtonBase(c).Label("设置").Padding(6).Children(func() { icon(c, "settings-outline", 18).TextColor(a.theme.TextMuted) }).Clicked() {
				a.settingsOpen = true
			}
		})
	})
	a.renameView(c)
}
func (a *app) navButton(c *ui.Context, label, name string, fn func()) ui.Element {
	b := ui.ButtonBase(c).Height(32).Padding(0, 8).Gap(8).Radius(7).Justify(ui.Start).Label(label).Children(func() { icon(c, name, 16); ui.Text(c, label) })
	if a.compat != nil && a.compatPlacement == "main" && ((label == "插件" && a.compatPage == "plugins") || (label == "自动化任务" && a.compatPage == "automation")) {
		b.Background(a.colors.Selected)
	}
	if b.Clicked() && fn != nil {
		fn()
	}
	return b
}
func (a *app) sessionRow(c *ui.Context, r sidebarRow) {
	s := r.Session
	host := a.hostID
	scope := a.accountScope
	row := ui.Row(c.Key(r.Key)).Height(34).Padding(0, 12+float32(r.Depth)*12).Gap(7).Radius(8).AlignItems(ui.Center).Label("会话 " + s.Title)
	backing := indicatorBacking{Color: a.colors.Sidebar}
	if c.Vibrancy() {
		backing = a.indicatorSidebarBacking(c)
	}
	if s.ID == a.sessionID {
		backing = indicatorBacking{Color: a.colors.Selected}
		row.Background(a.colors.Selected)
	} else if row.Hovered() {
		backing = indicatorBacking{Color: a.colors.RowHover}
		row.Background(a.colors.RowHover)
	}
	row.Children(func() {
		if s.Running {
			stateIndicator(c, true, a.epoch, a.theme.TextMuted, &a.metrics, backing)
		} else {
			ui.Box(c).Size(14, 14).Shrink(0)
		}
		ui.Text(c, s.Title).Grow(1).MinWidth(0).SingleLine().Ellipsis("…").FontSize(14).FontWeight(300)
		if row.Hovered() {
			ui.ButtonBase(c).Label("会话菜单 " + s.ID).Padding(2).Children(func() { icon(c, "ellipsis-outline", 15).TextColor(a.theme.TextMuted) }).Menu(func(m *ui.Menu) {
				if host == a.hostID {
					a.sessionMenu(c, m, s)
				}
			})
		} else if s.Pinned {
			icon(c, "pin-fill", 12).TextColor(a.theme.TextMuted)
		} else {
			ui.Text(c, relativeTime(s.UpdatedAt, time.Now())).FontSize(11).TextColor(a.theme.TextMuted)
		}
	})
	row.ContextMenu(func(m *ui.Menu) {
		if host == a.hostID && scope == a.accountScope {
			a.sessionMenu(c, m, s)
		}
	})
	if row.Clicked() {
		a.chooseSession(s)
	}
}
func (a *app) sidebarViewMenu(m *ui.Menu) {
	m.Item("分组方式").Disabled(true)
	for _, v := range []struct{ key, label string }{{"workspace", "按工作区"}, {"tree", "按工作区树"}, {"flat", "单列表"}} {
		if m.Item(v.label).Radio(a.uiPrefs.GroupBy == v.key).Chosen() {
			a.uiPrefs.GroupBy = v.key
			a.savePreferences()
		}
	}
	m.Separator()
	m.Item("排序方式").Disabled(true)
	for _, v := range []struct{ key, label string }{{"manual", "手动排序"}, {"updated", "最近更新"}} {
		if m.Item(v.label).Radio(a.uiPrefs.OrderBy == v.key).Chosen() {
			a.setSidebarOrder(v.key)
			a.savePreferences()
		}
	}
	m.Separator()
	m.Item("筛选会话").Disabled(true)
	for _, v := range []struct{ key, label string }{{"default", "隐藏已归档"}, {"all", "全部对话（显示已归档）"}, {"only", "仅显示已归档"}} {
		if m.Item(v.label).Radio(a.uiPrefs.Archived == v.key).Chosen() {
			a.uiPrefs.Archived = v.key
			a.savePreferences()
		}
	}
}
