package main

import "github.com/egoist/mygo/ui"

// DSH uses an NSVisualEffect sidebar with translucent token washes. The
// conversation paints an opaque base over the same native window material.
func (a *app) sidebarFrame(c *ui.Context, shown float32) {
	width := 280 * shown
	ui.Row(c.Key("sidebar-frame")).Width(width).Shrink(0).AlignItems(ui.Stretch).Clip().Children(func() {
		surface := ui.Column(c).Width(280).FillHeight().Shrink(0).Margin(0, 0, 0, width-280)
		if c.Vibrancy() {
			tint := ui.RGBA(245, 247, 251, .4)
			top, bottom := float32(.1), float32(.09)
			if a.theme.Dark {
				tint = ui.RGBA(27, 27, 28, .5)
				top, bottom = .08, .07
			}
			if c.Preferences().ReduceTransparency {
				surface.Background(a.colors.Sidebar.Alpha(.9))
			} else {
				surface.Background(tint).Draw(func(p *ui.Painter, r ui.Rect) {
					p.FillGradient(r, ui.LinearGradient{Angle: 180, Stops: []ui.GradientStop{{Color: ui.RGBA(122, 155, 240, top), At: 0}, {Color: ui.RGBA(122, 155, 240, 0), At: .35}, {Color: ui.RGBA(143, 137, 184, 0), At: .68}, {Color: ui.RGBA(143, 137, 184, bottom), At: 1}}}, 0)
				})
			}
		}
		surface.Children(func() {ui.Column(c).Width(280).FillHeight().Opacity(shown).Children(func(){a.sidebarView(c)})})
	})
}
func (a *app) captionControls(c *ui.Context) {
	left := c.TitleBar().Left + 8
	if c.TitleBar().Left == 0 {
		left = 12
	}
	ui.Row(c.Key("caption-controls")).Absolute().Left(left).Top(11).Size(64, 28).Gap(8).AlignItems(ui.Center).Children(func() {
		if ui.ButtonBase(c).Size(28, 28).Radius(6).TextColor(a.theme.TextMuted).Label("展开侧栏").Tooltip("展开侧栏 ⌘B").Children(func() { icon(c, "panel-left-outline", 16) }).Clicked() {
			a.sidebar = true
		}
		if ui.ButtonBase(c).Size(28, 28).Radius(6).TextColor(a.theme.TextMuted).Label("新会话").Disabled(a.connected && !a.can("createSession")).Children(func() { icon(c, "new-chat-outline", 16) }).Clicked() {
			if a.connected {
				a.createSession()
			} else {
				a.connectionOpen = true
				a.fetchDevices()
			}
		}
	})
}
