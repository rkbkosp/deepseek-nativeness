package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"
)

// The session header's subagent surfaces, mirroring ui-subagent: a descendant
// count with its dropdown on a root Session's actions band, and a parent
// breadcrumb plus the same count on the lineage slot of a child Session.

// subagentModeLabel is the catalog address mode in the reader's language.
func subagentModeLabel(mode string) string {
	switch mode {
	case "continuable":
		return "可继续"
	case "one-shot", "oneshot":
		return "一次性"
	case "external":
		return "外部任务"
	}
	return ""
}

// subagentRowName is the row's display name; the catalog's label is published
// by the tool, so an empty one falls back to the plain noun the original uses.
func subagentRowName(entry subagentEntry) string {
	if name := strings.TrimSpace(entry.Label); name != "" {
		return name
	}
	return "子智能体"
}

// subagentRunning reports the child Session's live state. The catalog only
// names children, so the Session list is what knows whether one still runs.
func (a *app) subagentRunning(id string) (running, known bool) {
	for _, s := range a.sessions {
		if s.ID == id {
			return s.Running, true
		}
	}
	return false, false
}

// subagentElapsed formats the time a running child has been working, from the
// catalog's start stamp.
func subagentElapsed(createdAt float64, now time.Time) string {
	if createdAt <= 0 {
		return ""
	}
	elapsed := now.Sub(time.UnixMilli(int64(createdAt)))
	if elapsed < 0 {
		return ""
	}
	seconds := int(elapsed.Seconds())
	switch {
	case seconds < 60:
		return fmt.Sprintf("%d秒", seconds)
	case seconds < 3600:
		return fmt.Sprintf("%d分%d秒", seconds/60, seconds%60)
	}
	return fmt.Sprintf("%d小时%d分", seconds/3600, (seconds%3600)/60)
}

// subagentRowSubtitle joins the facts the original shows under a catalog row:
// activity, mode, and how long a running child has been at work.
func (a *app) subagentRowSubtitle(entry subagentEntry, now time.Time) string {
	parts := make([]string, 0, 3)
	if running, known := a.subagentRunning(entry.ID); known {
		if running {
			parts = append(parts, "正在运行")
			if elapsed := subagentElapsed(entry.CreatedAt, now); elapsed != "" {
				parts = append(parts, elapsed)
			}
		} else {
			parts = append(parts, "未运行")
		}
	}
	if mode := subagentModeLabel(entry.Mode); mode != "" {
		parts = append(parts, mode)
	}
	return strings.Join(parts, " · ")
}

// sessionParent resolves a child Session's lineage. The Session list carries
// both fields; a row with only `origin` still counts as a child.
func (a *app) sessionParent(id string) (parentID string, child bool) {
	for _, s := range a.sessions {
		if s.ID != id {
			continue
		}
		if s.ParentSessionID != "" {
			return s.ParentSessionID, true
		}
		return "", s.Origin == "subagent"
	}
	return "", false
}

// sessionTitle is the header's title for one Session, including the subagent
// label a child inherits while the Host reports the product name.
func (a *app) sessionTitle(id string) string {
	title := productName
	for _, s := range a.sessions {
		if s.ID == id {
			title = s.Title
			break
		}
	}
	if title == productName && a.subagentTitles != nil {
		if subagentTitle := a.subagentTitles[id]; subagentTitle != "" {
			title = subagentTitle
		}
	}
	if strings.TrimSpace(title) == "" {
		return productName
	}
	return title
}

// parentTitle resolves the breadcrumb's parent name without reading the
// parent's catalog, which also works while that catalog is unloaded.
func (a *app) parentTitle(id string) string {
	for _, s := range a.sessions {
		if s.ID == id && strings.TrimSpace(s.Title) != "" {
			return s.Title
		}
	}
	if a.subagentTitles != nil {
		if title := a.subagentTitles[id]; title != "" {
			return title
		}
	}
	return "上一级会话"
}

// subagentCountView draws the "N 个子智能体" trigger and its dropdown.
func (a *app) subagentCountView(c *ui.Context, entries []subagentEntry) {
	if len(entries) == 0 {
		return
	}
	running := 0
	for _, entry := range entries {
		if isRunning, _ := a.subagentRunning(entry.ID); isRunning {
			running++
		}
	}
	label := fmt.Sprintf("%d 个子智能体", len(entries))
	hint := label
	if running > 0 {
		hint = fmt.Sprintf("%d 个子智能体，正在运行", running)
	}
	button := ui.ButtonBase(c).Label(label).Height(28).Padding(3, 2).Gap(4).Radius(4).Tooltip(hint)
	button.Children(func() {
		color := a.colors.Tertiary
		if button.Hovered() {
			color = a.colors.Secondary
		}
		icon(c, "users-outline", 14).Shrink(0).TextColor(color)
		ui.Text(c, label).FontSize(12).FixedLineHeight(20).SingleLine().TextColor(color)
	})
	button.Menu(func(m *ui.Menu) { a.subagentCatalogMenu(m, entries) })
}

// subagentCatalogMenu lists the direct children; opening one keeps the label it
// was listed under, so the child header has a title even before its row loads.
func (a *app) subagentCatalogMenu(m *ui.Menu, entries []subagentEntry) {
	now := time.Now()
	for _, entry := range entries {
		if entry.ID == "" {
			continue
		}
		name := subagentRowName(entry)
		item := m.Item(name)
		if subtitle := a.subagentRowSubtitle(entry, now); subtitle != "" {
			item.Subtitle(subtitle)
		}
		if item.Chosen() {
			if a.subagentTitles == nil {
				a.subagentTitles = map[string]string{}
			}
			a.subagentTitles[entry.ID] = name
			a.openSession(entry.ID)
		}
	}
}

// headerSubagentVisible reports whether the actions band owns the count. A
// child Session leaves this band alone: its breadcrumb owns the same
// navigation, so the count belongs to the lineage slot there.
func (a *app) headerSubagentVisible() bool {
	if a.composer == nil {
		return false
	}
	if _, child := a.sessionParent(a.sessionID); child {
		return false
	}
	return len(a.composer.values.SubagentCatalog) > 0
}

// headerSubagentView is the root Session's actions-band entry.
func (a *app) headerSubagentView(c *ui.Context) {
	if !a.headerSubagentVisible() {
		return
	}
	a.subagentCountView(c, a.composer.values.SubagentCatalog)
}

// headerLineageView draws the Session title, prefixed by the parent breadcrumb
// on a subagent Session. It reports whether it already drew that Session's own
// subagent count, so the actions band does not draw it twice.
func (a *app) headerLineageView(c *ui.Context, title string) bool {
	parentID, child := a.sessionParent(a.sessionID)
	if child && parentID != "" {
		parentTitle := a.parentTitle(parentID)
		crumb := ui.ButtonBase(c).Label("父会话").Height(28).MinWidth(0).MaxWidth(200).Shrink(1).Padding(0, 4).Gap(4).Radius(6).Tooltip("返回 " + parentTitle)
		crumb.Children(func() {
			color := a.colors.Secondary
			if crumb.Hovered() {
				color = a.theme.Text
			}
			icon(c, "chevron-left-outline", 12).Shrink(0).TextColor(a.colors.Caption)
			ui.Text(c, parentTitle).FontSize(13).MinWidth(0).Shrink(1).SingleLine().Ellipsis("…").TextColor(color)
		})
		if crumb.Hovered() {
			crumb.Background(a.colors.RowHover)
		}
		if crumb.Clicked() {
			a.openSession(parentID)
		}
		icon(c, "chevron-right-outline", 12).Shrink(0).TextColor(a.colors.Caption)
	}
	ui.Text(c, title).FontSize(14).FontWeight(500).SingleLine().Ellipsis("…").MaxWidth(220).MinWidth(0).Shrink(1).Label("会话标题")
	if child && a.composer != nil && len(a.composer.values.SubagentCatalog) > 0 {
		a.subagentCountView(c, a.composer.values.SubagentCatalog)
		return true
	}
	return false
}
