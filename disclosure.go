package main

import (
	"github.com/egoist/mygo/ui"
)

// disclosureRow reproduces the original 24 DIP process row: a 16 DIP leading
// box (icon, or a chevron on hover/open), a 13 DIP title, an optional 2x2 dot
// and summary, and a hover that only changes the ink. The body is indented
// under the title like the original DisclosureRow.
func (a *app) disclosureRow(c *ui.Context, key, iconName, title, summary string, open *bool, disabled, stateError bool, bodyIndent float32, body func()) {
	container := ui.Column(c).Key(key).FillWidth().MinWidth(0)
	container.Children(func() {
		button := ui.ButtonBase(c).FillWidth().Height(24).Padding(0).Gap(6).Justify(ui.Start).AlignItems(ui.Center).Label(title)
		if disabled {
			button.Disabled(true)
		}
		button.Children(func() {
			hovered := button.Hovered() && !disabled
			color := a.colors.Tertiary
			if hovered || *open {
				color = a.colors.Secondary
			}
			if stateError {
				color = a.theme.Danger
			}
			leading := ui.Box(c).Size(16, 16).Shrink(0).Center()
			leading.Children(func() {
				glyph := iconName
				switch {
				case body != nil && *open:
					glyph = "chevron-up-outline"
				case body != nil && hovered:
					glyph = "chevron-down-outline"
				}
				if glyph != "" {
					icon(c, glyph, 14).TextColor(color)
				}
			})
			ui.Text(c, title).FontSize(13).FixedLineHeight(24).TextColor(color).Shrink(0)
			if summary != "" {
				ui.Box(c).Size(2, 2).Radius(1).Shrink(0).Background(a.colors.Caption)
				ui.Text(c, summary).FontSize(13).FixedLineHeight(24).TextColor(color).SingleLine().Ellipsis("…").MinWidth(0).Shrink(1)
			} else {
				ui.Spacer(c)
			}
		})
		if button.Clicked() && !disabled && body != nil {
			*open = !*open
			c.Invalidate()
		}
		if *open && body != nil {
			ui.Column(c).FillWidth().MinWidth(0).Padding(4, 0).PaddingStart(bodyIndent).Gap(4).Children(body)
		}
	})
}
