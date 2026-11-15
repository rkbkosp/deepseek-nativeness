package main

import (
	"bytes"
	"image"
	_ "image/png"
	"path/filepath"
	"testing"
)

func TestProductNameIsDeepSeekNativeness(t *testing.T) {
	if productName != "DeepSeek Nativeness" {
		t.Fatalf("productName = %q", productName)
	}
}

// TestAppIconMatchesOriginal keeps the reused icon honest: the embedded Dock
// image must stay a decodable 1024×1024 PNG (MyGo's Dock API takes PNG bytes).
func TestAppIconMatchesOriginal(t *testing.T) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(appIconPNG))
	if err != nil {
		t.Fatalf("embedded app icon: %v", err)
	}
	if format != "png" {
		t.Fatalf("embedded app icon format = %q", format)
	}
	if cfg.Width != 1024 || cfg.Height != 1024 {
		t.Fatalf("embedded app icon = %dx%d, want 1024x1024", cfg.Width, cfg.Height)
	}
}

// TestPreferencesPathSurvivesRename pins the deliberate split between the
// renamed product and the original client-state directory.
func TestPreferencesPathSurvivesRename(t *testing.T) {
	path := preferencePath()
	if path == "" {
		t.Skip("no user config directory")
	}
	if got := filepath.Base(filepath.Dir(path)); got != "Native DSH Remote" {
		t.Fatalf("preferences directory = %q; renaming it would drop stored preferences", got)
	}
}
