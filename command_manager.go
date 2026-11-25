package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/egoist/mygo/ui"
)

const dshCommandMarker = "# DeepSeek Nativeness dsh command"

func dshCommandPath() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, "bin", "dsh")
}

// dshCommandScript points the shell command at this app's bundled CLI, so
// installing it never needs a download or a version of its own.
func (a *app) dshCommandScript() (string, error) {
	if a.localRuntime == nil || a.localRuntime.payload == nil {
		return "", fmt.Errorf("本地运行时尚未加载")
	}
	payload := a.localRuntime.payload
	bin := filepath.Join(payload.Dsh, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
	if _, err := os.Stat(bin); err != nil {
		return "", fmt.Errorf("找不到内置 dsh CLI：%s", bin)
	}
	return "#!/bin/sh\n" + dshCommandMarker + "\nexec " + shQuote(payload.Node) + " " + shQuote(bin) + " \"$@\"\n", nil
}

func shQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

func (a *app) dshCommandInstalled() bool {
	data, err := os.ReadFile(dshCommandPath())
	return err == nil && strings.Contains(string(data), dshCommandMarker)
}

func (a *app) installDshCommandTo(path string) error {
	script, err := a.dshCommandScript()
	if err != nil {
		return err
	}
	if path == "" {
		return fmt.Errorf("找不到用户主目录")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(script), 0o755)
}

func (a *app) installDshCommand() error { return a.installDshCommandTo(dshCommandPath()) }

func (a *app) removeDshCommandAt(path string) error {
	if path == "" {
		return nil
	}
	return os.Remove(path)
}

func (a *app) removeDshCommand() error {
	if !a.dshCommandInstalled() {
		return nil
	}
	return a.removeDshCommandAt(dshCommandPath())
}

func (a *app) commandManagerView(c *ui.Context) {
	if !a.commandManagerOpen {
		return
	}
	open := true
	path := dshCommandPath()
	installed := a.dshCommandInstalled()
	ui.Modal(c, &open, func() {
		ui.Column(c).Width(520).Padding(24).Gap(14).Children(func() {
			ui.Text(c, "管理 dsh 命令").FontSize(18).FontWeight(500)
			ui.Text(c, "把内置的 dsh CLI 安装到 ~/bin/dsh，方便在终端里直接运行。").FontSize(12).TextColor(a.colors.Secondary).Wrap()
			status := "未安装"
			if installed {
				status = "已安装"
			}
			ui.Text(c, "状态："+status).FontSize(12).TextColor(a.colors.Secondary)
			ui.Text(c, path).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Caption).Wrap().Selectable()
			if err := a.commandManagerError; err != "" {
				ui.Text(c, err).FontSize(11).TextColor(a.theme.Danger).Wrap()
			}
			ui.Row(c).Justify(ui.End).Gap(8).Children(func() {
				if ui.Button(c, "关闭").Clicked() {
					open = false
				}
				if ui.Button(c, "安装到 /usr/local/bin").Clicked() {
					if err := a.installDshCommandTo("/usr/local/bin/dsh"); err != nil {
						a.commandManagerError = err.Error()
					} else {
						a.commandManagerError = ""
					}
				}
				if installed && ui.Button(c, "移除").Clicked() {
					if err := a.removeDshCommand(); err != nil {
						a.commandManagerError = err.Error()
					} else {
						a.commandManagerError = ""
					}
				}
				label := "安装"
				if installed {
					label = "修复"
				}
				if ui.PrimaryButton(c, label).Clicked() {
					if err := a.installDshCommand(); err != nil {
						a.commandManagerError = err.Error()
					} else {
						a.commandManagerError = ""
					}
				}
			})
		})
	})
	if !open {
		a.commandManagerOpen = false
	}
}
