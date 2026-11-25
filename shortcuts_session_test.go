package main

import "testing"

func TestRenameSessionShortcutOpensTheRenameRow(t *testing.T) {
	a := &app{
		sessionID:     "s1",
		connected:     true,
		sessions:      []session{{ID: "s1", Title: "原始标题"}},
		operationCaps: map[string]operationCapability{"renameSession": {Supported: true}},
	}
	a.renameCurrentSession()
	if a.renameID != "s1" || a.renameTitle != "原始标题" {
		t.Fatalf("rename state = %q %q", a.renameID, a.renameTitle)
	}
}

func TestDoubleEscapeArmsBeforeItStops(t *testing.T) {
	a := &app{sessionID: "s1"}
	a.current.Running = true
	a.dismissOverlay()
	if a.lastEscapeAt.IsZero() {
		t.Fatal("the first Escape did not arm the stop gesture")
	}
}

func TestRightPaneFullscreenTogglesAndRestores(t *testing.T) {
	a := &app{}
	a.toggleRightPaneFullscreen()
	if !a.rightPaneOpen || !a.rightPaneFull {
		t.Fatalf("first toggle = open %v full %v", a.rightPaneOpen, a.rightPaneFull)
	}
	a.toggleRightPaneFullscreen()
	if !a.rightPaneOpen || a.rightPaneFull {
		t.Fatalf("second toggle = open %v full %v", a.rightPaneOpen, a.rightPaneFull)
	}
}
