package main

import (
	"fmt"
	"github.com/egoist/mygo/ui"
	"time"
)

func (a *app) sidebarView(c *ui.Context) {
	// The macOS sidebar material in this build composites lighter (#303033)
	// than the reference's rendered sidebar (#1b1b1c). Fill the column with the
	// reference color so the content and its dividers sit on the same surface.
	background := a.colors.Sidebar
	ui.Column(c).Width(280).FillHeight().Shrink(0).Background(background).Draw(func(_ *ui.Painter, r ui.Rect) { a.sidebarLayoutWidth = r.W; a.qaLayout("sidebar", r) }).BorderWidth(0, .5, 0, 0).BorderColor(a.theme.Border).Padding(6, 12, 12).Gap(0).Children(func() {
		// The caption control floats over the brand row, as the reference's
		// 52px top strip does; consuming a flow row here pushed the brand and
		// New Session button 30px below the original.
		ui.Row(c).Absolute().Top(18).Right(8).Size(28, 28).AlignItems(ui.Center).DragWindow().Children(func() {
			ui.Spacer(c)
			if ui.ButtonBase(c).Label("收起侧栏").Tooltip("收起侧栏 ⌘B").Padding(4).Children(func() { icon(c, "panel-left-outline", 16).TextColor(a.theme.TextMuted) }).Clicked() {
				a.sidebar = false
			}
		})
		ui.Row(c).Height(60).AlignItems(ui.Center).Padding(0, 0, 0, 8).Draw(func(_ *ui.Painter, r ui.Rect) { a.qaLayout("brand", r) }).Children(func() {
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
		newSession := ui.ButtonBase(c).Height(38).Margin(0, 0, 12, 0).Padding(0, 10).Gap(8).Radius(10).Background(newBg).Border(1, a.theme.Border).Label(label).Disabled(a.connected && !a.can("createSession")).Justify(ui.Center).Children(func() { icon(c, "new-chat-outline", 16); ui.Text(c, label).FontSize(11.5) })
		newSession.Draw(func(_ *ui.Painter, r ui.Rect) { a.qaLayout("new-session", r) })
		if newSession.Clicked() {
			a.applyNewSessionIntent()
		}
		rows := a.sidebarListRows()
		// Opening a Session programmatically (restore, deep link, search pick)
		// must bring its row into view the way the reference list does; the
		// click path already has the row on screen.
		if a.sessionID != "" && a.revealedSession != a.sessionID {
			for i, row := range rows {
				if row.Kind == "session" && row.Session.ID == a.sessionID {
					a.sessionList.ScrollIntoView(i)
					a.revealedSession = a.sessionID
					break
				}
			}
		}
		if a.searchOpen {
			a.sidebarNavArea(c)
			a.searchHeader(c, rows)
		} else {
			a.sessionList.Selected = nil
		}
		a.sessionList.Key = func(i int) any { return rows[i].Key }
		ui.List(c, &a.sessionList, len(rows), func(i int) {
			r := rows[i]
			switch r.Kind {
			case "gap":
				ui.Row(c).Height(8)
			case "header":
				a.sidebarSectionHeader(c)
			case "nav":
				a.sidebarNavRow(c, r.Key)
			case "workspace":
				expanded, ok := a.uiPrefs.Expanded[r.Workspace.ID]
				if !ok {
					expanded = r.Workspace.ID == a.workspaceID
				}
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
					ui.Text(c, r.Workspace.Name).FontSize(11.5).Grow(1).SingleLine().Ellipsis("…")
					if row.Hovered() && a.workspaceRowOffersNewSession(r.Workspace) {
						// As in the original row: the create button rides the
						// trailing edge on hover only, at the Workspace's own
						// access, and never while the row is being renamed.
						name := r.Workspace.Name
						if ui.ButtonBase(c).Label("在「" + name + "」中新建会话").Tooltip("新会话 ⌘N").Padding(5).Children(func() {
							icon(c, "new-chat-outline", 14).TextColor(a.theme.TextMuted)
						}).Clicked() {
							a.startWorkspaceSession(r.Workspace)
						}
					}
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
					ui.Text(c, fmt.Sprintf("展开其余 %d 个会话", r.Count)).FontSize(11.5).TextColor(a.theme.TextMuted)
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
			ui.Text(c, a.workspaceHintLabel()).FontSize(11.5).TextColor(a.theme.TextMuted).Padding(8).Wrap()
		}
		ui.Row(c).Padding(8).Gap(7).Children(func() {
			backing := indicatorBacking{Color: a.colors.Sidebar}
			if c.Vibrancy() {
				backing = a.indicatorSidebarBacking(c)
			}
			stateIndicator(c, a.busy, a.epoch, a.theme.TextMuted, &a.metrics, backing)
			ui.Text(c, a.status).FontSize(11.5).TextColor(a.theme.TextMuted).Grow(1).SingleLine().Ellipsis("…")
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
	b := ui.ButtonBase(c).Height(32).FillWidth().Margin(0, 0, 2, 0).Padding(0, 8).Gap(8).Radius(7).Justify(ui.Start).Label(label).Children(func() { icon(c, name, 16); ui.Text(c, label) })
	if a.compat != nil && a.compatPlacement == "main" && ((label == "插件" && a.compatPage == "plugins") || (label == "自动化任务" && a.compatPage == "automation")) {
		b.Background(a.colors.Selected)
	}
	b.Draw(func(_ *ui.Painter, r ui.Rect) { a.qaLayout("nav-"+label, r) })
	if b.Clicked() && fn != nil {
		fn()
	}
	return b
}
func (a *app) sessionRow(c *ui.Context, r sidebarRow) {
	s := r.Session
	host := a.hostID
	scope := a.accountScope
	row := ui.Row(c.Key(r.Key)).Height(32).Padding(0, 12+float32(r.Depth)*12).Gap(7).Radius(8).AlignItems(ui.Center).Label("会话 " + s.Title)
	hoverWorkspace := ""
	if s.WorkspaceID != "" {
		for _, w := range a.workspaces {
			if w.ID == s.WorkspaceID {
				hoverWorkspace = w.Name
				break
			}
		}
	}
	hoverOpen := a.foldState("hover:"+s.ID, false)
	*hoverOpen = row.Hovered()
	if *hoverOpen {
		a.fetchSessionPreview(s.ID)
	}
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
		ui.Text(c, s.Title).Grow(1).MinWidth(0).SingleLine().Ellipsis("…").FontSize(11.5).FontWeight(300)
		if count := a.scheduleCounts[s.ID]; count > 0 {
			open := a.foldState("schedules:"+s.ID, false)
			badge := ui.ButtonBase(c).Padding(0).Gap(2).AlignItems(ui.Center).Label(fmt.Sprintf("%d 个定时任务", count)).Children(func() {
				icon(c, "alarm-clock-outline", 12).TextColor(a.theme.TextMuted)
				if count > 1 {
					ui.Text(c, fmt.Sprint(count)).FontSize(10).TextColor(a.theme.TextMuted)
				}
			})
			ui.PopoverBase(c, badge, open, func(panel ui.Element) {
				panel.Width(260).Padding(10).Radius(10).Background(a.colors.Popup).Border(1, a.theme.Border).Gap(6)
				for _, record := range a.schedules {
					if record.SessionID != s.ID {
						continue
					}
					record := record
					row := ui.ButtonBase(c).FillWidth().Height(28).Padding(0, 4).Gap(8).AlignItems(ui.Center).Label("定时任务 " + record.ID)
					row.Children(func() {
						icon(c, "alarm-clock-outline", 13).TextColor(a.colors.Tertiary)
						label := record.Title
						if label == "" {
							label = record.ID
						}
						ui.Text(c, label).FontSize(12).TextColor(a.colors.Secondary).SingleLine().Ellipsis("…").Grow(1)
					})
					if row.Clicked() {
						a.scheduleDetail = &record
						a.scheduleDetailOpen = true
						*open = false
					}
				}
			})
		}
		if row.Hovered() {
			if !s.Pinned && a.can("pinSession") {
				if ui.ButtonBase(c).Label("置顶会话 " + s.ID).Tooltip("置顶").Padding(2).Children(func() {
					icon(c, "pin-outline", 14).TextColor(a.theme.TextMuted)
				}).Clicked() {
					a.mutate("pinSession", map[string]any{"sessionId": s.ID}, nil)
				}
			}
			if a.can("renameSession") {
				if ui.ButtonBase(c).Label("重命名会话 " + s.ID).Tooltip("重命名").Padding(2).Children(func() {
					icon(c, "edit-outline", 14).TextColor(a.theme.TextMuted)
				}).Clicked() {
					a.renameID, a.renameHost, a.renameScope, a.renameTitle = s.ID, a.hostID, a.accountScope, s.Title
				}
			}
			if a.can("archiveSession") {
				if ui.ButtonBase(c).Label("归档会话 " + s.ID).Tooltip("归档").Padding(2).Children(func() {
					icon(c, "archive-outline", 14).TextColor(a.theme.TextMuted)
				}).Clicked() {
					a.setSessionArchived(s, true)
				}
			}
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
	if *hoverOpen {
		ui.PopoverBase(c, row, hoverOpen, func(panel ui.Element) {
			panel.Width(260).Padding(12).Radius(10).Background(a.colors.Popup).Border(1, a.theme.Border).Gap(4)
			ui.Text(c, maskSecrets(s.Title)).FontSize(12).FontWeight(500).SingleLine().Ellipsis("…")
			if hoverWorkspace != "" {
				ui.Text(c, hoverWorkspace).FontSize(11).TextColor(a.colors.Caption).SingleLine().Ellipsis("…")
			}
			if preview := a.sessionPreviews[s.ID]; preview != "" {
				ui.Text(c, maskSecrets(preview)).FontSize(11).TextColor(a.colors.Secondary).Wrap()
			}
			status := "空闲"
			if s.Running {
				status = "正在运行"
			}
			if s.UpdatedAt > 0 {
				status += " · " + relativeTime(s.UpdatedAt, time.Now())
			}
			ui.Text(c, status).FontSize(11).TextColor(a.colors.Caption)
		})
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
