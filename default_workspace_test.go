package main

import (
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestDefaultWorkspaceFollowsTheMostRecentSession(t *testing.T) {
	a := &app{
		workspaces: []workspace{{ID: "w1"}, {ID: "w2"}},
		sessions: []session{
			{ID: "old", WorkspaceID: "w1", UpdatedAt: 10},
			{ID: "new", WorkspaceID: "w2", UpdatedAt: 20},
		},
	}
	a.ensureDefaultWorkspace()
	if a.workspaceID != "w2" {
		t.Fatalf("default workspace = %q", a.workspaceID)
	}
	a.workspaceID = "w1"
	a.ensureDefaultWorkspace()
	if a.workspaceID != "w1" {
		t.Fatalf("a live selection was replaced: %q", a.workspaceID)
	}
}

func TestDefaultWorkspaceFallsBackToTheFirstRow(t *testing.T) {
	a := &app{workspaces: []workspace{{ID: "first"}, {ID: "second"}}}
	a.ensureDefaultWorkspace()
	if a.workspaceID != "first" {
		t.Fatalf("fallback = %q", a.workspaceID)
	}
}

func TestDraftSessionWaitsForPendingRestore(t *testing.T) {
	a := &app{connected: true, workspaceID: "w", restoreTarget: &savedSelection{SessionID: "s"}}
	a.ensureDraftSession()
	if a.draftAttempted {
		t.Fatal("a draft was created ahead of the pending restore")
	}
}

func TestEmptySearchDoesNotChooseAListRow(t *testing.T) {
	selected := 3
	a := &app{searchRow: -1, sessionList: ui.ListState{Selected: &selected}}
	a.chooseSearchRow()
	if selected != 3 {
		t.Fatalf("empty search moved the list choice to %d", selected)
	}
	a.searchRow = 2
	a.chooseSearchRow()
	if selected != 2 {
		t.Fatalf("search choice = %d", selected)
	}
}

func TestOpenCurrentWorkspaceLocalRequiresLocalDirectory(t *testing.T) {
	a := &app{workspaceID: "w", workspaces: []workspace{{ID: "w", Name: "demo", Path: "/tmp/demo"}}}
	a.openCurrentWorkspaceLocal()
	if a.error == "" {
		t.Fatal("a remote workspace was opened without a local directory")
	}
}

func TestSaveAttachmentWithoutClientIsANoop(t *testing.T) {
	a := &app{}
	a.saveAttachment(fileAttachment{AttachmentID: "a1", Name: "x.txt"})
	if a.error != "" {
		t.Fatalf("guard set an error: %q", a.error)
	}
}

func TestBrowserShortcutWithoutURLReportsError(t *testing.T) {
	a := &app{}
	a.openBrowser()
	if a.error == "" {
		t.Fatal("empty web URL did not set an error")
	}
}
