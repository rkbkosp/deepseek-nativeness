package main

// Shell parity with the original desktop application.
//
// The original shell is Electron: single instance, an application menu, a quit
// confirmation that names what would be interrupted, and the `dsh://` deep link
// used by the browser sign-in flow. None of that lives in the backend, so this
// file owns it here.

import (
	"fmt"
	"log"
	"strings"

	"github.com/egoist/mygo"
)

// shellAutoQuit marks a bounded QA launch: it must not block on a quit prompt.
var shellAutoQuit bool

// installShell wires the process-level shell behaviour. It runs after the
// window exists, on the main thread.
func (a *app) installShell(autoQuit bool) {
	shellAutoQuit = autoQuit
	a.installApplicationMenu()
	a.installDeepLinks()
	mygo.App.OnSecondInstance(func(args []string, workingDir string) {
		// A second launch hands its command line over and exits; this instance
		// only has to come forward.
		if a.win != nil {
			mygo.RunOnMain(func() {
				a.win.Show()
				a.win.Focus()
			})
		}
	})
	mygo.App.OnBeforeQuit(func(e *mygo.QuitEvent) {
		if !a.confirmQuit() {
			e.PreventDefault()
			return
		}
		// The Host is owned by this process: stop it before the process dies so
		// it can report shutdown-complete instead of being orphaned.
		a.stopLocalRuntimeForQuit()
	})
	// Clicking the Dock icon of a hidden application shows its window again,
	// the same way the original shell reopens.
	mygo.App.OnActivate(func(hasVisibleWindows bool) {
		if a.win == nil || hasVisibleWindows {
			return
		}
		mygo.RunOnMain(func() {
			a.win.Show()
			a.win.Focus()
		})
	})
	if a.win != nil {
		// Parity with the original shell: closing the window hides it and keeps
		// the Host (and its tasks) running. Quitting is the explicit action that
		// stops anything, and it asks first.
		a.win.OnClose(func(e *mygo.CloseEvent) {
			e.PreventDefault()
			if a.windowCloseAction() == closeHide {
				a.win.Hide()
				return
			}
			// No local runtime: closing the only window ends the process, which is
			// what a Remote-only session expects.
			mygo.App.Quit()
		})
		a.win.OnClosed(func() {
			if a.localRuntime != nil {
				a.closeLocalRuntime()
			}
		})
	}
}

// windowCloseAction is the close-button policy: an owned local Host keeps
// running while its window hides, and a Remote-only session has nothing to keep
// alive, so closing it ends the process.
type closeAction int

const (
	closeQuit closeAction = iota
	closeHide
)

func (a *app) windowCloseAction() closeAction {
	if a.localRuntime != nil {
		return closeHide
	}
	return closeQuit
}

// confirmQuit asks before interrupting a running local Host, mirroring the
// original shell's quit confirmation. With no local runtime there is nothing
// this process would interrupt, so it returns immediately.
func (a *app) confirmQuit() bool {
	if shellAutoQuit {
		return true
	}
	local := a.localRuntime
	if local == nil || local.page == nil {
		return true
	}
	detail := "本地工作区会关闭，正在运行的任务会被中断。"
	if local.host != nil {
		detail = "关闭后本地 dsh Host 会停止，正在运行的任务、子代理和后台任务会被中断。"
	}
	result, err := mygo.Dialog.Message(mygo.MessageOptions{
		Parent:        a.win,
		Type:          mygo.MessageWarning,
		Message:       "退出本地工作区？",
		Detail:        detail,
		Buttons:       []string{"取消", "退出"},
		DefaultButton: 1,
		CancelButton:  0,
	})
	if err != nil {
		log.Printf("shell: quit confirmation failed: %v", err)
		return true
	}
	return result.Button == 1
}

// installApplicationMenu builds the menu the original shell provides: About,
// Window-level items, an explicit entry for the local workspace, and the
// standard hide/quit roles.
func (a *app) installApplicationMenu() {
	about := &mygo.MenuItem{
		ID:    "about",
		Label: "关于 " + productName,
		Click: func(*mygo.MenuItem, *mygo.Window) { a.showAbout() },
	}
	workspace := &mygo.MenuItem{
		Label: "工作区",
		Submenu: []*mygo.MenuItem{
			{
				ID:          "workspace.local",
				Label:       "打开本地工作区",
				Accelerator: "CmdOrCtrl+Shift+L",
				Click:       func(*mygo.MenuItem, *mygo.Window) { a.startLocalRuntime() },
			},
			{
				ID:          "workspace.native",
				Label:       "返回原生界面",
				Accelerator: "CmdOrCtrl+Shift+N",
				Click:       func(*mygo.MenuItem, *mygo.Window) { a.closeLocalRuntime() },
			},
			mygo.Separator(),
			{
				ID:          "workspace.reload",
				Label:       "重新加载工作区",
				Accelerator: "CmdOrCtrl+R",
				Click: func(*mygo.MenuItem, *mygo.Window) {
					if a.localRuntime != nil {
						a.closeLocalRuntime()
						a.startLocalRuntime()
					}
				},
			},
		},
	}
	window := &mygo.MenuItem{Role: mygo.RoleWindowMenu}
	edit := &mygo.MenuItem{Role: mygo.RoleEditMenu}
	mygo.App.SetMenu(mygo.NewMenu([]*mygo.MenuItem{about, edit, workspace, window}))
}

// showAbout reports the versions this shell depends on. The runtime version is
// read from the payload when it is present, so the panel doubles as support
// information.
func (a *app) showAbout() {
	version := "本地运行时未安装"
	if payload, err := resolveRuntimePayload(); err == nil {
		version = payload.String()
	}
	mygo.App.ShowAboutPanel(mygo.AboutPanelOptions{
		ApplicationName:    productName,
		ApplicationVersion: "0.1.0",
		Version:            version,
		Credits:            "原生外壳 + 官方 dsh 运行时；后端未修改。",
	})
}

// installDeepLinks accepts the `dsh://` URLs the browser sign-in flow hands back,
// the same scheme the original application owns.
func (a *app) installDeepLinks() {
	mygo.App.OnOpenURL(func(raw string) {
		if !strings.HasPrefix(raw, "dsh://") {
			return
		}
		// The original shell only uses this to come to the front after an
		// external sign-in; the workspace itself reloads its own state.
		if a.win != nil {
			mygo.RunOnMain(func() {
				a.win.Show()
				a.win.Focus()
			})
		}
	})
}

// shellDiagnostics renders one line for logs and QA reports.
func (a *app) shellDiagnostics() string {
	local := a.localRuntime
	if local == nil {
		return "shell: native workspace"
	}
	if local.err != "" {
		return fmt.Sprintf("shell: local workspace failed: %s", local.err)
	}
	if local.url == "" {
		return "shell: local workspace starting"
	}
	return fmt.Sprintf("shell: local workspace %s", local.url)
}
