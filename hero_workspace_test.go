package main

import (
	"slices"
	"strings"
	"testing"

	"github.com/egoist/mygo/ui"
)

func heroWorkspaceApp(t *testing.T) *app {
	t.Helper()
	a := sidebarActionsApp(t, false)
	a.connected = true
	a.operationCaps = sidebarActionCaps(true)
	a.workspaces = []workspace{
		{ID: "w1", Name: "项目甲", Path: "/tmp/w1", SessionIDs: []string{"blank"}},
		{ID: "w2", Name: "项目乙", Path: "/tmp/w2"},
	}
	a.sessions = []session{{ID: "blank", Title: "新会话", WorkspaceID: "w1", Blank: true, UpdatedAt: 1}}
	a.sessionID = "blank"
	a.workspaceID = "w1"
	a.current = snapshot{SessionID: "blank"}
	a.composer = nil
	return a
}

// The empty Session's hero names its Workspace and offers every other one plus
// the add action, matching the original client's hero seat.
func TestHeroWorkspaceChipListsWorkspacesAndAddAction(t *testing.T) {
	a := heroWorkspaceApp(t)
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("项目甲") {
		t.Fatalf("the hero does not name its Workspace: %v", tt.Texts())
	}
	if err := tt.Click("选择工作区"); err != nil {
		t.Fatalf("open the hero Workspace picker: %v", err)
	}
	labels := tt.Menu()
	for _, want := range []string{"项目甲", "项目乙", "添加工作区…"} {
		if !slices.Contains(labels, want) {
			t.Fatalf("the picker menu %v lacks %q", labels, want)
		}
	}
	// Choosing the Workspace already on screen changes nothing.
	if err := tt.ChooseMenuItem("项目甲"); err != nil {
		t.Fatalf("choose the current Workspace: %v", err)
	}
	if a.error != "" {
		t.Fatalf("choosing the current Workspace did something: %q", a.error)
	}
}

// Picking another Workspace asks the Host for that Workspace's blank Session;
// with no client the write is refused, which proves the pick reached the New
// Session flow instead of only closing the menu.
func TestHeroWorkspacePickStartsTheNewSessionFlow(t *testing.T) {
	a := heroWorkspaceApp(t)
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if err := tt.Click("选择工作区"); err != nil {
		t.Fatal(err)
	}
	if err := tt.ChooseMenuItem("项目乙"); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(a.error, "Remote 未连接") {
		t.Fatalf("the pick did not reach createSession: %q", a.error)
	}
	// The row the request selects lives in that group, so the group is revealed.
	if !a.uiPrefs.Expanded["w2"] {
		t.Fatal("the picked Workspace stayed collapsed in the sidebar")
	}
}

// Without a resolved Workspace the chip keeps its call to action and still
// opens the picker.
func TestHeroWorkspaceChipWithoutSelection(t *testing.T) {
	a := heroWorkspaceApp(t)
	a.workspaceID = ""
	a.sessions[0].WorkspaceID = ""
	a.workspaces[0].SessionIDs = nil
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("选择工作区") {
		t.Fatalf("the placeholder chip is missing: %v", tt.Texts())
	}
	if err := tt.Click("选择工作区"); err != nil {
		t.Fatal(err)
	}
	if labels := tt.Menu(); !slices.Contains(labels, "项目乙") {
		t.Fatalf("the placeholder picker lists nothing: %v", labels)
	}
}

func TestHeroWorkspaceResolvesTheSessionsOwnerWhenSelectionIsEmpty(t *testing.T) {
	a := heroWorkspaceApp(t)
	a.workspaceID = ""
	if w, ok := a.heroWorkspace(); !ok || w.ID != "w1" {
		t.Fatalf("owner fallback resolved %q/%v", w.ID, ok)
	}
}

func TestHeroWorkspaceLabelFallsBackToTheDirectoryName(t *testing.T) {
	for _, tc := range []struct{ name, path, want string }{
		{"项目甲", "/tmp/w1", "项目甲"},
		{"", "/tmp/project/w2/", "w2"},
		{"/tmp/w3", "/tmp/w3", "w3"},
		{"", "", "未命名工作区"},
	} {
		if got := heroWorkspaceLabel(workspace{Name: tc.name, Path: tc.path}); got != tc.want {
			t.Fatalf("label(%q, %q) = %q, want %q", tc.name, tc.path, got, tc.want)
		}
	}
}
