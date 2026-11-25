package main

import (
	"runtime"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"
)

// This file is the one place this client decides which keys do what. The
// window dispatches the table, the settings page lists it, and a test fails
// the build when two rows claim the same key. A key with no command has no
// row: the surfaces above this file (the composer's Enter, a pending card's
// Esc, the application menu's accelerators) are rows of their own, listed in
// externalShortcuts with the surface that owns them, so the reference cannot
// promise more than the build installs.

// shortcutScope says what a key acts on: the table is listed in scope order,
// and the scope is how the report and a reviewer read a row. It never changes
// behaviour.
type shortcutScope string

const (
	// scopeGlobal keys work wherever the window is.
	scopeGlobal shortcutScope = "全局"
	// scopeSession keys act on the conversation that is open.
	scopeSession shortcutScope = "会话"
	// scopePanel keys open or close a side surface.
	scopePanel shortcutScope = "面板"
)

// shortcutKey is one key with its modifiers: exactly what
// ui.Context.Shortcut takes, so a row cannot describe a chord the window
// does not compare.
type shortcutKey struct {
	Mods ui.Modifiers
	Key  ui.Key
}

// shortcutBinding is one key and the command it runs.
//
// Repeat marks a key that keeps acting while it is held (the scroll keys);
// a toggle leaves the auto-repeat alone so holding the key cannot flip its
// state back and forth.
type shortcutBinding struct {
	ID    string
	Key   shortcutKey
	Title string
	Scope shortcutScope
	// Run is the command. It may reuse any existing entry point; it must not
	// only set state a surface never reads.
	Run    func(*app)
	Repeat bool
}

// externalShortcut is a key this build installs in a surface the window's
// dispatcher does not own, with the row the reference shows for it. Naming
// them here keeps the reference complete without registering a second
// handler for a key that already has one.
type externalShortcut struct {
	ID    string
	Keys  []shortcutKey
	Title string
}

// shortcutBindings is the single table: key → command. The order is the
// order the reference lists, grouped by scope.
//
// Esc is here because the overlays that are not MyGo modals have no Esc of
// their own (see dismissOverlay); the pending cards' Esc lives in
// conversation.go, which takes the key first through the focus chain, so a
// waiting approval is never dismissed by this row. Keys another surface owns,
// the application menu's among them, are rows of externalShortcuts instead:
// AppKit delivers a menu key equivalent before the window sees the key, so a
// second handler here would be dead.
var shortcutBindings = buildShortcutBindings()

func buildShortcutBindings() []shortcutBinding {
	bindings := []shortcutBinding{
		{ID: "escape.dismiss", Key: shortcutKey{Key: ui.KeyEscape}, Title: "关闭浮层；双击停止当前任务", Scope: scopeGlobal, Run: (*app).dismissOverlay},
		{ID: "sidebar.left.toggle", Key: shortcutKey{Mods: ui.Cmd, Key: ui.KeyB}, Title: "展开或收起侧边栏", Scope: scopeGlobal, Run: (*app).toggleSidebar},
		{ID: "session.search", Key: shortcutKey{Mods: ui.Cmd, Key: ui.KeyK}, Title: "搜索会话", Scope: scopeGlobal, Run: (*app).openSessionSearch},
		// The original registers no session-wide text search, and neither does
		// this build: ⌘F opens the same Session search rather than a field that
		// cannot find anything inside a transcript.
		{ID: "session.find", Key: shortcutKey{Mods: ui.Cmd, Key: ui.KeyF}, Title: "查找：本构建没有会话内全文查找，打开的是会话搜索", Scope: scopeGlobal, Run: (*app).openSessionSearch},
		{ID: "settings.open", Key: shortcutKey{Mods: ui.Cmd, Key: ui.KeyComma}, Title: "打开设置", Scope: scopeGlobal, Run: (*app).openSettingsPanel},
		shortcutBinding{ID: "fontSize.text.increase", Key: shortcutKey{Mods: ui.Cmd, Key: ui.KeyEqual}, Title: "增大正文字号", Scope: scopeGlobal, Run: func(a *app) { a.adjustFont("text", 1) }},
		shortcutBinding{ID: "fontSize.text.decrease", Key: shortcutKey{Mods: ui.Cmd, Key: ui.KeyMinus}, Title: "减小正文字号", Scope: scopeGlobal, Run: func(a *app) { a.adjustFont("text", -1) }},
		shortcutBinding{ID: "fontSize.code.increase", Key: shortcutKey{Mods: ui.Cmd | ui.Shift, Key: ui.KeyEqual}, Title: "增大代码字号", Scope: scopeGlobal, Run: func(a *app) { a.adjustFont("code", 1) }},
		shortcutBinding{ID: "fontSize.code.decrease", Key: shortcutKey{Mods: ui.Cmd | ui.Shift, Key: ui.KeyMinus}, Title: "减小代码字号", Scope: scopeGlobal, Run: func(a *app) { a.adjustFont("code", -1) }},
		shortcutBinding{ID: "fontSize.terminal.increase", Key: shortcutKey{Mods: ui.Cmd | ui.Alt, Key: ui.KeyEqual}, Title: "增大终端字号", Scope: scopeGlobal, Run: func(a *app) { a.adjustFont("terminal", 1) }},
		shortcutBinding{ID: "fontSize.terminal.decrease", Key: shortcutKey{Mods: ui.Cmd | ui.Alt, Key: ui.KeyMinus}, Title: "减小终端字号", Scope: scopeGlobal, Run: func(a *app) { a.adjustFont("terminal", -1) }},
		{ID: "shortcuts.open", Key: shortcutKey{Mods: ui.Cmd, Key: ui.KeySlash}, Title: "打开快捷键速查", Scope: scopeGlobal, Run: (*app).openShortcutReference},
		{ID: "session.new", Key: shortcutKey{Mods: ui.Cmd, Key: ui.KeyN}, Title: "新建会话", Scope: scopeGlobal, Run: (*app).applyNewSessionIntent},
		// workspace.add is the original's ⌘O; openWorkspaceCreate already decides
		// what an unauthorised or still-booting launch should do.
		{ID: "workspace.add", Key: shortcutKey{Mods: ui.Cmd, Key: ui.KeyO}, Title: "添加工作区", Scope: scopeGlobal, Run: (*app).openWorkspaceCreate},
	}
	// ⌘1…⌘9 pick the sidebar's first nine Sessions; the loop keeps the nine
	// rows identical so no digit can drift from its index.
	for i, key := range []ui.Key{ui.Key1, ui.Key2, ui.Key3, ui.Key4, ui.Key5, ui.Key6, ui.Key7, ui.Key8, ui.Key9} {
		index := i
		bindings = append(bindings, shortcutBinding{
			ID:    "session.switch",
			Key:   shortcutKey{Mods: ui.Cmd, Key: key},
			Title: "切换到侧栏第 1–9 个会话（没有对应会话时不做任何事）",
			Scope: scopeGlobal,
			Run:   func(a *app) { a.switchSessionTo(index) },
		})
	}
	return append(bindings,
		shortcutBinding{ID: "session.previous", Key: shortcutKey{Mods: ui.Cmd | ui.Shift, Key: ui.KeyBracketLeft}, Title: "上一个会话", Scope: scopeGlobal, Run: func(a *app) { a.stepSession(-1) }},
		shortcutBinding{ID: "session.next", Key: shortcutKey{Mods: ui.Cmd | ui.Shift, Key: ui.KeyBracketRight}, Title: "下一个会话", Scope: scopeGlobal, Run: func(a *app) { a.stepSession(1) }},
		shortcutBinding{ID: "plugins.open", Key: shortcutKey{Mods: ui.Cmd | ui.Shift, Key: ui.KeyP}, Title: "打开插件页", Scope: scopeGlobal, Run: (*app).openPluginsPage},
		shortcutBinding{ID: "conversation.scrollTop", Key: shortcutKey{Mods: ui.Cmd, Key: ui.KeyUp}, Title: "滚动到对话顶部", Scope: scopeSession, Run: (*app).scrollConversationTop, Repeat: true},
		shortcutBinding{ID: "conversation.scrollBottom", Key: shortcutKey{Mods: ui.Cmd, Key: ui.KeyDown}, Title: "滚动到对话底部", Scope: scopeSession, Run: (*app).scrollConversationBottom, Repeat: true},
		shortcutBinding{ID: "sidebar.right.toggle", Key: shortcutKey{Mods: ui.Cmd | ui.Shift, Key: ui.KeyB}, Title: "展开或收起右栏", Scope: scopePanel, Run: (*app).toggleRightPane},
		shortcutBinding{ID: "terminal.new", Key: shortcutKey{Mods: ui.Ctrl, Key: ui.KeyBackquote}, Title: "在右栏打开终端", Scope: scopePanel, Run: (*app).openTerminalPane},
		shortcutBinding{ID: "workspace.files", Key: shortcutKey{Mods: ui.Cmd, Key: ui.KeyP}, Title: "在右栏打开工作区文件", Scope: scopePanel, Run: (*app).openFilesPane},
		shortcutBinding{ID: "browser.new", Key: shortcutKey{Mods: ui.Cmd, Key: ui.KeyT}, Title: "打开浏览器", Scope: scopeGlobal, Run: (*app).openBrowser},
		shortcutBinding{ID: "workspace.openLocal", Key: shortcutKey{Mods: ui.Cmd | ui.Alt, Key: ui.KeyO}, Title: "在默认应用中打开工作区", Scope: scopeGlobal, Run: (*app).openCurrentWorkspaceLocal},
		shortcutBinding{ID: "pane.fullscreen.toggle", Key: shortcutKey{Mods: ui.Cmd | ui.Alt, Key: ui.KeyEnter}, Title: "右栏全屏/还原", Scope: scopePanel, Run: (*app).toggleRightPaneFullscreen},
		shortcutBinding{ID: "session.rename", Key: shortcutKey{Mods: ui.Cmd | ui.Alt, Key: ui.KeyG}, Title: "重命名当前会话", Scope: scopeSession, Run: (*app).renameCurrentSession},
		shortcutBinding{ID: "session.fork", Key: shortcutKey{Mods: ui.Cmd | ui.Alt, Key: ui.KeyF}, Title: "分叉当前会话", Scope: scopeSession, Run: (*app).forkCurrentSession},
		shortcutBinding{ID: "session.archive", Key: shortcutKey{Mods: ui.Cmd | ui.Shift, Key: ui.KeyA}, Title: "归档当前会话", Scope: scopeSession, Run: (*app).archiveCurrentSession},
	)
}

// externalShortcuts are the keys this build installs outside the window
// dispatcher, with the surface that owns each. They appear in the reference
// because they are real; nothing in this file handles them.
var externalShortcuts = []externalShortcut{
	{ID: "fixed.send", Keys: []shortcutKey{{Key: ui.KeyEnter}}, Title: "发送消息；繁忙时按「繁忙时的发送行为」处理"},
	{ID: "fixed.newline", Keys: []shortcutKey{{Mods: ui.Shift, Key: ui.KeyEnter}}, Title: "换行而不发送"},
	{ID: "fixed.complementary", Keys: []shortcutKey{{Mods: ui.Cmd, Key: ui.KeyEnter}, {Mods: ui.Ctrl, Key: ui.KeyEnter}}, Title: "以另一种发送行为发送"},
	{ID: "edit.system", Keys: []shortcutKey{{Mods: ui.Cmd, Key: ui.KeyC}, {Mods: ui.Cmd, Key: ui.KeyV}, {Mods: ui.Cmd, Key: ui.KeyA}}, Title: "复制、粘贴、全选（系统编辑菜单）"},
	{ID: "shell.workspaceLocal", Keys: []shortcutKey{{Mods: ui.Cmd | ui.Shift, Key: ui.KeyL}}, Title: "打开本地工作区（应用菜单）"},
	{ID: "shell.workspaceNative", Keys: []shortcutKey{{Mods: ui.Cmd | ui.Shift, Key: ui.KeyN}}, Title: "返回原生界面（应用菜单）"},
	// AppKit owns this key: the "工作区 → 重新加载工作区" menu item carries it,
	// and its click restarts the Host of a launch that owns one. A second
	// handler in the window would never see the key, so the row describes the
	// menu item instead of pretending the window handles it.
	{ID: "shell.workspaceReload", Keys: []shortcutKey{{Mods: ui.Cmd, Key: ui.KeyR}}, Title: "重新加载工作区（应用菜单；本地 Host 模式下重启宿主）"},
}

// dispatchShortcuts runs the table. It is the only caller of the bindings'
// commands: one press runs at most one command, and the window's shortcuts
// are the fallback MyGo routes a key to when nothing in the focus chain
// claimed it.
//
// Every row asks for its key on every frame, even once one of them took the
// key: MyGo routes the next press against the rows the last frame registered,
// so a row skipped after a match would wait a frame for its own key.
func (a *app) dispatchShortcuts(c *ui.Context) {
	var hit *shortcutBinding
	repeated := false
	for i := range shortcutBindings {
		binding := &shortcutBindings[i]
		if !c.Shortcut(binding.Key.Mods, binding.Key.Key) {
			continue
		}
		if hit == nil {
			hit, repeated = binding, c.ShortcutRepeated()
		}
	}
	if hit != nil && (hit.Repeat || !repeated) {
		hit.Run(a)
	}
}

// shortcutReferenceRows is the list the settings page shows, built from the
// same table the window dispatches. Consecutive rows of one command share a
// line, as nine digits of one command do.
func shortcutReferenceRows() [][2]string {
	rows := make([][2]string, 0, len(shortcutBindings)+len(externalShortcuts))
	for i := 0; i < len(shortcutBindings); {
		first := shortcutBindings[i]
		labels := []string{first.Key.label()}
		j := i + 1
		for j < len(shortcutBindings) && sameShortcutRow(first, shortcutBindings[j]) {
			labels = append(labels, shortcutBindings[j].Key.label())
			j++
		}
		rows = append(rows, [2]string{strings.Join(labels, " / "), first.Title})
		i = j
	}
	for _, external := range externalShortcuts {
		labels := make([]string, len(external.Keys))
		for i, key := range external.Keys {
			labels[i] = key.label()
		}
		rows = append(rows, [2]string{strings.Join(labels, " / "), external.Title})
	}
	return rows
}

// sameShortcutRow reports whether two bindings describe one command to the
// reader, so the reference shows them on one line.
func sameShortcutRow(a, b shortcutBinding) bool {
	return a.ID == b.ID && a.Title == b.Title && a.Scope == b.Scope
}

// label writes a key as the reference shows it: Command is the symbol on
// macOS and the platform's own shortcut modifier elsewhere.
func (k shortcutKey) label() string {
	var b strings.Builder
	if runtime.GOOS == "darwin" {
		if k.Mods&ui.Super != 0 {
			b.WriteString("⌘")
		}
		if k.Mods&ui.Ctrl != 0 {
			b.WriteString("⌃")
		}
		if k.Mods&ui.Alt != 0 {
			b.WriteString("⌥")
		}
		if k.Mods&ui.Shift != 0 {
			b.WriteString("⇧")
		}
	} else {
		for _, m := range []struct {
			mod  ui.Modifiers
			name string
		}{{ui.Ctrl, "Ctrl"}, {ui.Alt, "Alt"}, {ui.Shift, "Shift"}} {
			if k.Mods&m.mod != 0 {
				b.WriteString(m.name)
				b.WriteByte('+')
			}
		}
	}
	b.WriteString(shortcutKeySymbol(k.Key))
	return b.String()
}

// shortcutKeySymbol writes the key itself, in the shape the rest of this
// client's copy uses.
func shortcutKeySymbol(key ui.Key) string {
	switch {
	case key >= ui.KeyA && key <= ui.KeyZ:
		return string(rune('A' + key - ui.KeyA))
	case key >= ui.Key0 && key <= ui.Key9:
		return string(rune('0' + key - ui.Key0))
	}
	switch key {
	case ui.KeyEscape:
		return "Esc"
	case ui.KeyEnter:
		return "Enter"
	case ui.KeyComma:
		return ","
	case ui.KeyEqual:
		return "="
	case ui.KeyMinus:
		return "-"
	case ui.KeySlash:
		return "/"
	case ui.KeyBracketLeft:
		return "["
	case ui.KeyBracketRight:
		return "]"
	case ui.KeyBackquote:
		return "`"
	case ui.KeyUp:
		return "↑"
	case ui.KeyDown:
		return "↓"
	}
	return "?"
}

// --- commands -------------------------------------------------------------
//
// Each command below reuses the entry point the visible surface uses, so a
// key and a click cannot drift apart.

func (a *app) toggleSidebar() { a.sidebar = !a.sidebar }

// openSessionSearch is what ⌘K has always done: open the sidebar and its
// search field, rather than close a search the key just opened.
func (a *app) openSessionSearch() {
	a.sidebar = true
	a.searchOpen = true
}

func (a *app) openSettingsPanel() { a.settingsOpen = true }

// openShortcutReference opens the settings page that renders
// shortcutReferenceRows, so ⌘/ and the page cannot disagree.
func (a *app) openShortcutReference() { a.openSettingsSection("shortcuts") }

// shortcutSessions is the order ⌘1…⌘9 and ⌘⇧[ / ⌘⇧] step through: the
// Session rows the sidebar shows, in the order it shows them. A key and a
// click therefore pick the same Session, and a collapsed Workspace or an
// archived filter changes both.
func (a *app) shortcutSessions() []session {
	sessions := make([]session, 0, len(a.sessions))
	for _, row := range a.sidebarRows() {
		if row.Kind == "session" {
			sessions = append(sessions, row.Session)
		}
	}
	return sessions
}

// switchSessionTo opens the Session at index, if there is one and it is not
// already open. There is nothing to do past the rows that exist.
func (a *app) switchSessionTo(index int) {
	sessions := a.shortcutSessions()
	if index < 0 || index >= len(sessions) {
		return
	}
	if sessions[index].ID == a.sessionID {
		return
	}
	a.chooseSession(sessions[index])
}

// stepSession moves delta rows from the open Session and stops at either end
// rather than wrapping, so ⌘⇧[ cannot jump from the first Session to the
// last by accident.
func (a *app) stepSession(delta int) {
	for i, s := range a.shortcutSessions() {
		if s.ID != a.sessionID {
			continue
		}
		a.switchSessionTo(i + delta)
		return
	}
}

// toggleRightPane is the header's "切换右侧栏" button, and it releases the
// page the pane was hosting when the pane closes: a closed pane must not keep
// an owner registered on the Host.
func (a *app) toggleRightPaneFullscreen() {
	if !a.rightPaneOpen {
		a.rightPaneOpen = true
	}
	a.rightPaneFull = !a.rightPaneFull
}

func (a *app) toggleRightPane() {
	if a.rightPaneOpen {
		a.rightPaneFull = false
	}
	a.rightPaneOpen = !a.rightPaneOpen
	if !a.rightPaneOpen && a.compatPlacement == "right" {
		a.closeCompat()
	}
	if !a.rightPaneOpen && a.webPlacement == "right" {
		a.closeWeb()
	}
}

// openTerminalPane is the header's terminal chip: show the pane, then open
// the terminal page in it.
// openBrowser is the reference's ⌘T. The native client has one web surface,
// not yet a right-pane browser tab, so it opens that surface.
// adjustFont moves one role's font size within the range the settings page
// accepts, then persists the preference. The reference exposes the six
// commands even though its bindings table no longer ships defaults.
func (a *app) adjustFont(role string, delta float32) {
	clamp := func(v float32) float32 { return min(max(v, 10), 22) }
	switch role {
	case "text":
		a.uiPrefs.FontSize = clamp(a.uiPrefs.FontSize + delta)
	case "code":
		a.uiPrefs.CodeFontSize = clamp(a.uiPrefs.CodeFontSize + delta)
	case "terminal":
		a.uiPrefs.TerminalFontSize = clamp(a.uiPrefs.TerminalFontSize + delta)
	default:
		return
	}
	a.savePreferences()
}

func (a *app) openBrowser() {
	if a.webURL == "" {
		a.error = "没有配置兼容页面地址。"
		return
	}
	a.openWeb()
}

func (a *app) openTerminalPane() {
	a.rightPaneOpen = true
	a.openCompatAt("terminal", "right")
}

// openPluginsPage is the sidebar's "插件" entry.
func (a *app) openPluginsPage() { a.openCompat("plugins") }

// scrollConversationTop and scrollConversationBottom move the conversation
// list; asking for a row it lays out in this same pass is how MyGo scrolls a
// list from a key. Another tab has no conversation on screen, so the request
// would wait for a list that is not there and jump when it came back.
func (a *app) scrollConversationTop() {
	if a.currentTab != "chat" {
		return
	}
	a.list.ScrollTo(0, ui.Start)
}

func (a *app) scrollConversationBottom() {
	if a.currentTab != "chat" {
		return
	}
	a.list.ScrollToEnd()
}

// dismissOverlay closes the topmost overlay that is not one of MyGo's modals.
// A modal owns Esc through ui.Modal, and the window's shortcuts are not
// delivered while one is open, so nothing here can close two layers at once.
//
// A pending approval or question owns Esc too: conversation.go takes the key
// through the focus chain, and this row stays out of its way when no card
// holds the focus, so Esc can never answer a card the user was not looking at.
func (a *app) dismissOverlay() {
	if len(a.current.Pending) > 0 {
		return
	}
	handled := true
	switch {
	case a.compatPlacement == "modelPopover":
		a.closeCompat()
	case a.compatPlacement == "right":
		a.closeCompat()
	case a.web != nil && a.webPlacement == "right":
		a.closeWeb()
	case a.rightPaneFull:
		a.rightPaneFull = false
	case a.searchOpen:
		a.closeSearch()
	case a.connectionOpen:
		a.connectionOpen = false
	default:
		handled = false
	}
	if handled {
		return
	}
	// Nothing else owned Escape: two presses close together stop the running
	// Turn, as the reference's response.stop command does. A lone Escape only
	// arms the gesture, so it never cancels by accident.
	if a.current.Running && a.sessionID != "" {
		now := time.Now()
		if !a.lastEscapeAt.IsZero() && now.Sub(a.lastEscapeAt) < 600*time.Millisecond {
			a.lastEscapeAt = time.Time{}
			a.mutate("cancel", map[string]any{"sessionId": a.sessionID}, nil)
			return
		}
		a.lastEscapeAt = now
	}
}
