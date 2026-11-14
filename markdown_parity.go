package main

import (
	"fmt"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
	"github.com/egoist/mygo/ui/markdown/parser"
	"strings"
)

type tableCellMeasure struct {
	Source string
	Header bool
	Width  float32
}
type markdownTableState struct {
	Source, Font string
	Natural      []float32
	Cells        []tableCellMeasure
}

// Use the frozen MarkdownText/TableWrapper rules, with finite flex bases:
// under four columns (and all quoted tables) fill and wrap; comparison tables
// retain natural columns and may use the transcript gutter for horizontal scroll.
func (a *app) markdownBlock(c *ui.Context, d *parser.Document, index int) bool {
	block := d.Block(index)
	if block.Kind != parser.Table {
		return false
	}
	cols := len(block.Align)
	if cols == 0 {
		return true
	}
	quoteDepth := 0
	indent := float32(0)
	for parent := block.Parent; parent >= 0; parent = d.Block(parent).Parent {
		switch d.Block(parent).Kind {
		case parser.Quote:
			quoteDepth++
			indent += a.md.Theme.QuoteBarWidth + .85*a.uiPrefs.FontSize
		case parser.List:
			list := d.Block(parent)
			markerWidth := a.md.Theme.ListIndent * a.uiPrefs.FontSize
			if list.Ordered {
				count := 0
				for range d.Children(parent) {
					count++
				}
				w, _ := c.MeasureText(0, ui.Span{Text: fmt.Sprintf("%d%c", list.Number+max(0, count-1), list.Marker), Font: a.messageFontFamily(), Size: a.uiPrefs.FontSize})
				markerWidth = max(markerWidth, w+.5*a.uiPrefs.FontSize)
			}
			indent += markerWidth
		}
	}
	wide := cols >= 4 && quoteDepth == 0
	scroll := ui.ScrollHorizontal(c).FillWidth().MinWidth(0).Label("Markdown 表格横向滚动")
	state := ui.Local(scroll, "table-widths", func() markdownTableState { return markdownTableState{} })
	tableFont := max(float32(1), a.uiPrefs.FontSize-1)
	codeFont := a.md.Theme.CodeFont
	fontKey := fmt.Sprintf("%s/%s/%g/%g/%d", a.messageFontFamily(), codeFont, tableFont, a.uiPrefs.CodeFontSize, a.messageNormalWeight())
	source := d.Source()[block.Start:block.End]
	if state.Source != source || state.Font != fontKey || len(state.Natural) != cols {
		natural := make([]float32, cols)
		measures := make([]tableCellMeasure, 0, len(state.Cells))
		measureIndex := 0
		for rowIndex := range d.Children(index) {
			row := d.Block(rowIndex)
			column := 0
			for cell := range d.Children(rowIndex) {
				if column >= cols {
					break
				}
				raw := tableCellSource(d, cell)
				width := float32(0)
				if measureIndex < len(state.Cells) && state.Font == fontKey && state.Cells[measureIndex].Source == raw && state.Cells[measureIndex].Header == row.Header {
					width = state.Cells[measureIndex].Width
				} else {
					spans := tableCellSpans(d.Inlines(cell), a.messageFontFamily(), codeFont, tableFont, a.uiPrefs.CodeFontSize, a.messageNormalWeight(), row.Header)
					width, _ = c.MeasureText(0, spans...)
				}
				natural[column] = max(natural[column], width)
				measures = append(measures, tableCellMeasure{raw, row.Header, width})
				column++
				measureIndex++
			}
		}
		state.Source, state.Font, state.Natural, state.Cells = source, fontKey, natural, measures
	}
	windowWidth, _ := c.Size()
	maxCell := min(float32(320), windowWidth*.3)
	widths, floors := make([]float32, cols), make([]float32, cols)
	naturalTotal, minTotal := float32(0), float32(0)
	for k := range cols {
		// The original CSS cell floors/ceilings describe the content box; padding
		// is added separately, with no leading padding and no trailing body padding.
		left, right := float32(16), float32(16)
		if k == 0 {
			left = 0
		}
		widths[k] = max(float32(100), min(maxCell, state.Natural[k])) + left + right
		floors[k] = 100 + left + right
		naturalTotal += widths[k]
		minTotal += floors[k]
	}
	if wide {
		scroll.Focusable()
		viewport := max(float32(0), a.conversationColumnWidth(c)-64)
		spare := max(float32(0), (viewport-a.chatContentWidth(c))/2)
		lead := spare + indent
		scroll.FillWidth().Width(viewport).Margin(0, 0, 0, -lead).Padding(0, 0, 0, lead)
	}
	// Percentage widths inside an intrinsic horizontal scroll subtree resolve
	// against its max-content size in MyGo. Supply the finite column width here,
	// rather than letting one long path inflate every cell and the entire table.
	gridWidth := naturalTotal
	if !wide {
		gridWidth = max(minTotal, a.chatContentWidth(c)-indent)
		widths = fitTableColumns(widths, floors, gridWidth)
	}
	theme := *a.md.Theme
	theme.FontSize = tableFont
	theme.LineHeight = (22 + a.uiPrefs.FontSize - 14) / tableFont
	theme.CodeSize = a.uiPrefs.CodeFontSize / tableFont
	a.mdCell.Theme = &theme
	a.mdCell.OnLink = a.md.OnLink
	a.mdCell.CodeBlock = a.md.CodeBlock
	scroll.Children(func() {
		grid := ui.Column(c).Role(ui.RoleTable).MinWidth(minTotal).Width(gridWidth).Shrink(0)
		grid.Children(func() {
			for rowIndex := range d.Children(index) {
				row := d.Block(rowIndex)
				ui.Row(c.Key(row.Start)).FillWidth().AlignItems(ui.Stretch).BorderWidth(0, 0, .5, 0).BorderColor(a.theme.Border).Role(ui.RoleRow).Children(func() {
					column := 0
					for cell := range d.Children(rowIndex) {
						if column >= cols {
							break
						}
						k := column
						column++
						left, right := float32(16), float32(16)
						if k == 0 {
							left = 0
						}
						if k == cols-1 && !row.Header {
							right = 0
						}
						box := ui.Column(c).MinWidth(floors[k]).Padding(10, right, 10, left).TextColor(a.theme.Text).FontWeight(a.messageNormalWeight())
						box.Width(widths[k]).Shrink(0)
						if row.Header {
							box.FontWeight(500).Role(ui.RoleColumnHeader)
						} else {
							box.Role(ui.RoleCell)
						}
						switch block.Align[k] {
						case parser.AlignCenter:
							box.TextAlign(ui.Center)
						case parser.AlignRight:
							box.TextAlign(ui.End)
						}
						raw := tableCellSource(d, cell)
						box.Children(func() { markdown.View(c, raw, &a.mdCell) })
					}
				})
			}
		})
	})
	return true
}

func fitTableColumns(preferred, floors []float32, target float32) []float32 {
	widths := append([]float32(nil), preferred...)
	total, flexible := float32(0), float32(0)
	for k, w := range widths {
		total += w
		flexible += w - floors[k]
	}
	for k, w := range widths {
		if total <= target {
			widths[k] = w + (target-total)*w/total
		} else if flexible > 0 {
			widths[k] = w - (total-target)*(w-floors[k])/flexible
		}
	}
	return widths
}
func tableCellSource(d *parser.Document, index int) string { return strings.TrimSpace(d.Lines(index)) }
func tableCellSpans(inlines []parser.Inline, font, codeFont string, size, codeSize float32, weight int, header bool) []ui.Span {
	if header {
		weight = 500
	}
	var out []ui.Span
	var walk func(int, int, int, bool)
	walk = func(start, end, w int, italic bool) {
		for i := start; i < end; {
			in := inlines[i]
			next := max(i+1, in.Next)
			switch in.Kind {
			case parser.Text, parser.Math, parser.Mention, parser.Reference:
				out = append(out, ui.Span{Text: in.Text, Font: font, Size: size, Weight: w, Italic: italic})
			case parser.Code:
				out = append(out, ui.Span{Text: in.Text, Font: codeFont, Size: codeSize, Weight: w})
			case parser.SoftBreak:
				out = append(out, ui.Span{Text: " ", Font: font, Size: size, Weight: w})
			case parser.LineBreak:
				out = append(out, ui.Span{Text: "\n", Font: font, Size: size, Weight: w})
			case parser.HTML:
				if strings.HasPrefix(strings.ToLower(in.Text), "<br") {
					out = append(out, ui.Span{Text: "\n", Font: font, Size: size, Weight: w})
				}
			case parser.Strong:
				walk(i+1, min(next, end), 600, italic)
			case parser.Emphasis:
				walk(i+1, min(next, end), w, true)
			case parser.Link, parser.Strikethrough:
				walk(i+1, min(next, end), w, italic)
			}
			i = next
		}
	}
	walk(0, len(inlines), weight, false)
	return out
}
