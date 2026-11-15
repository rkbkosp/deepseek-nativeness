package main

// A Session-scoped compatibility page must not be opened while its Session is
// still loading: the owner it registers binds to the Session it was opened
// under, and a scope that moves underneath it is refused for good.

import (
	"testing"
	"time"
)

func TestCompatSessionLoadingOnlyDefersSessionPages(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	a.testDispatch = func(fn func()) { fn() }
	a.sessionID = "session-1"
	a.sessionOpening = "session-1"
	a.current.SessionID = ""

	for _, page := range []string{"trajectory", "terminal", "plugins", "automation"} {
		if !a.compatSessionLoading(page) {
			t.Errorf("%s should wait for its session", page)
		}
	}
	for _, page := range []string{"plugins-settings", "models", "model-settings", "agent-presets"} {
		if a.compatSessionLoading(page) {
			t.Errorf("%s is not session-scoped and must not wait", page)
		}
	}

	// With the snapshot adopted and no open in flight, nothing waits.
	a.sessionOpening = ""
	a.current.SessionID = "session-1"
	if a.compatSessionLoading("trajectory") {
		t.Fatal("a settled session must not defer the page")
	}
}

// The deferred open runs once the Session settles, and it is abandoned when the
// user has moved on rather than replacing what they are looking at.
func TestDeferredCompatOpenWaitsThenOpens(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	a.testDispatch = func(fn func()) { fn() }
	a.connected = true
	a.hostID = "host"
	a.sessionID = "session-1"
	a.sessionOpening = "session-1"
	t.Cleanup(func() { compatOpenedForTest = nil })

	var opened int
	compatOpenedForTest = func(page string) {
		opened++
		if page != "plugins" {
			t.Fatalf("opened %q instead of the deferred page", page)
		}
	}

	a.deferCompatOpen("plugins", "main")
	time.Sleep(150 * time.Millisecond)
	if opened != 0 {
		t.Fatal("opened before the session settled")
	}

	a.sessionOpening = ""
	a.current.SessionID = "session-1"
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && opened == 0 {
		time.Sleep(20 * time.Millisecond)
	}
	if opened != 1 {
		t.Fatalf("deferred open ran %d times, want 1", opened)
	}
}

func TestDeferredCompatOpenYieldsToNavigation(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	a.testDispatch = func(fn func()) { fn() }
	a.connected = true
	a.hostID = "host"
	a.sessionID = "session-1"
	a.sessionOpening = "session-1"

	opened := false
	compatOpenedForTest = func(string) { opened = true }
	t.Cleanup(func() { compatOpenedForTest = nil })

	a.deferCompatOpen("plugins", "main")
	// The user switches Session before the deferred open fires.
	a.navigationGeneration++
	a.sessionOpening = ""
	a.current.SessionID = "session-1"
	time.Sleep(400 * time.Millisecond)
	if opened {
		t.Fatal("a deferred open replaced the user's newer navigation")
	}
}
