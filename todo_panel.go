package main

import (
	"fmt"
	"strings"

	"github.com/egoist/mygo/ui"
)

type todoItem struct {
	Content string `json:"content"`
	Status  string `json:"status"`
}

func todoProgress(items []todoItem) string {
	done, active := 0, 0
	for _, item := range items {
		switch item.Status {
		case "completed":
			done++
		case "in_progress":
			active++
		}
	}
	pending := len(items) - done - active
	parts := []string{}
	if done > 0 {
		parts = append(parts, fmt.Sprintf("%d 已完成", done))
	}
	if active > 0 {
		parts = append(parts, fmt.Sprintf("%d 进行中", active))
	}
	if pending > 0 {
		parts = append(parts, fmt.Sprintf("%d 待处理", pending))
	}
	return strings.Join(parts, "  ·  ")
}

func (a *app) todoPanelView(c *ui.Context, s *composerState) {
	if s.values.Todos == nil || len(*s.values.Todos) == 0 {
		return
	}
	items := *s.values.Todos
	ui.Column(c).FillWidth().MinWidth(0).Margin(0, 8, 0, 8).Padding(2, 0).Radius(16).Background(a.colors.Popup).
		BorderWidth(.5, .5, 0, .5).BorderColor(a.theme.Border).Children(func() {
		header := ui.ButtonBase(c).Height(36).FillWidth().Padding(4, 12).Gap(10).AlignItems(ui.Center).Label("任务清单")
		header.Children(func() {
			icon(c, "checklist-outline", 16).TextColor(a.colors.Tertiary)
			ui.Text(c, "任务").FontSize(13).FixedLineHeight(24).FontWeight(500).TextColor(a.theme.Text)
			ui.Text(c, todoProgress(items)).FontSize(13).FixedLineHeight(20).TextColor(a.colors.Tertiary).Grow(1).SingleLine().Ellipsis("…")
			glyph := "chevron-up-outline"
			if s.todoOpen {
				glyph = "chevron-down-outline"
			}
			icon(c, glyph, 14).TextColor(a.colors.Tertiary)
		})
		if header.Clicked() {
			s.todoOpen = !s.todoOpen
			c.Invalidate()
		}
		if s.todoOpen {
			ui.Scroll(c).MaxHeight(180).Children(func() {
				ui.Column(c).FillWidth().Padding(0, 12, 4, 12).Gap(2).Children(func() {
					for _, item := range items {
						color := a.colors.Tertiary
						switch item.Status {
						case "completed":
							color = a.theme.Success
						case "in_progress":
							color = a.colors.Link
						}
						ui.Row(c).Gap(8).AlignItems(ui.Center).Padding(4, 0).Children(func() {
							ui.Box(c).Size(6, 6).Radius(3).Shrink(0).Background(color)
							ui.Text(c, item.Content).FontSize(13).FixedLineHeight(20).TextColor(a.colors.Secondary).Wrap().Grow(1)
						})
					}
				})
			})
		}
	})
}
