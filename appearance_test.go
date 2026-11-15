package main

import (
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"testing"
)

func TestAppearanceIntentAppliesNativeOverrideOnceAndRestoresSystem(t *testing.T) {
	a := &app{uiPrefs: defaultViewPreferences()}
	systemDark, effectiveDark := false, false
	var applied []mygo.ThemeSource
	setSource := func(source mygo.ThemeSource) {
		applied = append(applied, source)
		switch source {
		case mygo.ThemeDark:
			effectiveDark = true
		case mygo.ThemeLight:
			effectiveDark = false
		case mygo.ThemeSystem:
			effectiveDark = systemDark
		}
	}
	isDark := func() bool { return effectiveDark }
	if !a.changeAppearance("dark", setSource, isDark) || !a.effectiveDark {
		t.Fatal("forced dark did not update both native source and drawing appearance")
	}
	if a.changeAppearance("dark", setSource, isDark) || len(applied) != 1 {
		t.Fatal("unchanged selection reapplied the native appearance")
	}
	if !a.changeAppearance("system", setSource, isDark) || a.effectiveDark || a.uiPrefs.Theme != "system" {
		t.Fatal("returning to System kept the former dark override or stored an inferred theme")
	}
	systemDark = true
	if !a.changeAppearance("light", setSource, isDark) || a.effectiveDark {
		t.Fatal("forced light did not override the now-dark desktop")
	}
	if !a.changeAppearance("system", setSource, isDark) || !a.effectiveDark || a.uiPrefs.Theme != "system" {
		t.Fatal("System did not re-read the effective appearance after clearing override")
	}
	if a.changeAppearance("invalid", setSource, isDark) || len(applied) != 4 {
		t.Fatal("invalid input changed the native source")
	}
	if nativeAppearanceSource("") != mygo.ThemeSystem || nativeAppearanceSource("invalid") != mygo.ThemeSystem {
		t.Fatal("startup fallback must follow System")
	}
}

func TestSettingsPanelPaintMatchesOriginalLayerTwoInBothThemes(t *testing.T) {
	for _, dark := range []bool{false, true} {
		t.Run(map[bool]string{false: "light", true: "dark"}[dark], func(t *testing.T) {
			a := newApp(true)
			defer a.cancel()
			a.settingsOpen = true
			a.uiPrefs.Theme = map[bool]string{false: "light", true: "dark"}[dark]
			tt := ui.NewTester(func(c *ui.Context) { a.applyAppearance(c); a.settingsView(c) }, 1280, 820)
			tt.Frame()
			want := a.settingsPanelFill()
			r, g, b, alpha := tt.Image().At(420, 720).RGBA()
			if byte(r>>8) != want.R || byte(g>>8) != want.G || byte(b>>8) != want.B || alpha != 65535 {
				t.Fatalf("native modal blank rail pixel differs from original layer-2: rgba=%d/%d/%d/%d, token=%+v", r, g, b, alpha, want)
			}
		})
	}
}
