package main

import (
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"strings"
)

func (a *app) connectionView(c *ui.Context) {
	ui.Scroll(c).Grow(1).Children(func() {
		ui.Column(c).MaxWidth(700).Padding(28, 36).Gap(14).Children(func() {
			ui.Text(c, "Remote").FontSize(24).Bold()
			ui.Text(c, "连接已授权的工作主机，继续远程会话。").TextColor(a.theme.TextMuted).Wrap()
			ui.Text(c, a.status).FontSize(13)
			if a.detail != "" {
				ui.Text(c, a.detail).FontSize(12).TextColor(a.theme.TextMuted).Wrap()
			}
			ui.TextInput(c, &a.server).Label("Remote 服务地址").Placeholder("Remote 服务地址")
			ui.TextInput(c, &a.account).Label("Remote 账号").Placeholder("账号")
			ui.TextInput(c, &a.password).Label("Remote 密码").Placeholder("密码").Password()
			ui.Row(c).Gap(8).Children(func() {
				if ui.PrimaryButton(c, "登录").Disabled(a.busy).Clicked() {
					a.login()
				}
				if ui.Button(c, "刷新主机").Disabled(a.busy).Clicked() {
					a.fetchDevices()
				}
			})
			for _, d := range a.devices {
				d := d
				ui.Row(c.Key(d.ID)).Padding(12).Gap(12).Radius(10).Border(1, a.theme.Border).Children(func() {
					ui.Text(c, d.Name).Grow(1)
					label := "离线"
					if d.Online {
						label = "连接"
					}
					if ui.Button(c, label).Disabled(a.busy || !d.Online).Clicked() {
						a.connect(d.ID)
					}
				})
			}
			if len(a.devices) == 0 {
				ui.Text(c, "尚未加载主机列表。登录或使用独立的客户端身份后刷新。").TextColor(a.theme.TextMuted).Wrap()
			}
			for _, w := range a.workspaces {
				w := w
				if ui.Button(c, w.Name).Clicked() {
					a.selectWorkspace(w.ID)
					a.connectionOpen = false
				}
			}
			ui.Text(c, "兼容页面").Bold().Margin(12, 0, 0)
			ui.TextInput(c, &a.webURL).Label("兼容页面地址")
			if ui.Button(c, "打开 Remote Web").Clicked() {
				a.openWeb()
			}
		})
	})
}

func (a *app) openWeb() {
	a.closeCompat()
	if a.web != nil && a.webPlacement == "main" {
		return
	}
	if !strings.HasPrefix(a.webURL, "https://") && !strings.HasPrefix(a.webURL, "http://127.0.0.1:") {
		a.error = "兼容页面仅允许 HTTPS 或本机回环地址。"
		return
	}
	a.closeWeb()
	a.beginMainNavigation()
	mygo.RunOnMain(func() {
		v, err := a.win.NewWebView(mygo.WebViewOptions{URL: a.webURL, Page: mygo.PageOptions{Untrusted: true}})
		if err != nil {
			a.error = err.Error()
			return
		}
		a.web = v
		a.webPlacement = "main"
		a.webTarget = a.webURL
		a.win.Invalidate()
	})
}

func (a *app) webView(c *ui.Context) {
	ui.Row(c).Padding(8, 20).Gap(10).Children(func() {
		ui.Text(c, "Remote Web · 独立网页连接").FontSize(12).TextColor(a.theme.TextMuted).Grow(1)
		if ui.Button(c, "关闭").Clicked() {
			a.closeWeb()
		}
	})
	if a.web != nil {
		ui.WebView(c, a.web).Grow(1)
	}
}
func (a *app) closeWeb() {
	a.webPlacement = ""
	a.webTarget = ""
	if a.web != nil {
		v := a.web
		a.web = nil
		v.Destroy()
	}
}
