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
