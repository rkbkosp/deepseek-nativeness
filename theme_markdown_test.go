package main

import (
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestMarkdownThemesDoNotShareOnePointer(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	a.uiPrefs.FontSize = 14
	tt := ui.NewTester(func(c *ui.Context) { a.applyAppearance(c); ui.Text(c, "x") }, 200, 100)
	tt.Frame()
	if a.md.Theme == nil || a.mdCompact.Theme == nil {
		t.Fatal("markdown themes not initialised")
	}
	if a.md.Theme.FontSize != 14 || a.mdCompact.Theme.FontSize != 13 {
		t.Fatalf("main=%v compact=%v", a.md.Theme.FontSize, a.mdCompact.Theme.FontSize)
	}
	a.mdCompact.Theme.FontSize = 99
	if a.md.Theme.FontSize == 99 {
		t.Fatal("main and compact markdown share the same theme")
	}
}
