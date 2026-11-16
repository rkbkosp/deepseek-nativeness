package main

import (
	"encoding/json"
	"fmt"

	"github.com/egoist/mygo/ui"
)

func (a *app) backgroundJobCount() int {
	count := 0
	for i := range a.current.Messages {
		tool := a.current.Messages[i].Tool
		if tool == nil || tool.ArgsRaw == "" {
			continue
		}
		var args map[string]any
		if json.Unmarshal([]byte(tool.ArgsRaw), &args) != nil {
			continue
		}
		if background, ok := args["run_in_background"].(bool); ok && background {
			count++
		}
	}
	return count
}

func (a *app) headerTerminalView(c *ui.Context) {
	if !a.can("listTerminals") {
		return
	}
	if ui.ButtonBase(c).Label("终端").Padding(4).Children(func() { icon(c, "code-outline", 15).TextColor(a.colors.Tertiary) }).Clicked() {
		a.rightPaneOpen = true
		a.openCompatAt("terminal", "right")
	}
}

func (a *app) headerJobsView(c *ui.Context) {
	if count := a.backgroundJobCount(); count > 0 {
		ui.Row(c).Height(22).Padding(0, 4).Gap(4).AlignItems(ui.Center).Tooltip(fmt.Sprintf("%d 个后台任务", count)).Children(func() {
			icon(c, "layers-outline", 14).TextColor(a.colors.Tertiary)
			ui.Text(c, fmt.Sprintf("%d", count)).FontSize(12).FixedLineHeight(20).TextColor(a.colors.Tertiary)
		})
	}
}
