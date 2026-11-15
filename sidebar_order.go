package main

import (
	"github.com/egoist/mygo/ui"
	"sort"
	"strings"
)

// Manual order is a client preference, separate from authoritative workspace
// membership. Entering Manual freezes current recency, including hidden rows.
func (a *app) setSidebarOrder(mode string) {
	if mode != "manual" && mode != "updated" {
		return
	}
	if a.uiPrefs.OrderBy == mode {
		return
	}
	prefix := a.viewKey("sidebar:")
	for key := range a.uiPrefs.ManualOrder {
		if strings.HasPrefix(key, prefix) {
			delete(a.uiPrefs.ManualOrder, key)
		}
	}
	if mode == "manual" {
		if a.uiPrefs.ManualOrder == nil {
			a.uiPrefs.ManualOrder = map[string][]string{}
		}
		rows := append([]session(nil), a.sessions...)
		sort.Slice(rows, func(i, j int) bool {
			if rows[i].UpdatedAt != rows[j].UpdatedAt {
				return rows[i].UpdatedAt > rows[j].UpdatedAt
			}
			return rows[i].ID < rows[j].ID
		})
		accounted := map[string]bool{}
		for _, w := range a.workspaces {
			var ids []string
			for _, s := range rows {
				if s.WorkspaceID == w.ID || containsID(w.SessionIDs, s.ID) {
					ids = append(ids, s.ID)
					accounted[s.ID] = true
				}
			}
			a.uiPrefs.ManualOrder[a.viewKey("sidebar:"+w.ID)] = ids
		}
		var ungrouped, flat []string
		for _, s := range rows {
			flat = append(flat, s.ID)
			if !accounted[s.ID] {
				ungrouped = append(ungrouped, s.ID)
			}
		}
		a.uiPrefs.ManualOrder[a.viewKey("sidebar:")] = ungrouped
		a.uiPrefs.ManualOrder[a.viewKey("sidebar:__flat")] = flat
	}
	a.uiPrefs.OrderBy = mode
}

// The sidebar view has two independent toggles, both kept in uiPrefs: how
// sessions are grouped (by workspace, as a tree, or as one flat list) and how
// each group is ordered (a manual snapshot, or most recently updated). The
// grouping toggle stores its mode; setSidebarOrder also freezes the manual
// snapshot it needs. These readers normalize what is stored, so a stale or
// hand-edited preference cannot leave the title row describing another view
// than the one sidebarRows builds.
func (a *app) sidebarGroupMode() string {
	switch a.uiPrefs.GroupBy {
	case "tree", "flat":
		return a.uiPrefs.GroupBy
	default:
		return "workspace"
	}
}

func (a *app) sidebarOrderMode() string {
	if a.uiPrefs.OrderBy == "manual" {
		return "manual"
	}
	return "updated"
}

// sidebarGroupLabel and sidebarOrderLabel name the modes as the view menu
// does, so the control and the menu cannot describe different states.
func sidebarGroupLabel(mode string) string {
	switch mode {
	case "tree":
		return "按工作区树"
	case "flat":
		return "单列表"
	default:
		return "按工作区"
	}
}

func sidebarOrderLabel(mode string) string {
	if mode == "manual" {
		return "手动排序"
	}
	return "最近更新"
}

// sidebarViewIcon shows the current grouping in the title row, so the view is
// readable without opening the menu.
func (a *app) sidebarViewIcon() string {
	switch a.sidebarGroupMode() {
	case "tree":
		return "branch-outline"
	case "flat":
		return "flat-list-outline"
	default:
		return "layers-outline"
	}
}

func (a *app) sidebarViewTooltip() string {
	return "视图选项 · " + sidebarGroupLabel(a.sidebarGroupMode()) + " · " + sidebarOrderLabel(a.sidebarOrderMode())
}

// toggleSearch opens or closes the search field. The field owns the keyboard
// while it is open: Up and Down move the choice over the hits, Enter opens the
// chosen session and closes the search, and Esc closes the search and clears
// the query. The choice is kept by session ID, so it stays on the same session
// while the hits change under it as the query is typed, and falls to the first
// hit when that session is filtered away.
func (a *app) toggleSearch() {
	if a.searchOpen {
		a.closeSearch()
		return
	}
	a.searchOpen = true
	a.searchPick, a.searchRow = "", -1
}

func (a *app) closeSearch() {
	a.searchOpen = false
	a.search = ""
	a.searchPick, a.searchRow = "", -1
	a.sessionList.Selected = nil
}

func (a *app) searchTooltip() string {
	if a.searchOpen {
		return "关闭搜索 Esc"
	}
	return "搜索会话 ⌘K"
}

// searchHitRows lists the row indexes of the sessions a search shows, in the
// order the sidebar lists them: a row index, not a hit index, because the list
// also holds the workspace rows between them.
func searchHitRows(rows []sidebarRow) []int {
	var hits []int
	for i, r := range rows {
		if r.Kind == "session" {
			hits = append(hits, i)
		}
	}
	return hits
}

// syncSearchPick keeps the choice on a hit: a choice the query filtered away
// moves to the first hit, and the list's Selected pointer follows the choice so
// the row the keys would open is the one drawn as chosen.
func (a *app) syncSearchPick(rows []sidebarRow) {
	hits := searchHitRows(rows)
	if len(hits) == 0 {
		a.searchPick, a.searchRow = "", -1
		return
	}
	for _, row := range hits {
		if rows[row].Session.ID == a.searchPick {
			a.searchRow = row
			return
		}
	}
	a.searchRow = hits[0]
	a.searchPick = rows[a.searchRow].Session.ID
}

// moveSearchPick steps the choice over the hits and stops at either end,
// rather than wrapping past a list the user is reading.
func (a *app) moveSearchPick(rows []sidebarRow, delta int) {
	hits := searchHitRows(rows)
	if len(hits) == 0 {
		a.searchPick, a.searchRow = "", -1
		return
	}
	at := -1
	for i, row := range hits {
		if rows[row].Session.ID == a.searchPick {
			at = i
			break
		}
	}
	if at < 0 {
		at = 0 // no choice yet: the first hit, not the one after it
	} else if next := at + delta; next >= 0 && next < len(hits) {
		at = next
	}
	a.searchPick = rows[hits[at]].Session.ID
	a.searchRow = -1 // syncSearchPick fills the row before the list builds
}

// openSearchPick opens the chosen hit and closes the search, and reports
// whether it found the session to open.
func (a *app) openSearchPick(rows []sidebarRow) bool {
	for _, r := range rows {
		if r.Kind == "session" && r.Session.ID == a.searchPick {
			a.closeSearch()
			a.chooseSession(r.Session)
			return true
		}
	}
	return false
}

// searchView builds the search field under the sidebar title and reads the
// keyboard path it owns. The hits are the sidebar's own session rows, which
// the query already filtered, so the list draws the choice the keys move.
func (a *app) searchView(c *ui.Context, rows []sidebarRow) {
	a.sessionList.Selected = &a.searchRow
	input := ui.TextInput(c, &a.search).Placeholder("搜索会话").Label("搜索会话输入框").AutoFocus()
	switch {
	case input.Shortcut(0, ui.KeyDown):
		a.moveSearchPick(rows, 1)
	case input.Shortcut(0, ui.KeyUp):
		a.moveSearchPick(rows, -1)
	}
	a.syncSearchPick(rows)
	// The choice is made here, not left as the number it had: the row behind a
	// hit moves as the query narrows, and the list would otherwise take a row
	// whose item changed as the chosen item going away.
	a.sessionList.Choose(a.searchRow)
	if input.Submitted() {
		a.openSearchPick(rows)
	}
	if input.Shortcut(0, ui.KeyEscape) {
		a.closeSearch()
	}
	if a.search != "" && a.searchRow < 0 {
		ui.Text(c, "没有匹配的会话").FontSize(12).TextColor(a.theme.TextMuted).Padding(4, 8)
		ui.Text(c, "换个关键词，或者按 Esc 关闭搜索").FontSize(11).TextColor(a.theme.TextMuted).Padding(0, 8, 6)
	}
}
