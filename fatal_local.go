package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

// fatalLocalView is the actionable dialog after the supervisor gives up. The
// banner alone leaves no retry gesture; this names the failure and offers one.
// crashReport is the text a person can paste into a bug report. It names the
// failure, the restart history, the Host pid and the Host log, without any
// launch token.
func (a *app) crashReport() string {
	var b strings.Builder
	fmt.Fprintf(&b, "DeepSeek Nativeness 本地 Host 崩溃报告\n")
	fmt.Fprintf(&b, "时间: %s\n", time.Now().Format(time.RFC3339))
	fmt.Fprintf(&b, "错误: %s\n", maskSecrets(a.fatalLocal))
	local := a.localRuntime
	if local != nil {
		fmt.Fprintf(&b, "restarts: %d\nlastRestart: %s\nhostPid: %d\n", local.restarts, local.lastRestart, local.hostPid)
		fmt.Fprintf(&b, "home: %s\n", local.home)
		for i, phase := range local.phases {
			fmt.Fprintf(&b, "phase[%d]: %s\n", i, phase)
		}
		if local.home != "" {
			logPath := filepath.Join(local.home, "logs", "ds-harness-remote", "host.log")
			if _, err := os.Stat(logPath); err == nil {
				fmt.Fprintf(&b, "hostLog: %s\n", logPath)
			}
		}
	}
	return b.String()
}

func (a *app) fatalLocalView(c *ui.Context) {
	if a.fatalLocal == "" {
		return
	}
	open := true
	ui.Modal(c, &open, func() {
		ui.Column(c).Width(520).Padding(24).Gap(14).Children(func() {
			ui.Text(c, "本地 Host 无法启动").FontSize(18).FontWeight(500)
			ui.Text(c, maskSecrets(a.fatalLocal)).FontSize(13).TextColor(a.colors.Secondary).Wrap()
			ui.Text(c, "可以重试一次；如果仍然失败，请检查本地运行时和日志。").FontSize(12).TextColor(a.colors.Caption).Wrap()
			ui.Row(c).Justify(ui.End).Gap(8).Children(func() {
				report := a.crashReport()
				if ui.Button(c, "复制诊断").Clicked() {
					c.WriteClipboard(report)
				}
				if ui.Button(c, "保存诊断").Clicked() {
					path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Title: "保存崩溃报告", DefaultPath: fmt.Sprintf("dsh-crash-%s.txt", time.Now().Format("20060102-150405"))})
					if err == nil && path != "" {
						_ = os.WriteFile(path, []byte(report), 0o644)
					}
				}
				if ui.Button(c, "稍后").Clicked() {
					open = false
				}
				if ui.PrimaryButton(c, "重试启动").Clicked() {
					open = false
					a.fatalLocal = ""
					a.closeLocalRuntime()
					go a.startLocalRuntime()
				}
			})
		})
	})
}
