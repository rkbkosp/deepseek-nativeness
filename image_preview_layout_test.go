package main

import (
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"testing"
)

func TestImagePreviewActualWebViewPlacementFiniteOnResizeAndClose(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	a.compat = &mygo.WebView{}
	a.compatPlacement = "imagePreview"
	a.compatOwner = "fixture-owner"
	destroyed := 0
	a.testDestroyCompat = func(*mygo.WebView) { destroyed++ }
	tt := ui.NewTester(a.view, 1280, 820)
	for _, size := range []struct{ w, h int }{{1280, 820}, {780, 560}, {1000, 700}} {
		tt.SetSize(size.w, size.h)
		tt.Frame()
		panelW := min(float32(1000), float32(size.w)-48)
		left := (float32(size.w) - panelW) / 2
		top := float32(40)
		if tt.WebViewAt(left+20, top+60) != a.compat {
			t.Fatal("preview content has no native WebView placement", size)
		}
		if tt.WebViewAt(left+20, top+10) != nil || tt.WebViewAt(left+20, float32(size.h)-42) != nil || tt.WebViewAt(left-1, top+60) != nil {
			t.Fatal("preview WebView escaped finite content", size)
		}
	}
	tt.Key(0, ui.KeyEscape)
	tt.Frame()
	if destroyed != 1 || a.compat != nil || a.compatOwner != "" || tt.WebViewAt(500, 300) != nil {
		t.Fatal("preview close retained native view or owner")
	}
}
