package main

import (
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

func nativeAppearanceSource(preference string) mygo.ThemeSource {
	switch preference {
	case "light":
		return mygo.ThemeLight
	case "dark":
		return mygo.ThemeDark
	default:
		return mygo.ThemeSystem
	}
}

// Only startup and an explicit changed preference set the app appearance.
// ThemeSystem clears AppKit's app override; effectiveDark is read afterwards,
// so returning to System cannot retain the former forced-dark value.
func (a *app) changeAppearance(preference string, setSource func(mygo.ThemeSource), isDark func() bool) bool {
	if preference != "light" && preference != "dark" && preference != "system" {
		return false
	}
	if a.uiPrefs.Theme == preference {
		return false
	}
	a.uiPrefs.Theme = preference
	setSource(nativeAppearanceSource(preference))
	a.effectiveDark = isDark()
	return true
}

func (a *app) selectAppearance(preference string) {
	if a.changeAppearance(preference, mygo.Theme.SetSource, mygo.Theme.IsDark) {
		a.savePreferences()
	}
}

// SettingsRoot.panel uses bg-layer-2, not the generic popup surface. The
// original design-platform token resolves to neutral-bluish-00 / -850.
func (a *app) settingsPanelFill() ui.Color {
	if a.theme.Dark {
		return ui.RGB(44, 44, 46)
	}
	return ui.RGB(255, 255, 255)
}
