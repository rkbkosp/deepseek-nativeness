package main

import (
	"fmt"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
)

type palette struct{ Sidebar, RowHover, Selected, Composer, Popup, Subtle ui.Color }
type viewPreferences struct {
	Theme              string              `json:"theme"`
	GroupBy            string              `json:"groupBy"`
	OrderBy            string              `json:"orderBy"`
	Archived           string              `json:"archived"`
	Expanded           map[string]bool     `json:"expanded"`
	ManualOrder        map[string][]string `json:"manualOrder"`
	FontSize           float32             `json:"fontSize"`
	CodeFontSize       float32             `json:"codeFontSize"`
	TerminalFontSize   float32             `json:"terminalFontSize"`
	TextFontFamily     string              `json:"textFontFamily"`
	CodeFontFamily     string              `json:"codeFontFamily"`
	TerminalFontFamily string              `json:"terminalFontFamily"`
	SendMode           string              `json:"sendMode"`
	Language           string              `json:"language"`
	StepsDetail        string              `json:"stepsDetail"`
	StepsCollapse      string              `json:"stepsCollapse"`
	FoldedReplies      string              `json:"foldedReplies"`
	CodeWorkView       bool                `json:"codeWorkView"`
	LinkOpen           string              `json:"linkOpen"`
	UsageDetail        string              `json:"usageDetail"`
}

func defaultViewPreferences() viewPreferences {
	return viewPreferences{Theme: "system", GroupBy: "workspace", OrderBy: "updated", Archived: "default", Expanded: map[string]bool{}, ManualOrder: map[string][]string{}, FontSize: 14, CodeFontSize: 11, TerminalFontSize: 13, SendMode: "queue", Language: "zh", StepsDetail: "standard", StepsCollapse: "completion", FoldedReplies: "all", CodeWorkView: true, LinkOpen: "sidebar", UsageDetail: "detailed"}
}
func (a *app) applyAppearance(c *ui.Context) {
	dark := a.systemDark
	if a.uiPrefs.Theme == "dark" {
		dark = true
	} else if a.uiPrefs.Theme == "light" {
		dark = false
	}
	if a.theme.Dark != dark || a.contentFontSize != a.uiPrefs.FontSize || a.appearanceSignature != a.fontSignature() || a.colors.Sidebar.A == 0 {
		t := ui.LightTheme()
		if dark {
			t = ui.DarkTheme()
		}
		t.FontSize = 14
		t.Font = "system-ui, PingFang SC"
		t.Radius = 10
		if dark {
			t.Background = ui.Hex("#141414")
			t.Surface = ui.Hex("#29292c")
			t.SurfaceHover = ui.Hex("#3b3b3e")
			t.SurfacePressed = ui.Hex("#454548")
			t.Border = ui.Hex("#38383a")
			t.Text = ui.Hex("#f2f2f3")
			t.TextMuted = ui.Hex("#96979c")
			t.Accent = ui.Hex("#8aaef0")
			t.AccentHover = ui.Hex("#9dbcf3")
			a.colors = palette{Sidebar: ui.Hex("#303033"), RowHover: ui.Hex("#3d3d40"), Selected: ui.Hex("#414144"), Composer: ui.Hex("#29292c"), Popup: ui.Hex("#29292f"), Subtle: ui.Hex("#232325")}
		} else {
			t.Background = ui.Hex("#ffffff")
			t.Text = ui.Hex("#141518")
			t.TextMuted = ui.Hex("#878a90")
			t.Accent = ui.Hex("#477be2")
			t.AccentHover = ui.Hex("#386ed2")
			a.colors = palette{Sidebar: ui.Hex("#e9eaee"), RowHover: ui.Hex("#dfe1e5"), Selected: ui.Hex("#dfe0e4"), Composer: ui.Hex("#ffffff"), Popup: ui.Hex("#f7f7f9"), Subtle: ui.Hex("#f3f5f8")}
		}
		// DSH design-platform.css aliases, not screenshot sampled values.
		if dark {
			t.Background = ui.Hex("#151517")
			t.Surface = ui.Hex("#2c2c2e")
			t.Text = ui.Hex("#f9fafb")
			t.TextMuted = ui.Hex("#979da6")
			t.Accent = ui.Hex("#5686fe")
			t.Border = ui.RGBA(255, 255, 255, 0.12)
			a.colors.Composer = t.Surface
			a.colors.Subtle = ui.Hex("#232324")
			a.colors.Popup = ui.Hex("#2c2c2e")
			a.colors.Selected = ui.Hex("#43454a")
		}
		a.theme = t
		a.contentFontSize = a.uiPrefs.FontSize
		a.appearanceSignature = a.fontSignature()
		md := markdown.DefaultTheme(t)
		md.FontSize = a.uiPrefs.FontSize
		if a.uiPrefs.TextFontFamily != "" {
			md.Font = a.uiPrefs.TextFontFamily
		}
		if a.uiPrefs.CodeFontFamily != "" {
			md.CodeFont = a.uiPrefs.CodeFontFamily
		}
		md.CodeSize = a.uiPrefs.CodeFontSize / a.uiPrefs.FontSize
		// CodeCard's content inset is 22 DIP, independent of the message font.
		md.CodeBlockPadding = 22 / a.uiPrefs.FontSize
		md.LineHeight = 1.7
		md.BlockSpacing = .85
		md.CodeBlockBackground = t.Surface
		md.CodeBlockBorder = t.Border
		md.TableHeader = ui.Transparent
		md.TableStripe = ui.Transparent
		md.TableBorder = t.Border
		for i, size := range []float32{21, 19, 18, 14, 14, 14} {
			md.Headings[i].Size = size / 14
			md.Headings[i].Weight = 600
		}
		a.md.Theme = md
	}
	c.SetTheme(a.theme)
}
func (a *app) fontSignature() string {
	return a.uiPrefs.TextFontFamily + "\x00" + a.uiPrefs.CodeFontFamily + "\x00" + fmt.Sprint(a.uiPrefs.CodeFontSize)
}

// The macOS native rasterizer and Chromium's default stack produce different
// stroke coverage at the same numeric weight. Local 14-DIP calibration against
// the original app selected 300 for normal default-stack text. Custom faces
// retain their normal 400 and explicit headings/strong text keep their weights.
func (a *app) messageNormalWeight() int {
	if a.uiPrefs.TextFontFamily != "" || a.uiPrefs.CodeFontFamily != "" {
		return 400
	}
	return 300
}
func (a *app) messageFontFamily() string {
	if a.uiPrefs.TextFontFamily != "" {
		return a.uiPrefs.TextFontFamily
	}
	return "system-ui, PingFang SC"
}
