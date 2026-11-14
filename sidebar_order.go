package main

import (
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
