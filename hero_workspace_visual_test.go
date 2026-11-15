package main

import (
	"image/png"
	"os"
	"testing"

	"github.com/egoist/mygo/ui"
)

// TestHeroWorkspaceVisualCapture writes the blank-Session hero with its
// Workspace seat in both appearances, plus the open chip. It is skipped unless
// DSH_CAPTURE=1, like the other local capture tests.
func TestHeroWorkspaceVisualCapture(t *testing.T) {
	if os.Getenv("DSH_CAPTURE") == "" {
		t.Skip("set DSH_CAPTURE=1 to write local baseline PNGs")
	}
	a := heroWorkspaceApp(t)
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	capture := func(name string) {
		t.Helper()
		file, err := os.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if err := png.Encode(file, tt.Image()); err != nil {
			t.Fatal(err)
		}
		_ = file.Close()
	}
	capture("/tmp/native-hero-workspace.png")
	for _, dark := range []bool{true, false} {
		a.effectiveDark = dark
		a.appearanceSignature = ""
		tt.SetDark(dark)
		tt.Frame()
		name := "/tmp/native-hero-workspace-light.png"
		if dark {
			name = "/tmp/native-hero-workspace-dark.png"
		}
		capture(name)
	}
	if err := tt.Click("选择工作区"); err != nil {
		t.Fatal(err)
	}
	capture("/tmp/native-hero-workspace-open.png")
}
