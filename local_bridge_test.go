package main

// The local carrier's Go half: where the helper lives, that the payload it is
// pointed at is usable by exec, and that local mode does not borrow Remote copy.

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// exec resolves a relative command against the child's Dir, so a development
// payload must be absolute before the launcher is spawned.
func TestRuntimePayloadPathsAreAbsolute(t *testing.T) {
	payload, err := loadRuntimePayload(filepath.Join("build", "runtime"))
	if err != nil {
		t.Skipf("no development runtime payload: %v", err)
	}
	paths := map[string]string{
		"root":            payload.Root,
		"dsh":             payload.Dsh,
		"primary runtime": payload.PrimaryRuntime,
		"node":            payload.Node,
		"launcher":        payload.Launcher,
		"pnpm":            payload.Pnpm,
	}
	for name, path := range paths {
		if !filepath.IsAbs(path) {
			t.Errorf("%s is not absolute: %q", name, path)
		}
	}
	if runtime.GOOS == "darwin" {
		if _, err := os.Stat(payload.Node); err != nil {
			t.Errorf("payload node binary is missing: %v", err)
		}
	}
	if _, err := os.Stat(payload.Launcher); err != nil {
		t.Errorf("payload launcher is missing: %v", err)
	}
}

func TestResolveLocalHelperFindsTheSourceHelper(t *testing.T) {
	helper, err := resolveLocalHelper()
	if err != nil {
		t.Fatalf("resolveLocalHelper: %v", err)
	}
	if !filepath.IsAbs(helper) {
		t.Fatalf("helper path is not absolute: %q", helper)
	}
	if filepath.Base(helper) != "local-bridge.mjs" {
		t.Fatalf("unexpected helper: %q", helper)
	}
	if !strings.HasSuffix(filepath.ToSlash(filepath.Dir(helper)), "/remote") {
		t.Fatalf("helper is not in the remote resource directory: %q", helper)
	}
}

func TestLocalModeReplacesRemoteCopy(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	if a.localMode() {
		t.Fatal("a Remote-only launch is not local mode")
	}
	if got := a.connectedLabel(); !strings.Contains(got, "Remote") {
		t.Fatalf("Remote launch label changed: %q", got)
	}
	a.localRuntime = &localRuntime{native: true}
	if !a.localMode() {
		t.Fatal("--local-native is local mode")
	}
	if got := a.connectedLabel(); !strings.Contains(got, "本地") {
		t.Fatalf("local launch still speaks Remote: %q", got)
	}
	if got := a.hostNavLabel(); got != "本地 Host" {
		t.Fatalf("host nav label: %q", got)
	}
	if got := a.workspaceHintLabel(); got == "" || strings.Contains(got, "远程") {
		t.Fatalf("workspace hint still points at a Remote server: %q", got)
	}
}

// The local helper is started only after the Host publishes a ready URL.
func TestLocalBridgeRequiresAResolvedPayload(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	// Headless: run UI-thread work inline instead of queueing it to a window.
	a.testDispatch = func(fn func()) { fn() }
	local := &localRuntime{native: true}
	a.localRuntime = local
	a.openLocalBridge(local)
	if local.err == "" {
		t.Fatal("a missing payload must be reported, not ignored")
	}
	if a.client != nil {
		t.Fatal("no helper may be started without a payload")
	}
}
