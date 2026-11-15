package main

import "testing"

// A window close hides when this process owns a local Host, and ends the
// process otherwise: the Host keeps its tasks alive only while it is owned.
func TestWindowCloseAction(t *testing.T) {
	plain := &app{}
	if got := plain.windowCloseAction(); got != closeQuit {
		t.Fatalf("no local runtime: %v, want closeQuit", got)
	}
	owned := &app{localRuntime: &localRuntime{}}
	if got := owned.windowCloseAction(); got != closeHide {
		t.Fatalf("owned local runtime: %v, want closeHide", got)
	}
}

// A bounded QA launch must never block on a quit prompt.
func TestConfirmQuitAutoQuit(t *testing.T) {
	previous := shellAutoQuit
	shellAutoQuit = true
	defer func() { shellAutoQuit = previous }()
	a := &app{localRuntime: &localRuntime{page: nil}}
	if !a.confirmQuit() {
		t.Fatal("auto-quit launch must not ask")
	}
}

// With nothing running there is nothing to interrupt, so no prompt appears.
func TestConfirmQuitWithoutRuntime(t *testing.T) {
	previous := shellAutoQuit
	shellAutoQuit = false
	defer func() { shellAutoQuit = previous }()
	if !(&app{}).confirmQuit() {
		t.Fatal("no runtime must not ask")
	}
	if !(&app{localRuntime: &localRuntime{}}).confirmQuit() {
		t.Fatal("starting runtime must not ask")
	}
}

func TestShellDiagnostics(t *testing.T) {
	if got := (&app{}).shellDiagnostics(); got != "shell: native workspace" {
		t.Errorf("diagnostics = %q", got)
	}
	failed := &app{localRuntime: &localRuntime{err: "boom"}}
	if got := failed.shellDiagnostics(); got != "shell: local workspace failed: boom" {
		t.Errorf("diagnostics = %q", got)
	}
}
