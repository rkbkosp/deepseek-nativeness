package main

import (
	"encoding/json"
	"testing"
)

// A blank Session is listed only while it is selected, so the first accepted
// message has to clear the row's blank flag before the reader switches away.
// The Host's own client keeps the row because it clears blank on turn/start;
// this client's catalog is a list read, which still has the old value.
func TestAcceptedSendKeepsTheStartedSessionInTheSidebar(t *testing.T) {
	a := sidebarActionsApp(t, false)
	a.connected = true
	a.workspaces = []workspace{{ID: "w1", Name: "项目甲", Path: "/tmp/w1", SessionIDs: []string{"blank", "other"}}}
	a.sessions = []session{
		{ID: "blank", Title: "新会话", WorkspaceID: "w1", Blank: true, UpdatedAt: 1},
		{ID: "other", Title: "会话一", WorkspaceID: "w1", UpdatedAt: 2},
	}
	a.sessionID = "blank"
	a.workspaceID = "w1"
	if !sidebarHasSession(a, "blank") {
		t.Fatal("the selected empty Session is not listed")
	}

	// Before the first message the empty Session is only the provisional row:
	// selecting another Session takes it out of the list.
	a.sessionID = "other"
	if sidebarHasSession(a, "blank") {
		t.Fatal("an untouched empty Session stayed in the list")
	}
	a.sessionID = "blank"

	intent := &sendIntent{ID: "request-1", SessionID: "blank", HostID: a.hostID, AccountScope: a.accountScope}
	if err := a.acceptSend(json.RawMessage(`{"status":"accepted","requestId":"request-1"}`), intent); err != nil {
		t.Fatalf("the accepted send was refused: %v", err)
	}
	if a.sessions[0].Blank {
		t.Fatal("the accepted first message left the Session blank")
	}
	if a.sessions[0].UpdatedAt <= 1 {
		t.Fatal("the started Session kept its pre-Turn activity stamp")
	}

	a.sessionID = "other"
	if !sidebarHasSession(a, "blank") {
		t.Fatal("the started Session disappeared from the sidebar after a switch")
	}
}

// An unconfirmed receipt means nothing started, so the provisional row must stay
// provisional.
func TestUnconfirmedSendLeavesTheEmptySessionBlank(t *testing.T) {
	a := sidebarActionsApp(t, false)
	a.sessions = []session{{ID: "blank", Blank: true, UpdatedAt: 5}}
	a.sessionID = "blank"
	intent := &sendIntent{ID: "request-2", SessionID: "blank"}
	if err := a.acceptSend(json.RawMessage(`{"status":"unknown","requestId":"request-2"}`), intent); err == nil {
		t.Fatal("an unknown receipt was accepted")
	}
	if !a.sessions[0].Blank {
		t.Fatal("an unconfirmed send marked the Session started")
	}
}

func TestMarkSessionTurnStartedOnlyTouchesThatSession(t *testing.T) {
	a := &app{sessions: []session{{ID: "blank", Blank: true, UpdatedAt: 9}}}
	a.markSessionTurnStarted("")
	a.markSessionTurnStarted("missing")
	if !a.sessions[0].Blank || a.sessions[0].UpdatedAt != 9 {
		t.Fatal("another Session was marked started")
	}
}
