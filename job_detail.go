package main

import "github.com/egoist/mygo/ui"

// jobDetailView shows one background job's complete output. The Jobs popover
// only carries a short excerpt, so this is where a long log is readable.
func (a *app) jobDetailView(c *ui.Context) {
	if a.jobDetail == nil {
		return
	}
	if a.jobDetailPolling != a.jobDetail.ID {
		a.jobDetailPolling = a.jobDetail.ID
		id := a.jobDetail.JobID
		if id == "" {
			id = a.jobDetail.ID
		}
		go a.pollJobDetail(id)
	}
	open := true
	ui.Modal(c, &open, func() {
		ui.Column(c).Width(640).MaxHeight(560).Padding(24).Gap(14).Children(func() {
			ui.Text(c, "后台任务输出").FontSize(18).FontWeight(500)
			label := a.jobDetail.Description
			if label == "" {
				label = a.jobDetail.Command
			}
			if label != "" {
				ui.Text(c, label).FontSize(13).TextColor(a.colors.Secondary).Wrap()
			}
			ui.Text(c, a.jobDetail.Status).FontSize(12).TextColor(a.colors.Caption)
			ui.Scroll(c).MaxHeight(380).Children(func() {
				ui.Text(c, a.jobDetail.FullOutput).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Secondary).Selectable().Wrap()
			})
			ui.Row(c).Justify(ui.End).Children(func() {
				if ui.Button(c, "关闭").Clicked() {
					open = false
				}
			})
		})
	})
	if !open {
		a.jobDetail = nil
	}
}
