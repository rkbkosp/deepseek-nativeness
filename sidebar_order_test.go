package main

import "testing"

func TestSidebarSessionIDsOnlyOwnershipDoesNotDuplicateInUngrouped(t *testing.T) {
	a := &app{uiPrefs: defaultViewPreferences(), workspaces: []workspace{{ID: "w", SessionIDs: []string{"owned"}}}, sessions: []session{{ID: "owned", Title: "A"}, {ID: "loose", Title: "B"}}}
	counts := map[string]int{}
	var ungrouped []string
	for _, r := range a.sidebarRows() {
		if r.Kind == "session" {
			counts[r.Session.ID]++
			if r.Workspace.ID == "" {
				ungrouped = append(ungrouped, r.Session.ID)
			}
		}
	}
	if counts["owned"] != 1 || counts["loose"] != 1 || len(ungrouped) != 1 || ungrouped[0] != "loose" {
		t.Fatal(counts, ungrouped)
	}
}
func TestSidebarManualFreezesRecencyAcrossUpdatesAndSeparatesHost(t *testing.T) {
	a := &app{hostID: "h", uiPrefs: defaultViewPreferences(), workspaces: []workspace{{ID: "w", SessionIDs: []string{"old", "new"}}}, sessions: []session{{ID: "old", UpdatedAt: 1}, {ID: "new", UpdatedAt: 2}}}
	a.setSidebarOrder("manual")
	a.sessions[0].UpdatedAt = 99
	var ids []string
	for _, r := range a.sidebarRows() {
		if r.Kind == "session" {
			ids = append(ids, r.Session.ID)
		}
	}
	if len(ids) != 2 || ids[0] != "new" || ids[1] != "old" {
		t.Fatal(ids)
	}
	a.hostID = "other"
	for _, r := range a.sidebarRows() {
		if r.Kind == "session" {
			if r.Session.ID != "old" {
				t.Fatal("another Host inherited manual order")
			}
			break
		}
	}
	a.hostID = "h"
	a.setSidebarOrder("updated")
	if len(a.uiPrefs.ManualOrder) != 0 {
		t.Fatal("recency must discard this Host manual layout")
	}
}
