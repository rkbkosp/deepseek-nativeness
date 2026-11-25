package main

import "github.com/egoist/mygo/ui"

// fullscreenCaption restores the caption chrome macOS hides in full screen: a
// compact strip with an explicit way back to the windowed layout.
func (a *app) fullscreenCaption(c *ui.Context) {
	if !a.fullscreen {
		return
	}
	ui.Row(c).Absolute().Top(0).Left(0).Right(0).Height(28).Padding(0, 12).AlignItems(ui.Center).Justify(ui.End).Children(func() {
		if ui.ButtonBase(c).Height(22).Padding(2, 8).Radius(6).Label("退出全屏").Children(func() {
			icon(c, "fullscreen-outline", 13).TextColor(a.theme.TextMuted)
			ui.Text(c, "退出全屏").FontSize(11).TextColor(a.theme.TextMuted)
		}).Clicked() {
			if a.win != nil {
				a.win.SetFullScreen(false)
			}
		}
	})
}
