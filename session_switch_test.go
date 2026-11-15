package main

import (
	"strings"
	"testing"
)

func TestConversationPlaceholderSeparatesConnectionFromSessionState(t *testing.T) {
	newState := func() *app { return newApp(false) }

	a := newState()
	defer a.cancel()
	if got := a.conversationPlaceholder(); got != conversationConnect {
		t.Fatalf("disconnected placeholder = %v", got)
	}

	a.connected = true
	if got := a.conversationPlaceholder(); got != conversationNoSession {
		t.Fatalf("connected without a Session = %v", got)
	}

	a.sessionID = "session-a"
	a.sessionOpening = "session-a"
	if got := a.conversationPlaceholder(); got != conversationLoading {
		t.Fatalf("opening Session = %v", got)
	}

	a.sessionOpening = ""
	if got := a.conversationPlaceholder(); got != conversationEmpty {
		t.Fatalf("settled empty Session = %v", got)
	}

	a.current = snapshot{SessionID: "session-a", Messages: []message{{ID: "m1", Text: "hi"}}}
	if got := a.conversationPlaceholder(); got != conversationChat {
		t.Fatalf("Session with history = %v", got)
	}

	// A stale opening marker for another Session must not mask an empty one.
	a.current = snapshot{SessionID: "session-b"}
	a.sessionID = "session-b"
	a.sessionOpening = "session-a"
	if got := a.conversationPlaceholder(); got != conversationEmpty {
		t.Fatalf("stale opening marker = %v", got)
	}

	demo := newApp(true)
	defer demo.cancel()
	demo.sessionID = "demo-empty"
	demo.current = snapshot{SessionID: "demo-empty"}
	if got := demo.conversationPlaceholder(); got != conversationEmpty {
		t.Fatalf("demo Session listed the connect panel: %v", got)
	}
}

func TestSessionSwitchShowsLoadingAndRollsBackOnRejection(t *testing.T) {
	f := startFixtureApp(t)
	first := f.read(func() any { return f.a.sessions[0] }).(session)

	var during conversationPlaceholder
	f.do(func() {
		f.a.chooseSession(first)
		// The applier cannot run while do holds the window lock, so this is the
		// state the window renders before the remote baseline arrives.
		during = f.a.conversationPlaceholder()
	})
	if during != conversationLoading {
		t.Fatalf("switch rendered %v instead of a loading Session", during)
	}
	f.wait(t, "first Session baseline", func() bool {
		return f.a.sessionID == first.ID && len(f.a.current.Messages) > 0 && !f.a.busy
	})
	if got := f.read(func() any { return f.a.conversationPlaceholder() }); got != conversationChat {
		t.Fatalf("opened Session placeholder = %v", got)
	}

	reject := func(label string, target session) {
		t.Helper()
		f.do(func() { f.a.chooseSession(target) })
		f.wait(t, label, func() bool {
			return !f.a.busy && f.a.sessionID == first.ID && len(f.a.current.Messages) > 0
		})
		state := f.read(func() any {
			return struct {
				error     string
				opening   string
				workspace string
				holder    conversationPlaceholder
			}{f.a.error, f.a.sessionOpening, f.a.workspaceID, f.a.conversationPlaceholder()}
		}).(struct {
			error     string
			opening   string
			workspace string
			holder    conversationPlaceholder
		})
		if !strings.Contains(state.error, "切换会话失败") {
			t.Fatalf("%s: no switch error, got %q", label, state.error)
		}
		if state.opening != "" {
			t.Fatalf("%s: stale opening marker %q", label, state.opening)
		}
		if state.holder != conversationChat {
			t.Fatalf("%s: rolled back to %v", label, state.holder)
		}
	}

	reject("unknown Session", session{ID: "fixture-missing-session", WorkspaceID: f.read(func() any {
		return f.a.workspaces[0].ID
	}).(string)})
	reject("unknown Workspace", session{ID: first.ID, WorkspaceID: "fixture-missing-workspace"})
}

func TestSessionSwitchRollbackReopensSupersededLoadingSession(t *testing.T) {
	f := startFixtureApp(t)
	first := f.read(func() any { return f.a.sessions[0] }).(session)

	// Interrupt the first open before its baseline lands, then fail the second
	// switch: the window must not settle on an empty transcript.
	f.do(func() {
		f.a.chooseSession(first)
		f.a.chooseSession(session{ID: "fixture-missing-session", WorkspaceID: first.WorkspaceID})
	})
	f.wait(t, "reopened first Session", func() bool {
		return f.a.sessionID == first.ID && len(f.a.current.Messages) > 0 && f.a.sessionOpening == "" && !f.a.busy
	})
	if got := f.read(func() any { return f.a.conversationPlaceholder() }); got != conversationChat {
		t.Fatalf("placeholder after interrupted switch = %v", got)
	}
	// The rejected switch is reported in the shared error slot, but the retry's
	// own reads clear that slot as soon as its baseline lands, so this path is
	// asserted on the restored transcript rather than on a lingering message.
}
