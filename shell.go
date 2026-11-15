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

// shellQuitting is set once the quit sequence has been approved. The window
// close handler must then let the close happen: preventing it would cancel the
// quit that asked for it.
var shellQuitting bool

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
		// The quit sequence closes this window itself; a close listener that
		// still prevented it would cancel that quit.
		shellQuitting = true
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
			if shellQuitting {
				return
			}
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
	if local == nil || (local.page == nil && !local.native) {
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

// installApplicationMenu builds the menu the original shell provides: the
// application menu (About, Services, hide, quit), a File menu with the window's
// own close and the Session archive, the edit roles, an explicit entry for the
// local workspace, and the window list.
func (a *app) installApplicationMenu() {
	menu := a.applicationMenu()
	// Keep the update entry for the check that disables it while one runs.
	setUpdateMenuItem(menu.ItemByID(updateMenuID))
	mygo.App.SetMenu(menu)
}

// applicationMenu is the template itself, without installing it, so that a test
// reads the same roles and items the application gets.
func (a *app) applicationMenu() *mygo.Menu {
	// The application menu is MyGo's own expansion with this client's About
	// panel in place of the native one: the panel reports the runtime version,
	// which is what support questions need.
	appSubmenu := []*mygo.MenuItem{
		{
			ID:    "about",
			Label: "关于 " + productName,
			Click: func(*mygo.MenuItem, *mygo.Window) { a.showAbout() },
		},
	}
	// Checking for updates belongs under About, and only exists when this
	// launch could actually check: a build without a feed shows no entry
	// rather than a button that cannot work.
	if check := a.checkForUpdatesMenuItem(); check != nil {
		appSubmenu = append(appSubmenu, check)
	}
	appSubmenu = append(appSubmenu,
		mygo.Separator(),
		// An empty submenu (rather than no submenu) is what makes AppKit
		// own the Services menu and fill it as it opens.
		&mygo.MenuItem{ID: "app.services", Role: mygo.RoleServices, Submenu: []*mygo.MenuItem{}},
		mygo.Separator(),
		&mygo.MenuItem{ID: "app.hide", Role: mygo.RoleHide},
		&mygo.MenuItem{ID: "app.hideOthers", Role: mygo.RoleHideOthers},
		&mygo.MenuItem{ID: "app.unhide", Role: mygo.RoleUnhide},
		mygo.Separator(),
		// The role, not a Click of its own: MyGo's quit role asks the
		// application to quit, which runs OnBeforeQuit and therefore the
		// existing confirmation and Host shutdown.
		&mygo.MenuItem{ID: "app.quit", Role: mygo.RoleQuit},
	)
	appMenu := &mygo.MenuItem{Role: mygo.RoleAppMenu, Submenu: appSubmenu}
	// Closing the window hides it while this process owns a Host (the close
	// policy below), and ends the process otherwise; the role only asks the
	// window to close, so both modes keep that one path.
	zip := sessionZipOffer(a.canExportSessionZip())
	fileMenu := &mygo.MenuItem{
		Role: mygo.RoleFileMenu,
		Submenu: []*mygo.MenuItem{
			{ID: "file.close", Role: mygo.RoleClose},
			mygo.Separator(),
			{
				ID:       "file.exportSessionZip",
				Label:    "导出会话 ZIP…",
				Disabled: !zip.Enabled,
				ToolTip:  zip.Tooltip,
				Click:    func(*mygo.MenuItem, *mygo.Window) { a.exportSessionZip() },
			},
		},
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
				Click:       func(*mygo.MenuItem, *mygo.Window) { a.reloadWorkspace() },
			},
		},
	}
	window := &mygo.MenuItem{Role: mygo.RoleWindowMenu}
	edit := &mygo.MenuItem{Role: mygo.RoleEditMenu}
	return mygo.NewMenu([]*mygo.MenuItem{appMenu, fileMenu, edit, workspace, window})
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

// reloadWorkspace re-reads everything the window shows. With a local Host it
// restarts that Host (the only way to pick up a new payload); in Remote mode it
// re-reads the catalogs and reopens the Session the reader was looking at,
// which is what the key promises there.
func (a *app) reloadWorkspace() {
	if a.localRuntime != nil {
		a.closeLocalRuntime()
		a.startLocalRuntime()
		return
	}
	if !a.connected || a.client == nil {
		a.fetchDevices()
		return
	}
	session := a.sessionID
	a.fetchCapabilities()
	a.refreshWorkspaces(func() {
		a.fetchSessions()
		if session == "" {
			return
		}
		for _, row := range a.sessions {
			if row.ID == session && a.sessionID != session {
				a.chooseSession(row)
				return
			}
		}
	})
}
