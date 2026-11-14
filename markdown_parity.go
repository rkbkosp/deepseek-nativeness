package main

import (
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
	"github.com/egoist/mygo/ui/markdown/parser"
	"strings"
)

// The original DSH table has horizontal rules, without a surrounding box
// or vertical dividers. Use the public block extension, leaving MyGo frozen.
func (a *app) markdownBlock(c *ui.Context, d *parser.Document, i int) bool {
	if d.Block(i).Kind != parser.Table {
		return false
	}
	cols := len(d.Block(i).Align)
	if cols == 0 {
		return true
	}
	// Options owns an image cache containing sync.Map; never copy it after use.
	a.mdCell.Theme = a.md.Theme
	a.mdCell.OnLink = a.md.OnLink
	a.mdCell.CodeBlock = a.md.CodeBlock
	cellOptions := &a.mdCell
	ui.ScrollHorizontal(c).FillWidth().MinWidth(0).Children(func() {
		ui.Column(c).MinWidth(max(680, float32(cols)*120)).FillWidth().Role(ui.RoleTable).Children(func() {
			for r := range d.Children(i) {
				row := d.Block(r)
				ui.Row(c.Key(row.Start)).FillWidth().AlignItems(ui.Stretch).BorderWidth(0, 0, 1, 0).BorderColor(a.theme.Border).Role(ui.RoleRow).Children(func() {
					column := 0
					for cell := range d.Children(r) {
						b := d.Block(cell)
						source := strings.TrimSpace(d.Source()[b.Start:b.End])
						source = strings.Trim(source, "|")
						source = strings.TrimSpace(source)
						box := ui.Column(c).Grow(1).Basis(0).MinWidth(0).Padding(10, 0)
						if cols == 2 && column == 0 {
							box.Grow(0).Basis(190).Width(190).Shrink(0)
						}
						column++
						if row.Header {
							box.FontWeight(600).Role(ui.RoleColumnHeader)
						} else {
							box.Role(ui.RoleCell)
						}
						box.Children(func() { markdown.View(c, source, cellOptions) })
					}
				})
			}
		})
	})
	return true
}
