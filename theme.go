package main

import (
	"fmt"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
)

type palette struct {
	Sidebar, RowHover, Selected, Composer, Popup, Subtle ui.Color
	Secondary, Tertiary, Caption, Bubble                 ui.Color
	CodeBlock, CodeBanner, InlineCode                    ui.Color
	Link, SendFill, HoverOverlay                         ui.Color
}
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
	PaneWidth          float32             `json:"paneWidth"`
}

func defaultViewPreferences() viewPreferences {
	return viewPreferences{Theme: "system", GroupBy: "workspace", OrderBy: "updated", Archived: "default", Expanded: map[string]bool{}, ManualOrder: map[string][]string{}, FontSize: 14, CodeFontSize: 11, TerminalFontSize: 13, SendMode: "queue", Language: "zh", StepsDetail: "standard", StepsCollapse: "completion", FoldedReplies: "all", CodeWorkView: true, LinkOpen: "sidebar", UsageDetail: "detailed"}
}
func (a *app) applyAppearance(c *ui.Context) {
	// IsDark reports the current app appearance, including an explicit override.
	// It is not a separately cached copy of the desktop's system preference.
	dark := a.effectiveDark
	if a.uiPrefs.Theme == "dark" {
		dark = true
	} else if a.uiPrefs.Theme == "light" {
		dark = false
	}
	if a.theme.Dark != dark || a.contentFontSize != a.uiPrefs.FontSize || a.appearanceSignature != a.fontSignature() || a.colors.Sidebar.A == 0 || a.md.Theme == nil {
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
			a.colors = palette{
				Sidebar: ui.Hex("#1b1b1c"), RowHover: ui.Hex("#262628"), Selected: ui.Hex("#303033"),
				Composer: ui.Hex("#2c2c2e"), Popup: ui.Hex("#2c2c2e"), Subtle: ui.Hex("#232324"),
				Secondary: ui.Hex("#cfd3d6"), Tertiary: ui.Hex("#adb2b8"), Caption: ui.Hex("#81858c"),
				Bubble: ui.Hex("#2c2c2e"), CodeBlock: ui.Hex("#1b1b1c"), CodeBanner: ui.Hex("#2c2c2e"),
				InlineCode: ui.Hex("#292929"), Link: ui.Hex("#7aaaff"), SendFill: ui.Hex("#7aaaff"),
				HoverOverlay: ui.RGBA(255, 255, 255, 0.08),
			}
		} else {
			t.Background = ui.Hex("#ffffff")
			t.Text = ui.Hex("#141518")
			t.TextMuted = ui.Hex("#878a90")
			t.Accent = ui.Hex("#477be2")
			t.AccentHover = ui.Hex("#386ed2")
			a.colors = palette{
				Sidebar: ui.Hex("#e9eaee"), RowHover: ui.Hex("#dfe1e5"), Selected: ui.Hex("#dfe0e4"),
				Composer: ui.Hex("#ffffff"), Popup: ui.Hex("#f7f7f9"), Subtle: ui.Hex("#f3f5f8"),
				Secondary: ui.Hex("#61666b"), Tertiary: ui.Hex("#81858c"), Caption: ui.Hex("#adb2b8"),
				Bubble: ui.Hex("#edf3fe"), CodeBlock: ui.Hex("#f9fafb"), CodeBanner: ui.Hex("#f9fafb"),
				InlineCode: ui.Hex("#fafafa"), Link: ui.Hex("#4176e6"), SendFill: ui.Hex("#4176e6"),
				HoverOverlay: ui.RGBA(38, 49, 72, 0.06),
			}
		}
		// DSH design-platform.css aliases, not screenshot sampled values.
		if dark {
			t.Background = ui.Hex("#151517")
			t.Surface = ui.Hex("#2c2c2e")
			t.Text = ui.Hex("#f9fafb")
			t.TextMuted = a.colors.Tertiary
			t.Accent = a.colors.Link
			t.AccentHover = ui.Hex("#9bbeff")
			t.Border = ui.RGBA(255, 255, 255, 0.12)
			t.Selection = ui.RGBA(122, 170, 255, 0.30)
			a.colors.Selected = ui.Hex("#43454a")
		} else {
			t.Text = ui.Hex("#0f1115")
			t.TextMuted = a.colors.Tertiary
			t.Accent = a.colors.Link
			t.AccentHover = ui.Hex("#386ed2")
			t.Border = ui.RGBA(0, 0, 0, 0.10)
		}
		a.theme = t
		a.contentFontSize = a.uiPrefs.FontSize
		a.appearanceSignature = a.fontSignature()
		md := markdown.DefaultTheme(t)
		size := a.uiPrefs.FontSize
		codeSize := a.uiPrefs.CodeFontSize
		md.FontSize = size
		if a.uiPrefs.TextFontFamily != "" {
			md.Font = a.uiPrefs.TextFontFamily
		}
		if a.uiPrefs.CodeFontFamily != "" {
			md.CodeFont = a.uiPrefs.CodeFontFamily
		}
		md.CodeSize = codeSize / size
		md.CodeLineHeight = 19 / codeSize
		md.CodeBlockPadding = 16 / size
		md.CodeBlockRadius = 16
		md.LineHeight = (size + 8) / size
		md.BlockSpacing = 16 / size
		md.ListIndent = 18 / size
		md.ItemSpacing = 6 / size
		md.LinkWeight = 500
		md.Link = a.colors.Link
		md.CodeBackground = a.colors.InlineCode
		md.CodeBlockBackground = a.colors.CodeBlock
		md.CodeBlockBorder = ui.Transparent
		md.QuoteBar = a.colors.Caption
		md.QuoteBarWidth = 2
		md.QuoteText = t.Text
		md.Rule = t.Border
		md.TableHeader = ui.Transparent
		md.TableStripe = ui.Transparent
		md.TableBorder = t.Border
		md.TableCellPadding = [2]float32{16 / size, 10 / size}
		base := [6]float32{21, 19, 18, 14, 14, 14}
		for i := range md.Headings {
			delta := base[i] - 14
			md.Headings[i].Size = (size + delta) / size
			if i < 3 {
				md.Headings[i].Weight = 700
				md.Headings[i].Top = 32 / size
				md.Headings[i].Bottom = 16 / size
			} else {
				md.Headings[i].Weight = 600
				md.Headings[i].Top = 16 / size
				md.Headings[i].Bottom = 16 / size
			}
		}
		a.md.Theme = md
		compact := *md
		compact.FontSize = 13
		compact.LineHeight = 20.0 / 13
		compact.BlockSpacing = 4.0 / 13
		compact.ItemSpacing = 2.0 / 13
		compact.ListIndent = 18.0 / 13
		compact.CodeSize = codeSize / 13
		compact.CodeLineHeight = 18.0 / codeSize
		compact.CodeBlockPadding = 12.0 / 13
		for i := range compact.Headings {
			compact.Headings[i].Size = 1
			compact.Headings[i].Weight = 600
			compact.Headings[i].Top = 8.0 / 13
			compact.Headings[i].Bottom = 4.0 / 13
		}
		a.mdCompact.Theme = &compact
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
