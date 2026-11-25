package main

import "github.com/egoist/mygo/ui"

func (a *app) scheduleDetailView(c *ui.Context) {
	if !a.scheduleDetailOpen || a.scheduleDetail == nil {
		return
	}
	open := true
	record := *a.scheduleDetail
	ui.Modal(c, &open, func() {
		ui.Column(c).Width(420).Padding(22).Gap(12).Children(func() {
			ui.Text(c, "定时任务").FontSize(17).FontWeight(500)
			title := record.Title
			if title == "" {
				title = record.ID
			}
			ui.Text(c, title).FontSize(14).Wrap()
			ui.Text(c, "会话 "+record.SessionID).FontSize(12).TextColor(a.colors.Caption)
			ui.Text(c, "ID "+record.ID).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Caption).Selectable()
			ui.Text(c, "当前 Host 只提供目录读取，编辑/立即运行接口尚未开放。").FontSize(11).TextColor(a.colors.Caption).Wrap()
			ui.Row(c).Justify(ui.End).Children(func() {
				if ui.Button(c, "关闭").Clicked() {
					open = false
				}
			})
		})
	})
	if !open {
		a.scheduleDetailOpen = false
		a.scheduleDetail = nil
	}
}
