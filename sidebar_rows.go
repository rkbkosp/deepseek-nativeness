package main

import (
	"sort"
	"strconv"
	"strings"
	"time"
)

type sidebarRow struct {
	Key, Kind    string
	Workspace    workspace
	Session      session
	Depth, Count int
}

func (a *app) sidebarRows() []sidebarRow {
	filter := func(s session) bool {
		if s.Blank && s.ID != a.sessionID {
			return false
		}
		switch a.uiPrefs.Archived {
		case "default":
			if s.Archived {
				return false
			}
		case "only":
			if !s.Archived {
				return false
			}
		}
		if a.search != "" && !strings.Contains(strings.ToLower(s.Title), strings.ToLower(a.search)) {
			return false
		}
		return true
	}
	sorted := func(rows []session, account string) {
		positions := map[string]int{}
		if a.uiPrefs.OrderBy == "manual" {
			for i, id := range a.uiPrefs.ManualOrder[a.viewKey("sidebar:"+account)] {
				positions[id] = i
			}
		}
		sort.SliceStable(rows, func(i, j int) bool {
			if rows[i].Pinned != rows[j].Pinned {
				return rows[i].Pinned
			}
			if a.uiPrefs.OrderBy == "manual" {
				ri, knownI := positions[rows[i].ID]
				rj, knownJ := positions[rows[j].ID]
				if knownI != knownJ {
					return knownI
				}
				if knownI && ri != rj {
					return ri < rj
				}
			}
			if rows[i].UpdatedAt != rows[j].UpdatedAt {
				return rows[i].UpdatedAt > rows[j].UpdatedAt
			}
			return rows[i].ID < rows[j].ID
		})
	}
	var out []sidebarRow
	if a.uiPrefs.GroupBy == "flat" {
		rows := []session{}
		for _, s := range a.sessions {
			if filter(s) {
				rows = append(rows, s)
			}
		}
		sorted(rows, "__flat")
		for _, s := range rows {
			out = append(out, sidebarRow{Key: "s:" + s.ID, Kind: "session", Session: s})
		}
		return out
	}
	groups := append([]workspace(nil), a.workspaces...)
	owners := map[string]string{}
	workspaceIDs := map[string]bool{}
	for _, w := range a.workspaces {
		workspaceIDs[w.ID] = true
		for _, id := range w.SessionIDs {
			if _, exists := owners[id]; !exists {
				owners[id] = w.ID
			}
		}
	}
	for _, s := range a.sessions {
		if _, exists := owners[s.ID]; !exists && s.WorkspaceID != "" && workspaceIDs[s.WorkspaceID] {
			owners[s.ID] = s.WorkspaceID
		}
	}
	var unassigned []string
	for _, s := range a.sessions {
		_, owned := owners[s.ID]
		if !owned && filter(s) {
			unassigned = append(unassigned, s.ID)
		}
	}
	if len(unassigned) > 0 {
		groups = append(groups, workspace{Name: "未分组", SessionIDs: unassigned})
	}
	for _, w := range groups {
		var rows []session
		for _, s := range a.sessions {
			owner, owned := owners[s.ID]
			if ((w.ID != "" && owned && owner == w.ID) || (w.ID == "" && !owned && containsID(w.SessionIDs, s.ID))) && filter(s) {
				rows = append(rows, s)
			}
		}
		sorted(rows, w.ID)
		depth := 0
		if a.uiPrefs.GroupBy == "tree" {
			for _, other := range a.workspaces {
				if other.ID != w.ID && other.Path != "" && strings.HasPrefix(w.Path, strings.TrimRight(other.Path, "/")+"/") {
					depth++
				}
			}
		}
		out = append(out, sidebarRow{Key: "w:" + w.ID, Kind: "workspace", Workspace: w, Depth: depth, Count: len(rows)})
		expanded, ok := a.uiPrefs.Expanded[w.ID]
		if ok && !expanded && a.search == "" {
			continue
		}
		limit := a.watermarks[w.ID]
		if limit == 0 {
			limit = 5
		}
		if a.search != "" {
			limit = len(rows)
		}
		for i, s := range rows {
			if i >= limit {
				out = append(out, sidebarRow{Key: "more:" + w.ID, Kind: "more", Workspace: w, Count: len(rows) - limit, Depth: depth})
				break
			}
			out = append(out, sidebarRow{Key: "s:" + s.ID, Kind: "session", Workspace: w, Session: s, Depth: depth})
		}
	}
	return out
}
func containsID(ids []string, id string) bool {
	for _, v := range ids {
		if id == v {
			return true
		}
	}
	return false
}
func relativeTime(at float64, now time.Time) string {
	if at == 0 {
		return ""
	}
	d := now.Sub(time.UnixMilli(int64(at)))
	switch {
	case d < time.Minute:
		return "现在"
	case d < time.Hour:
		return strconv.Itoa(int(d/time.Minute)) + "分钟"
	case d < 24*time.Hour:
		return strconv.Itoa(int(d/time.Hour)) + "小时"
	case d < 30*24*time.Hour:
		return strconv.Itoa(int(d/(24*time.Hour))) + "天"
	default:
		return strconv.Itoa(int(d/(30*24*time.Hour))) + "个月"
	}
}
