package main

import (
	"github.com/egoist/mygo/ui"
	"image/color"
	native "native-dsh/desktop/composer_native"
)

// A frame captures these scalars once. The painter, native command and debug
// label all use this same snapshot, never a mixture of pre/post-click state.
type proofNativeStyle struct {
	Dark                                                               bool
	Background, Foreground, Accent, Selection, Placeholder, FontFamily string
	FontSize                                                           float32
	FontWeight                                                         int
}
type proofThemeFrame struct {
	Theme *ui.Theme
	Style proofNativeStyle
}

func captureProofThemeFrame(dark bool, theme *ui.Theme) (proofThemeFrame, error) {
	copyTheme := *theme
	theme = &copyTheme
	background, err := native.OpaqueBackingToken(color.NRGBA{R: theme.Surface.R, G: theme.Surface.G, B: theme.Surface.B, A: theme.Surface.A}, color.NRGBA{R: theme.Background.R, G: theme.Background.G, B: theme.Background.B, A: theme.Background.A})
	if err != nil {
		return proofThemeFrame{}, err
	}
	style := proofNativeStyle{Dark: dark, Background: background, FontSize: theme.FontSize, FontWeight: 300, FontFamily: ""}
	if dark {
		style.Foreground = "#e0e0e2"
		style.Accent = "#9cbdff"
		style.Selection = "#304970"
		style.Placeholder = "#8e8e92"
	} else {
		style.Foreground = "#17181b"
		style.Accent = "#477be2"
		style.Selection = "#dce6fa"
		style.Placeholder = "#878a90"
	}
	return proofThemeFrame{Theme: theme, Style: style}, nil
}
func (s proofNativeStyle) command() native.Command {
	return native.Command{Op: "style", Style: map[string]any{"dark": s.Dark, "background": s.Background, "foreground": s.Foreground, "accent": s.Accent, "selection": s.Selection, "placeholder": s.Placeholder, "fontSize": s.FontSize, "fontWeight": s.FontWeight, "fontFamily": s.FontFamily}}
}

type proofThemeBinding struct {
	applied    proofNativeStyle
	hasApplied bool
}

func (b *proofThemeBinding) reconcile(frame proofThemeFrame, apply func(native.Command) bool) bool {
	if b.hasApplied && b.applied == frame.Style {
		return true
	}
	if !apply(frame.Style.command()) {
		return false
	}
	b.applied = frame.Style
	b.hasApplied = true
	return true
}

type proofThemeIntent uint8

const (
	toggleProofPalette proofThemeIntent = iota
	toggleProofHost
)

// Window.Update enqueues the intent after the current view transaction. The
// current frame therefore cannot cache new-dark with an old palette's color.
func queueProofThemeIntent(enqueue func(func()), dark, oppositeHost *bool, intent proofThemeIntent, applyHost func()) {
	enqueue(func() {
		if intent == toggleProofPalette {
			*dark = !*dark
		} else {
			*oppositeHost = !*oppositeHost
		}
		applyHost()
	})
}
