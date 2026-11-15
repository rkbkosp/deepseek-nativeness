package main

import (
	"encoding/json"
	"testing"

	"native-dsh/desktop/internal/bridge"
)

func sessionProjectionParams(sessionID, payload string) json.RawMessage {
	return json.RawMessage(`{"sessionId":"` + sessionID + `","baselineSerial":0,"projections":` + payload + `}`)
}

// The Host publishes the generated title on the open Session's projection
// stream; the sidebar row has to take it without another catalog read.
func TestSessionProjectionRenamesTheSidebarRow(t *testing.T) {
	a := newApp(false)
	defer a.cancel()
	a.sessionID = "s"
	a.current = snapshot{SessionID: "s"}
	a.sessions = []session{{ID: "s", Title: "新会话"}}

	a.notification(bridge.Notification{Method: "sessionProjections", Params: sessionProjectionParams("s", `{"asOfSeq":7,"values":{"title":"修复侧栏会话名"}}`)})

	if got := a.sessions[0].Title; got != "修复侧栏会话名" {
		t.Fatalf("sidebar row kept %q", got)
	}
	if len(a.current.Projections) == 0 {
		t.Fatal("the open Session lost its projection payload")
	}
}

// A cached passive follow can still publish the title of a Session the reader
// already left; that row updates while the open Session stays untouched.
func TestSessionProjectionRenamesAnotherSessionsRow(t *testing.T) {
	a := newApp(false)
	defer a.cancel()
	a.sessionID = "open"
	a.current = snapshot{SessionID: "open"}
	a.sessions = []session{{ID: "left", Title: "新会话"}, {ID: "open", Title: "当前会话"}}

	a.notification(bridge.Notification{Method: "sessionProjections", Params: sessionProjectionParams("left", `{"asOfSeq":4,"values":{"title":"离开后的标题"}}`)})

	if got := a.sessions[0].Title; got != "离开后的标题" {
		t.Fatalf("left row kept %q", got)
	}
	if got := a.sessions[1].Title; got != "当前会话" {
		t.Fatalf("open row changed to %q", got)
	}
	if a.current.Projections != nil {
		t.Fatal("another Session's projection payload replaced the open one")
	}
}

// A list read can answer after a newer stream frame; the older sequence must
// not restore the provisional name.
func TestOlderTitleProjectionDoesNotWin(t *testing.T) {
	a := newApp(false)
	defer a.cancel()
	a.sessions = []session{{ID: "s", Title: "新会话"}}

	a.applySessionTitle("s", json.RawMessage(`{"asOfSeq":9,"values":{"title":"新标题"}}`))
	a.applySessionTitle("s", json.RawMessage(`{"asOfSeq":6,"values":{"title":"旧标题"}}`))
	if got := a.sessions[0].Title; got != "新标题" {
		t.Fatalf("older projection won: %q", got)
	}
}

// Snapshots carry the same projection block, and a bare value map without the
// sequence envelope is accepted too.
func TestSessionTitleFromSnapshotAndBareValues(t *testing.T) {
	a := newApp(false)
	defer a.cancel()
	a.sessions = []session{{ID: "s", Title: "新会话"}}
	a.replaceSnapshot(snapshot{SessionID: "s", Projections: json.RawMessage(`{"asOfSeq":2,"values":{"title":"快照标题"}}`)})
	if got := a.sessions[0].Title; got != "快照标题" {
		t.Fatalf("snapshot title = %q", got)
	}

	a.applySessionTitle("s", json.RawMessage(`{"title":"裸值标题"}`))
	if got := a.sessions[0].Title; got != "裸值标题" {
		t.Fatalf("bare title = %q", got)
	}
}

// An absent, null or empty title never erases the row's name.
func TestSessionTitleIgnoresEmptyValues(t *testing.T) {
	a := newApp(false)
	defer a.cancel()
	a.sessions = []session{{ID: "s", Title: "保留"}}
	for _, payload := range []string{
		`{"asOfSeq":3,"values":{"modelSelection":{}}}`,
		`{"asOfSeq":3,"values":{"title":null}}`,
		`{"asOfSeq":3,"values":{"title":""}}`,
		`{"asOfSeq":3,"values":{"title":"   "}}`,
	} {
		a.applySessionTitle("s", json.RawMessage(payload))
	}
	if got := a.sessions[0].Title; got != "保留" {
		t.Fatalf("empty projection replaced the name with %q", got)
	}
}
