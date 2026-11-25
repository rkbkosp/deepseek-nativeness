package main

import "testing"

func TestAdjustFontClampsAndPersistsInMemory(t *testing.T) {
	p := defaultViewPreferences()
	p.FontSize = 22
	a := &app{demo: true, uiPrefs: p}
	a.adjustFont("text", 1)
	if a.uiPrefs.FontSize != 22 {
		t.Fatalf("text max = %v", a.uiPrefs.FontSize)
	}
	a.uiPrefs.CodeFontSize = 10
	a.adjustFont("code", -1)
	if a.uiPrefs.CodeFontSize != 10 {
		t.Fatalf("code min = %v", a.uiPrefs.CodeFontSize)
	}
	a.uiPrefs.TerminalFontSize = 13
	a.adjustFont("terminal", 1)
	if a.uiPrefs.TerminalFontSize != 14 {
		t.Fatalf("terminal = %v", a.uiPrefs.TerminalFontSize)
	}
}
