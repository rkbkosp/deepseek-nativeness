package main

import "github.com/egoist/mygo/ui"

// Candidates are an overlay anchored to the native input, rather than a
// zero-intrinsic-height inline flex sibling. NativeView's public overlay seam
// keeps the panel painted and hit-tested above the external view.
func candidatePopup(c *ui.Context, anchor ui.Element, open *bool, items []candidate, highlight int, choose func(candidate)) ui.Element {
	return ui.PopoverBase(c, anchor, open, func(panel ui.Element) {
		theme := c.Theme()
		panel.Width(360).Height(float32(min(180, len(items)*36+12))).Padding(6).Radius(8).Background(theme.Surface).Border(1, theme.Border)
		ui.Scroll(c).Fill().MinHeight(0).Gap(4).Children(func() {
			for i, item := range items {
				item := item
				b := ui.Button(c, item.Label).FillWidth().Height(32).Shrink(0)
				if i == highlight {
					b.Background(theme.Accent).TextColor(ui.RGB(255, 255, 255))
				}
				if b.Clicked() {
					choose(item)
				}
			}
		})
	})
}
