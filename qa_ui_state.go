package main

// QA-only UI states, so screen acceptance does not depend on synthesising
// keystrokes or holding the screen-recording permission.
//
// macOS refuses synthetic input unless the calling process holds Accessibility
// approval, and area capture asks for Screen Recording. Both are the user's
// decisions, not the build's, so a review run instead starts the client in the
// state it wants to inspect: `--ui-state settings --capture …` opens the
// settings panel on the first connected frame and the existing capture path
// records it. Every state below is reachable through the normal UI; this only
// performs the same calls a click would.

import (
	"encoding/json"
	"log"
	"os"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"

	"github.com/egoist/mygo"
)

var qaLayoutLog bool
var qaCatalogLog bool
var qaCatalogPath string
var qaSessionTitle string
var qaStepsOverride string
var qaWorkspaceName string
var qaFontSizeOverride float32
var qaCodeWorkViewOverride string
var qaLayoutSeen = map[string]bool{}
var qaCatalogSeen = map[string]bool{}

// qaLayout logs one element's laid-out rectangle once per process. It exists
// so a parity run can compare numbers with the reference DOM instead of
// guessing vertical offsets from screenshots.
func (a *app) qaLayout(name string, r ui.Rect) {
	if !qaLayoutLog || qaLayoutSeen[name] {
		return
	}
	qaLayoutSeen[name] = true
	log.Printf("qa-layout %s x=%.1f y=%.1f w=%.1f h=%.1f", name, r.X, r.Y, r.W, r.H)
}

// qaCatalog logs the catalog rows the client actually decoded, once per kind.
// It answers whether a visible sidebar difference is ordering or missing data.
func (a *app) qaCatalog(kind string, value any) {
	if !qaCatalogLog || qaCatalogSeen[kind] {
		return
	}
	qaCatalogSeen[kind] = true
	switch rows := value.(type) {
	case []workspace:
		if qaCatalogPath != "" {
			data, err := json.MarshalIndent(rows, "", "  ")
			if err == nil {
				err = os.WriteFile(qaCatalogPath, append(data, '\n'), 0600)
			}
			if err != nil {
				log.Printf("qa-catalog write %s: %v", qaCatalogPath, err)
			}
		}
		for _, w := range rows {
			log.Printf("qa-catalog workspace id=%q name=%q path=%q sessions=%d", w.ID, w.Name, w.Path, len(w.SessionIDs))
		}
	case []session:
		log.Printf("qa-catalog sessions count=%d", len(rows))
	}
}

// qaWorkspace returns the named Workspace, or the first one when no name was
// given. It keeps a capture on the same Workspace the reference selected.
func (a *app) qaWorkspace() *workspace {
	for i := range a.workspaces {
		if qaWorkspaceName == "" || strings.Contains(a.workspaces[i].Name, qaWorkspaceName) || strings.Contains(a.workspaces[i].Path, qaWorkspaceName) {
			return &a.workspaces[i]
		}
	}
	return nil
}

// qaUIStates are the states a review run may request. They exist because each
// one used to need a click that automation cannot make.
var qaUIStates = map[string]string{
	"none":                  "connected transcript only",
	"sidebar-collapsed":     "sidebar hidden",
	"settings":              "settings panel",
	"settings-models":       "settings panel on the model section",
	"settings-plugins":      "settings panel on the plugin section",
	"search":                "search field open",
	"right-pane":            "right pane open on its start surface",
	"trajectory":            "trajectory tab",
	"plugins":               "compatibility page: plugins",
	"automation":            "compatibility page: automations",
	"terminal":              "right pane terminal",
	"workspace-create":      "new-workspace sheet",
	"connection":            "host connection page (Remote or local facts)",
	"plugins-race":          "plugins page opened in the same frame as a session switch (regression probe)",
	"settings-plugins-page": "settings panel on the plugin compatibility page",
	"models":                "model compatibility page",
	"agent-presets":         "agent preset compatibility page",
	"plugin-settings":       "plugin settings compatibility page",
}

// qaUIStateNeedsSession reports whether a surface is only reachable with an
// open Session. The trajectory, terminal and compatibility pages are
// Session-scoped: opening them without one fails instead of showing a surface.
var qaUIStateNeedsSession = map[string]bool{
	"trajectory": true,
	"terminal":   true,
	"plugins":    true,
	"automation": true,
	// The model page reads a Session's selection and reports "请先选择会话。"
	// without one, so a capture of it needs a Session open.
	"models": true,
}

// applyQAUIStateWhenReady waits for the first connected frame, prepares the
// Session a scoped surface needs, and only then applies the state.
//
// The waiting happens off the main thread: the Session's first snapshot can
// only arrive while the main thread is free to receive it, so blocking there to
// wait for the load would deadlock the very thing being waited for.
func (a *app) applyQAUIStateWhenReady(state string) {
	if state == "" || state == "none" {
		return
	}
	if !a.qaWaitFor(time.Minute, func() bool { return a.connected || a.localRuntime == nil || a.demo }) {
		log.Printf("qa: ui state %q never applied: no connection within 60s", state)
		return
	}
	if qaUIStateNeedsSession[state] {
		// `connected` becomes true before the catalog it triggers has been read
		// back, so wait for the rows themselves; opening a Session-scoped surface
		// against an empty catalog has nothing to scope it.
		a.qaWaitFor(30*time.Second, func() bool { return len(a.sessions) > 0 })
		opened := a.qaRunOnMain(func() bool {
			if a.sessionID != "" {
				return true
			}
			if len(a.sessions) == 0 {
				return false
			}
			// The same call the first sidebar row makes.
			a.chooseSession(a.sessions[0])
			return true
		})
		if !opened {
			log.Printf("qa: ui state %q needs an open session and the catalog is empty", state)
			return
		}
		// A compatibility page registers an owner bound to the Session it was
		// opened under; opening it before the load settles races that
		// registration and the page is answered with STALE_CONTEXT.
		if !a.qaWaitFor(20*time.Second, func() bool {
			return a.sessionID != "" && a.sessionOpening == "" && a.current.SessionID == a.sessionID
		}) {
			log.Printf("qa: ui state %q applied while the session was still loading", state)
		}
	}
	a.qaRunOnMain(func() bool {
		a.applyQAUIState(state)
		return true
	})
}

// applyQAUIState performs the calls the corresponding click performs. It reads
// and writes UI state, so it must run on the main thread.
func (a *app) applyQAUIState(state string) {
	if state == "" || state == "none" {
		return
	}
	log.Printf("qa: applying ui state %q", state)
	switch state {
	case "sidebar-collapsed":
		a.sidebar = false
	case "settings":
		a.openSettingsSection("general")
	case "settings-models":
		a.openSettingsSection("models")
	case "settings-plugins":
		a.openSettingsSection("plugins")
	case "search":
		a.sidebar = true
		a.searchOpen = true
	case "right-pane":
		a.rightPaneOpen = true
	case "trajectory":
		a.currentTab = "trajectory"
		a.openCompatAt("trajectory", "trajectory")
	case "plugins":
		a.openCompat("plugins")
	case "models":
		a.openCompat("models")
	case "agent-presets":
		a.openCompat("agent-presets")
	case "plugin-settings":
		a.openCompat("plugin-settings")
	case "settings-plugins-page":
		a.openSettingsSection("plugins")
	case "automation":
		a.openCompat("automation")
	case "terminal":
		a.rightPaneOpen = true
		a.openCompatAt("terminal", "right")
	case "workspace-create":
		a.openWorkspaceCreate()
	case "connection":
		a.connectionOpen = true
		if !a.localMode() {
			a.fetchDevices()
		}
	case "plugins-race":
		// The race the deferral exists for: switch Session and open a
		// Session-scoped page before its first snapshot can arrive.
		if len(a.sessions) > 1 {
			a.chooseSession(a.sessions[1])
		}
		a.openCompat("plugins")
	default:
		log.Printf("qa: unknown ui state %q (known: %v)", state, knownQAUIStates())
	}
	if a.win != nil {
		a.win.Invalidate()
	}
}

// qaWaitFor polls one UI read until done reports true, from whatever goroutine
// calls it. Each read is a short hop to the main thread, so the window keeps
// processing while this waits.
func (a *app) qaWaitFor(timeout time.Duration, done func() bool) bool {
	deadline := time.Now().Add(timeout)
	for {
		if a.qaRunOnMain(done) {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(80 * time.Millisecond)
	}
}

// qaRunOnMain evaluates one read or write on the main thread and returns its
// result. Calls from the main thread run inline.
func (a *app) qaRunOnMain(fn func() bool) bool {
	result := make(chan bool, 1)
	mygo.RunOnMain(func() { result <- fn() })
	select {
	case value := <-result:
		return value
	case <-time.After(5 * time.Second):
		return false
	}
}

// knownQAUIStates lists the accepted names for a diagnostic message.
func knownQAUIStates() []string {
	names := make([]string, 0, len(qaUIStates))
	for name := range qaUIStates {
		names = append(names, name)
	}
	return names
}
