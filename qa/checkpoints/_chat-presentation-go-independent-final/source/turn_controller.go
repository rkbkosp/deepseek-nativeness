package main

import (
	"fmt"
	"github.com/egoist/mygo/ui"
)

func (a *app) turnProcessIsOpen(row chatRow) bool {
	if row.AlwaysOpen {
		return true
	}
	if value, ok := a.turnProcessChoices[row.FoldKey]; ok {
		return value
	}
	return row.DefaultOpen
}
func (a *app) toggleTurnProcess(row chatRow) {
	if !row.CanCollapse || row.AlwaysOpen {
		return
	}
	open := a.turnProcessIsOpen(row)
	if a.turnProcessChoices == nil {
		a.turnProcessChoices = map[string]bool{}
	}
	a.turnProcessChoices[row.FoldKey] = !open
	// Only the visible row projection changes; body and placement indexes stay.
	a.chatStructureRevision++
}
func turnProcessLabel(row chatRow) string {
	switch row.ProcessReason {
	case "aborted", "interrupted":
		return "已停止"
	case "error":
		return "处理失败"
	}
	if row.ProcessDuration != nil {
		return "已完成，用时 " + formatProcessDuration(*row.ProcessDuration)
	}
	return "已完成"
}
func (a *app) turnControllerView(c *ui.Context, row chatRow) {
	if row.ProcessStatus != "closed" {
		return
	}
	open := a.turnProcessIsOpen(row)
	button := ui.ButtonBase(c.Key(row.ID)).Label(fmt.Sprintf("轮次执行过程 %d", row.Turn)).Height(max(24, 33+a.uiPrefs.FontSize-14)).FillWidth().MinWidth(0).Padding(0, 0, 8).BorderWidth(0, 0, .5, 0).BorderColor(a.theme.Border).AlignItems(ui.Center).Justify(ui.Start).Gap(4).Disabled(!row.CanCollapse || row.AlwaysOpen)
	button.Children(func() {
		ui.Text(c, turnProcessLabel(row)).FontSize(a.uiPrefs.FontSize).TextColor(a.theme.TextMuted).SingleLine()
		if row.CanCollapse && !row.AlwaysOpen {
			if open {
				icon(c, "chevron-up-outline", 14)
			} else {
				icon(c, "chevron-down-outline", 14)
			}
		}
	})
	if s := row.ProcessSpec; s != nil {
		button.Tooltip(fmt.Sprintf("%d 条回复 · %d 次工具调用 · %d 次子任务", s.MessageCount, s.ToolCallCount, s.SubagentCount))
	}
	if button.Clicked() {
		a.toggleTurnProcess(row)
	}
}
