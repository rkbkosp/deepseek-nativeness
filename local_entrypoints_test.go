package main

// A --local-native launch owns its Host: there is no Remote server, no account
// and no device list, so no visible entry may open the Remote connection page or
// the Remote Web page. These tests pin the decision each entry makes in both
// modes; the Remote rows are the pre-local behaviour, unchanged.

import (
	"strings"
	"testing"
)

// entryApp builds a headless app without demo data, then optionally marks it as
// a launch that owns its Host.
func entryApp(t *testing.T, local bool) *app {
	t.Helper()
	a := newApp(true)
	t.Cleanup(a.cancel)
	// newApp(demo) keeps the test off the real view path; the entry decisions
	// are the same either way, and demo would short-circuit the workspace sheet.
	a.demo = false
	if local {
		a.localRuntime = &localRuntime{native: true}
	}
	return a
}

func TestEntryIntentsByMode(t *testing.T) {
	cases := []struct {
		name      string
		local     bool
		connected bool
		newSess   entryIntent
		workspace entryIntent
	}{
		{"local host starting", true, false, intentHold, intentHold},
		{"local host connected", true, true, intentProceed, intentProceed},
		{"remote signed out", false, false, intentOpenConnection, intentOpenConnection},
		{"remote connected", false, true, intentProceed, intentProceed},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			a := entryApp(t, tc.local)
			a.connected = tc.connected
			if got := a.newSessionIntent(); got != tc.newSess {
				t.Errorf("new session intent = %v, want %v", got, tc.newSess)
			}
			if got := a.workspaceCreateIntent(); got != tc.workspace {
				t.Errorf("workspace create intent = %v, want %v", got, tc.workspace)
			}
		})
	}
}

// The property the milestone asks for: with the Host in this process tree, no
// entry may flip the Remote connection page.
func TestLocalEntriesNeverOpenRemoteChrome(t *testing.T) {
	for _, connected := range []bool{false, true} {
		a := entryApp(t, true)
		a.connected = connected
		if connected {
			// createSession needs a live client; the decision is covered above.
			continue
		}
		a.error = ""
		a.applyNewSessionIntent()
		if a.connectionOpen {
			t.Errorf("connected=%v: new session opened the Remote connection page", connected)
		}
		if a.error == "" {
			t.Error("new session before the local Host is up should explain itself")
		} else if strings.Contains(a.error, "Remote") {
			t.Errorf("local hint still speaks Remote: %q", a.error)
		}
	}
}

func TestRemoteNewSessionStillOpensConnection(t *testing.T) {
	a := entryApp(t, false)
	a.applyNewSessionIntent()
	if !a.connectionOpen {
		t.Fatal("a signed-out Remote launch lost its login entry")
	}
	// fetchDevices ran: the same callback as before this change.
	if a.status != "尚未登录" {
		t.Fatalf("Remote new-session callback changed: status %q", a.status)
	}
	if !strings.Contains(a.detail, "Remote") {
		t.Fatalf("Remote new-session detail changed: %q", a.detail)
	}
}

func TestLocalWorkspaceCreateStaysLocal(t *testing.T) {
	a := entryApp(t, true)
	a.error = ""
	a.openWorkspaceCreate()
	if a.connectionOpen {
		t.Fatal("workspace create opened the Remote connection page")
	}
	if a.workspaceCreate != nil {
		t.Fatal("workspace create opened the Host directory sheet before the Host is up")
	}
	if a.error == "" || strings.Contains(a.error, "Remote") {
		t.Fatalf("workspace create hint: %q", a.error)
	}
}

func TestRemoteWorkspaceCreateStillOpensConnection(t *testing.T) {
	a := entryApp(t, false)
	a.openWorkspaceCreate()
	if !a.connectionOpen {
		t.Fatal("a signed-out Remote launch lost its workspace login entry")
	}
	if a.workspaceCreate != nil {
		t.Fatal("the workspace sheet must wait for a Host")
	}
}

func TestRemoteMenuItemsAreHiddenInLocalMode(t *testing.T) {
	local := entryApp(t, true)
	remote := entryApp(t, false)
	for _, id := range []string{hostMenuRemoteWeb, hostMenuRemoteConnection} {
		if local.hostMenuItemVisible(id) {
			t.Errorf("%s is offered by a local launch", id)
		}
		if !remote.hostMenuItemVisible(id) {
			t.Errorf("%s is missing from a Remote launch", id)
		}
	}
	// Entries that do not need a Remote server stay visible in both modes.
	if !local.hostMenuItemVisible("settings") {
		t.Error("local mode hid a non-Remote menu entry")
	}
}

func TestLocalHostPlaceholderHasNoRemoteWords(t *testing.T) {
	a := entryApp(t, true)
	placeholder := a.hostPlaceholder()
	if placeholder.Action != "" {
		t.Fatalf("local placeholder offers a chooser: %q", placeholder.Action)
	}
	for _, text := range []string{placeholder.Title, placeholder.Body, placeholder.Action} {
		if strings.Contains(text, "Remote") {
			t.Errorf("local placeholder still speaks Remote: %q", text)
		}
	}
	a.localRuntime.err = "node 缺失"
	placeholder = a.hostPlaceholder()
	if !strings.Contains(placeholder.Body, "node 缺失") || strings.Contains(placeholder.Body, "Remote") {
		t.Fatalf("failed local Host placeholder: %+v", placeholder)
	}
	if !strings.Contains(placeholder.Title, "本地") {
		t.Fatalf("failed local Host title: %q", placeholder.Title)
	}

	remote := entryApp(t, false)
	if got := remote.hostPlaceholder(); got.Action != "选择 Remote 主机" || got.Title != "连接你的工作主机" || got.Body != "工作留在 MacMini，界面在这里。" {
		t.Fatalf("Remote placeholder changed: %+v", got)
	}
}

func TestNewSessionLabelByMode(t *testing.T) {
	local := entryApp(t, true)
	if got := local.newSessionLabel(); got != "本地 Host 准备中" {
		t.Fatalf("local new-session label: %q", got)
	}
	local.localRuntime.err = "node 缺失"
	if got := local.newSessionLabel(); got != "本地 Host 未就绪" {
		t.Fatalf("failed local Host label: %q", got)
	}
	local.localRuntime.err = ""
	local.connected = true
	if got := local.newSessionLabel(); got != "新会话" {
		t.Fatalf("connected new-session label: %q", got)
	}
	remote := entryApp(t, false)
	if got := remote.newSessionLabel(); got != "连接远程主机" {
		t.Fatalf("Remote new-session label: %q", got)
	}
}
