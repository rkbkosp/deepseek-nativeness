package main

// The local workspace surface: the original web client, served by the Host this
// process started, shown in a window-sized web view.
//
// This is deliberately a separate surface from the native conversation view.
// The native view keeps working unchanged against a Remote host; the local
// workspace is what "replace the desktop app" looks like today, and it is the
// only place where the two can be compared side by side.

import (
	"fmt"

	"github.com/egoist/mygo/ui"
)

// localView renders either the starting state or the served application.
func (a *app) localView(c *ui.Context) {
	local := a.localRuntime
	ui.Column(c).Fill().MinHeight(0).MinWidth(0).Background(a.theme.Background).Children(func() {
		a.localBar(c)
		if local.page != nil {
			ui.WebView(c, local.page).Grow(1).MinHeight(0).MinWidth(0)
			return
		}
		ui.Column(c).Grow(1).MinHeight(0).Padding(0, 32).Gap(10).AlignItems(ui.Center).Children(func() {
			ui.Spacer(c)
			ui.Text(c, "本地工作区").FontSize(18).Bold()
			if local.err != "" {
				ui.Text(c, local.err).FontSize(13).Wrap().TextColor(a.theme.Danger)
				ui.Text(c, "本地运行时使用原版 ~/.dsh 与 desktop profile。原版应用退出后才能启动。").FontSize(12).Wrap().TextColor(a.theme.TextMuted)
				if a.error != "" {
					a.error = ""
				}
			} else {
				status := local.status
				if status == "" {
					status = "正在启动本地运行时…"
				}
				ui.Text(c, status).FontSize(13).TextColor(a.theme.TextMuted).Wrap()
				ui.Text(c, "首次启动会准备 profile，通常需要几秒。").FontSize(12).TextColor(a.theme.TextMuted)
			}
			if local.payload != nil {
				ui.Text(c, local.payload.String()).FontSize(11).TextColor(a.theme.TextMuted).Wrap()
			}
			ui.Spacer(c)
		})
	})
}

// localBar is the title strip above the served page. It is also what makes the
// window readable when the application draws its own chrome.
func (a *app) localBar(c *ui.Context) {
	local := a.localRuntime
	ui.Row(c).FillWidth().Height(38).Shrink(0).Padding(0, 14).Gap(10).AlignItems(ui.Center).
		Background(a.theme.Surface).BorderWidth(0, 0, .5, 0).BorderColor(a.theme.Border).Children(func() {
		title := "本地工作区"
		if local.payload != nil {
			title = fmt.Sprintf("本地工作区 · dsh %s", local.payload.Version)
		}
		ui.Text(c, title).FontSize(12).TextColor(a.theme.TextMuted)
		if local.err != "" {
			ui.Text(c, "启动失败").FontSize(12).TextColor(a.theme.Danger)
		} else if local.page == nil {
			ui.Text(c, "启动中…").FontSize(12).TextColor(a.theme.TextMuted)
		}
		ui.Spacer(c)
		if local.err != "" {
			if ui.Button(c, "重试").Clicked() {
				a.closeLocalRuntime()
				a.startLocalRuntime()
			}
		}
		if ui.Button(c, "返回原生界面").Clicked() {
			a.closeLocalRuntime()
		}
	})
}

// webViewBackground gives a web view a paint colour matching the shell, so the
// first frame does not flash white in dark mode.
func webViewBackground(dark bool) string {
	if dark {
		return "#151517"
	}
	return "#ffffff"
}
