package main

import (
	"encoding/json"
	"fmt"

	"github.com/egoist/mygo/ui"
)

func (a *app) headerSubagentView(c *ui.Context) {
	if a.composer == nil {
		return
	}
	entries := a.composer.values.SubagentCatalog
	if len(entries) == 0 {
		return
	}
	label := fmt.Sprintf("子智能体 %d", len(entries))
	button := ui.ButtonBase(c).Label(label).Height(22).Padding(0, 4).Gap(4).Radius(4).Tooltip("本会话的子智能体")
	button.Children(func() {
		icon(c, "agent-preset-outline", 14).TextColor(a.colors.Tertiary)
		ui.Text(c, fmt.Sprintf("%d", len(entries))).FontSize(12).FixedLineHeight(20).TextColor(a.colors.Tertiary)
	})
	button.Menu(func(m *ui.Menu) {
		for _, entry := range entries {
			name := entry.Label
			if name == "" {
				name = "子智能体"
			}
			if m.Item(name).Chosen() {
				if a.subagentTitles == nil {
					a.subagentTitles = map[string]string{}
				}
				a.subagentTitles[entry.ID] = name
				a.openSession(entry.ID)
			}
		}
	})
}

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
