package main

import (
	"strings"

	"github.com/egoist/mygo/ui"
)

func (a *app) goalEditView(c *ui.Context) {
	if a.goalEdit == nil {
		return
	}
	open := true
	goal := a.goalEdit
	ui.Modal(c, &open, func() {
		ui.Column(c).Width(520).Padding(24).Gap(14).Children(func() {
			ui.Text(c, "编辑目标").FontSize(18).FontWeight(500)
			ui.Text(c, "修改目标的完成描述；不会改动已运行的轮数。").FontSize(12).TextColor(a.colors.Secondary).Wrap()
			ui.TextArea(c, &a.goalEditText).Label("目标").Lines(4, 8).FillWidth().AutoFocus()
			ui.Row(c).Justify(ui.End).Gap(8).Children(func() {
				if ui.Button(c, "取消").Clicked() {
					open = false
				}
				if ui.PrimaryButton(c, "保存").Disabled(a.goalEditText == "" || !a.can("editGoal")).Clicked() {
					text := strings.TrimSpace(a.goalEditText)
					ref := map[string]any{"id": goal.ID, "revision": goal.Revision}
					open = false
					a.mutate("editGoal", map[string]any{"sessionId": a.sessionID, "ref": ref, "request": map[string]any{"objective": text}}, nil)
				}
			})
		})
	})
	if !open {
		a.goalEdit = nil
	}
}
