package main

import "testing"

func TestNewSessionTargetsCurrentThenRecentAndReusesMatchingBlank(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	a.workspaces = []workspace{{ID: "a", Path: "/a", SessionIDs: []string{"current", "blank"}}, {ID: "b", Path: "/b", SessionIDs: []string{"latest"}}}
	a.sessions = []session{{ID: "current", UpdatedAt: 10}, {ID: "blank", Cwd: "/a", Blank: true}, {ID: "latest", UpdatedAt: 20}}
	a.sessionID = "current"
	if w, id := a.newSessionTarget(""); w != "a" || id != "blank" {
		t.Fatalf("current target %s/%s", w, id)
	}
	a.sessionID = ""
	if w, id := a.newSessionTarget(""); w != "b" || id != "" {
		t.Fatalf("recent target %s/%s", w, id)
	}
	a.sessions[1].Archived = true
	if w, id := a.newSessionTarget("a"); w != "a" || id != "" {
		t.Fatalf("archived blank reused %s/%s", w, id)
	}
	a.workspaces = nil
	if w, id := a.newSessionTarget(""); w != "" || id != "" {
		t.Fatal("invented workspace")
	}
}

func TestNewSessionUsesSelectedContextDuringCatalogMembershipDelay(t *testing.T) {
	for _, tt := range []struct{ name, sessionWorkspace, selected string }{{"session metadata", "a", ""}, {"selected workspace", "", "a"}, {"selected without session", "", "a"}} {
		t.Run(tt.name, func(t *testing.T) {
			a := &app{workspaceID: tt.selected, workspaces: []workspace{{ID: "a", Path: "/a"}, {ID: "b", Path: "/b"}}, sessions: []session{{ID: "current", WorkspaceID: tt.sessionWorkspace, UpdatedAt: 1}, {ID: "recent", WorkspaceID: "b", UpdatedAt: 99}}}
			if tt.name != "selected without session" {
				a.sessionID = "current"
			}
			if w, _ := a.newSessionTarget(""); w != "a" {
				t.Fatal("membership lag selected wrong project", w)
			}
		})
	}
}
