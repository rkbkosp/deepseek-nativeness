package main

import (
	"strings"
	"testing"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

// shortcutApp is a demonstration app and a Tester that injects real keys into
// the real view: the dispatch below is exercised the way a keyboard reaches it,
// not by calling the commands directly.
func shortcutApp(t *testing.T) (*app, *ui.Tester) {
	t.Helper()
	a := newApp(true)
	t.Cleanup(a.cancel)
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	return a, tt
}

// press sends one chord and lets the window frame it, as a user's key does.
func press(t *testing.T, tt *ui.Tester, mods ui.Modifiers, key ui.Key) {
	t.Helper()
	tt.Key(mods, key)
	tt.Frame()
}

// shortcutLabels is every key the table installs, in reference order.
func shortcutLabels() []string {
	labels := []string{}
	for _, binding := range shortcutBindings {
		labels = append(labels, binding.Key.label())
	}
	return labels
}

// The table is the only place a key is decided, so two rows for one key is a
// build failure rather than a race between handlers. The keys outside the
// window (the composer, the cards, the application menu) count too: a new
// binding must not take a key they already install.
func TestShortcutBindingsAreOneKeyMapWithoutCollisions(t *testing.T) {
	seen := map[shortcutKey]string{}
	add := func(key shortcutKey, id string) {
		t.Helper()
		if previous, taken := seen[key]; taken {
			t.Fatalf("%s 与 %s 绑定了同一个键位 %s", previous, id, key.label())
		}
		seen[key] = id
	}
	for _, binding := range shortcutBindings {
		if binding.ID == "" || binding.Title == "" {
			t.Fatalf("binding %+v is incomplete", binding)
		}
		if binding.Run == nil {
			t.Fatalf("%s 注册了键 %s 却没有命令：未实现的动作不能出现在表里", binding.ID, binding.Key.label())
		}
		if label := binding.Key.label(); strings.Contains(label, "?") {
			t.Fatalf("%s 的键位无法写成速查表里的记号: %q", binding.ID, label)
		}
		add(binding.Key, binding.ID)
	}
	for _, external := range externalShortcuts {
		if external.ID == "" || external.Title == "" || len(external.Keys) == 0 {
			t.Fatalf("external row %+v is incomplete", external)
		}
		for _, key := range external.Keys {
			add(key, external.ID)
		}
	}
}

// Every key this batch promised is in the table, and the two that the surfaces
// outside the window own are listed as theirs rather than bound twice.
func TestShortcutTableCoversThePromisedKeys(t *testing.T) {
	rows := shortcutReferenceRows()
	has := func(label string) bool {
		for _, row := range rows {
			for _, part := range strings.Split(row[0], " / ") {
				if part == label {
					return true
				}
			}
		}
		return false
	}
	for _, label := range []string{
		"⌘N", "⌘1", "⌘2", "⌘3", "⌘4", "⌘5", "⌘6", "⌘7", "⌘8", "⌘9",
		"⌘⇧[", "⌘⇧]", "⌘R", "⌘/", "⌘F", "Esc", "⌘↑", "⌘↓",
		"⌘⇧B", "⌃`", "⌘⇧P",
	} {
		if !has(label) {
			t.Fatalf("速查表缺 %s: %v", label, rows)
		}
	}
}

// The settings page cannot advertise a key the window does not install, and it
// cannot forget one it does: both lists are the same function.
func TestShortcutReferenceIsDerivedFromTheDispatchedTable(t *testing.T) {
	rows := shortcutReferenceRows()
	if len(settingsShortcutRows) != len(rows) {
		t.Fatalf("settings table has %d rows, the table builds %d", len(settingsShortcutRows), len(rows))
	}
	for i := range rows {
		if settingsShortcutRows[i] != rows[i] {
			t.Fatalf("row %d = %v, table says %v", i, settingsShortcutRows[i], rows[i])
		}
	}
	for _, binding := range shortcutBindings {
		label := binding.Key.label()
		found := false
		for _, row := range rows {
			if strings.Contains(row[0], label) {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("%s 的键 %s 不在速查表里", binding.ID, label)
		}
	}
	// Archive, rename and fork are wired now, so their keys must be listed.
	for _, key := range []string{"⌘⇧A", "⌘⌥G", "⌘⌥F"} {
		found := false
		for _, row := range rows {
			if strings.Contains(row[0], key) {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("速查表缺 %s: %v", key, rows)
		}
	}
}

// ⌘B, ⌘K, ⌘, and ⌘/ are now rows of the table; the keys must still do what
// they did before they moved, and ⌘/ must reach the page that lists them.
func TestWindowShortcutKeysKeepTheirCommands(t *testing.T) {
	a, tt := shortcutApp(t)

	if a.sidebar != true {
		t.Fatal("the sidebar did not start open")
	}
	press(t, tt, ui.Cmd, ui.KeyB)
	if a.sidebar {
		t.Fatal("⌘B did not collapse the sidebar")
	}
	press(t, tt, ui.Cmd, ui.KeyB)
	if !a.sidebar {
		t.Fatal("⌘B did not expand the sidebar again")
	}

	// ⌘K opens the search and never closes the search it just opened.
	press(t, tt, ui.Cmd, ui.KeyK)
	if !a.searchOpen || !a.sidebar {
		t.Fatalf("⌘K left searchOpen=%v sidebar=%v", a.searchOpen, a.sidebar)
	}
	press(t, tt, ui.Cmd, ui.KeyK)
	if !a.searchOpen {
		t.Fatal("⌘K closed the search it opened")
	}
	a.closeSearch()

	// ⌘F has no transcript search to open, so it opens the Session search.
	press(t, tt, ui.Cmd, ui.KeyF)
	if !a.searchOpen {
		t.Fatal("⌘F did not open the Session search")
	}
	a.closeSearch()
	tt.Frame()

	press(t, tt, ui.Cmd, ui.KeyComma)
	if !a.settingsOpen || a.settingsSection != "general" {
		t.Fatalf("⌘, left settingsOpen=%v section=%q", a.settingsOpen, a.settingsSection)
	}
	a.closeSettings()
	tt.Frame()

	press(t, tt, ui.Cmd, ui.KeySlash)
	if !a.settingsOpen || a.settingsSection != "shortcuts" {
		t.Fatalf("⌘/ left settingsOpen=%v section=%q", a.settingsOpen, a.settingsSection)
	}
	// The page it opens is the reference list, from the same table.
	for _, want := range []string{"快捷键", "⌘⇧B", "展开或收起右栏", "⌘N", "新建会话"} {
		if !tt.HasText(want) {
			t.Fatalf("快捷键页缺 %q", want)
		}
	}
}

// ⌘N goes through the same intent the sidebar's new-session button uses: an
// unauthorised client is sent to the connection page, and a connected client
// creates a Session.
func TestNewSessionKeyRunsTheVisibleEntryPoint(t *testing.T) {
	a, tt := shortcutApp(t)
	press(t, tt, ui.Cmd, ui.KeyN)
	if !a.connectionOpen {
		t.Fatal("⌘N did not reach the new-session decision")
	}

	connected := newApp(true)
	t.Cleanup(connected.cancel)
	connected.connected = true
	connected.sessionID = "demo-current"
	ct := ui.NewTester(connected.view, 1280, 820)
	ct.Frame()
	generation := connected.navigationGeneration
	press(t, ct, ui.Cmd, ui.KeyN)
	if connected.navigationGeneration == generation {
		t.Fatal("⌘N never started a Session navigation")
	}
	if connected.error != "Remote 未连接，操作未发送。" {
		t.Fatalf("⌘N error = %q, want the write guard's own message", connected.error)
	}
}

// ⌘1…⌘9 pick the sidebar's rows in the order the sidebar shows them, and a
// digit past the last row does nothing rather than inventing a Session.
func TestDigitKeysPickTheSidebarSessions(t *testing.T) {
	a, tt := shortcutApp(t)
	rows := []string{}
	for _, row := range a.sidebarRows() {
		if row.Kind == "session" {
			rows = append(rows, row.Session.ID)
		}
	}
	if len(rows) < 3 {
		t.Fatalf("the demonstration workspace shows %d Sessions", len(rows))
	}
	digits := []ui.Key{ui.Key1, ui.Key2, ui.Key3, ui.Key4, ui.Key5, ui.Key6, ui.Key7, ui.Key8, ui.Key9}
	for i, key := range digits {
		press(t, tt, ui.Cmd, key)
		want := a.sessionID
		if i < len(rows) {
			want = rows[i]
		}
		if a.sessionID != want {
			t.Fatalf("⌘%d opened %q, want %q", i+1, a.sessionID, want)
		}
	}
}

// ⌘⇧[ and ⌘⇧] walk the same rows and stop at either end: they never wrap, so a
// missed key cannot jump a user from the first Session to the last.
func TestSessionSteppingKeysStopAtTheEnds(t *testing.T) {
	a, tt := shortcutApp(t)
	rows := []string{}
	for _, row := range a.sidebarRows() {
		if row.Kind == "session" {
			rows = append(rows, row.Session.ID)
		}
	}
	if len(rows) < 3 {
		t.Fatalf("the demonstration workspace shows %d Sessions", len(rows))
	}
	a.sessionID = rows[0]
	tt.Frame()
	press(t, tt, ui.Cmd|ui.Shift, ui.KeyBracketLeft)
	if a.sessionID != rows[0] {
		t.Fatalf("⌘⇧[ wrapped to %q", a.sessionID)
	}
	for i := 1; i < len(rows); i++ {
		press(t, tt, ui.Cmd|ui.Shift, ui.KeyBracketRight)
		if a.sessionID != rows[i] {
			t.Fatalf("⌘⇧] opened %q, want %q", a.sessionID, rows[i])
		}
	}
	press(t, tt, ui.Cmd|ui.Shift, ui.KeyBracketRight)
	if a.sessionID != rows[len(rows)-1] {
		t.Fatalf("⌘⇧] wrapped to %q", a.sessionID)
	}
	press(t, tt, ui.Cmd|ui.Shift, ui.KeyBracketLeft)
	if a.sessionID != rows[len(rows)-2] {
		t.Fatalf("⌘⇧[ opened %q, want %q", a.sessionID, rows[len(rows)-2])
	}
}

// ⌘⇧B toggles the right pane and releases the page it hosted: closing the pane
// must not leave an owner registered on the Host.
func TestRightPaneKeyTogglesAndReleasesItsPage(t *testing.T) {
	a, tt := shortcutApp(t)
	press(t, tt, ui.Cmd|ui.Shift, ui.KeyB)
	if !a.rightPaneOpen {
		t.Fatal("⌘⇧B did not open the right pane")
	}
	// A terminal page hosted on the right, then the pane closed.
	a.compatPlacement = "right"
	a.compatPage = "terminal"
	a.compatOwner = "owner-1"
	tt.Frame()
	press(t, tt, ui.Cmd|ui.Shift, ui.KeyB)
	if a.rightPaneOpen {
		t.Fatal("⌘⇧B did not close the right pane")
	}
	if a.compatPlacement != "" || a.compatOwner != "" || a.compatPage != "" {
		t.Fatalf("the closed pane kept its page: placement=%q owner=%q page=%q", a.compatPlacement, a.compatOwner, a.compatPage)
	}
	press(t, tt, ui.Cmd|ui.Shift, ui.KeyB)
	if !a.rightPaneOpen {
		t.Fatal("⌘⇧B did not reopen the right pane")
	}
}

// ⌃` and ⌘⇧P open the pages the sidebar and the session header open, by the
// same entry points: the terminal in the right pane, the plugins page in the
// main area.
func TestTerminalAndPluginsKeysOpenTheirPages(t *testing.T) {
	opened := []string{}
	compatOpenedForTest = func(page string) { opened = append(opened, page) }
	t.Cleanup(func() { compatOpenedForTest = nil })

	a, tt := shortcutApp(t)
	press(t, tt, ui.Ctrl, ui.KeyBackquote)
	if len(opened) != 1 || opened[0] != "terminal" {
		t.Fatalf("⌃` opened %v", opened)
	}
	if !a.rightPaneOpen {
		t.Fatal("⌃` did not show the pane the terminal belongs in")
	}
	press(t, tt, ui.Cmd|ui.Shift, ui.KeyP)
	if len(opened) != 2 || opened[1] != "plugins" {
		t.Fatalf("⌘⇧P opened %v", opened)
	}
}

// ⌘↑ and ⌘↓ move the conversation list. A chat starts at its end, so the first
// rows are out of view until the key brings them back and the last row is the
// one to return to.
func TestScrollKeysMoveTheConversationList(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sessionID = "scroll"
	messages := make([]message, 0, 40)
	for i := 0; i < 40; i++ {
		messages = append(messages, message{ID: shortID(i), Role: "user", Kind: "user", Turn: i + 1, Text: shortRow(i)})
	}
	a.current = snapshot{SessionID: a.sessionID, Messages: messages}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if tt.HasText(shortRow(0)) || !tt.HasText(shortRow(39)) {
		t.Fatal("the chat did not open at its end")
	}
	press(t, tt, ui.Cmd, ui.KeyUp)
	if !tt.HasText(shortRow(0)) || tt.HasText(shortRow(39)) {
		t.Fatal("⌘↑ did not scroll to the top")
	}
	press(t, tt, ui.Cmd, ui.KeyDown)
	if tt.HasText(shortRow(0)) || !tt.HasText(shortRow(39)) {
		t.Fatal("⌘↓ did not scroll to the end")
	}
}

func shortID(i int) string { return "m" + string(rune('a'+i%26)) + string(rune('a'+i/26)) }
func shortRow(i int) string {
	return "滚动行 " + string(rune('0'+i/10)) + string(rune('0'+i%10))
}

// Esc closes one overlay per press, topmost first, and reaches the overlays
// MyGo does not already dismiss: the model popover, a page hosted on the right,
// the search field, and the connection page.
func TestEscapeClosesOneOverlayPerPress(t *testing.T) {
	a, tt := shortcutApp(t)
	a.compatPlacement = "modelPopover"
	a.compatPage = "model-menu"
	a.modelPopoverOpen = true
	tt.Frame()

	press(t, tt, 0, ui.KeyEscape)
	if a.compatPlacement != "" || a.modelPopoverOpen {
		t.Fatalf("Esc left the model popover: placement=%q open=%v", a.compatPlacement, a.modelPopoverOpen)
	}

	// The search field takes Esc itself once it holds the focus, so the two
	// layers are opened one frame apart and each press closes exactly one.
	a.searchOpen = true
	tt.Frame()
	press(t, tt, 0, ui.KeyEscape)
	if a.searchOpen {
		t.Fatal("Esc did not close the search")
	}
	if a.compatPlacement != "" {
		t.Fatal("the search's Esc also closed another layer")
	}

	a.compatPlacement = "right"
	a.compatPage = "terminal"
	a.compatOwner = "owner-2"
	tt.Frame()
	press(t, tt, 0, ui.KeyEscape)
	if a.compatPlacement != "" || a.compatOwner != "" {
		t.Fatalf("Esc left the right-pane page: %q %q", a.compatPlacement, a.compatOwner)
	}

	a.connectionOpen = true
	tt.Frame()
	press(t, tt, 0, ui.KeyEscape)
	if a.connectionOpen {
		t.Fatal("Esc did not close the connection page")
	}
}

// A waiting approval keeps Esc: the card owns the key through the focus chain,
// and the window's row stays out of its way so a press cannot dismiss a pane
// behind a card the user is answering.
func TestEscapeLeavesAPendingCardAlone(t *testing.T) {
	a, tt := shortcutApp(t)
	a.current = snapshot{SessionID: a.sessionID, Pending: []interaction{{ID: "req", Kind: "approval", Title: "需要审批"}}}
	a.rightPaneOpen = true
	a.compatPlacement = "right"
	a.compatPage = "terminal"
	tt.Frame()
	press(t, tt, 0, ui.KeyEscape)
	if a.compatPlacement != "right" || a.compatPage != "terminal" {
		t.Fatal("Esc closed a layer behind a pending card")
	}
}

// A modal owns the window's keys: while settings is open, ⌘B must not reach
// the sidebar behind it.
func TestWindowShortcutsWaitBehindAModal(t *testing.T) {
	a, tt := shortcutApp(t)
	a.settingsOpen = true
	tt.Frame()
	before := a.sidebar
	press(t, tt, ui.Cmd, ui.KeyB)
	if a.sidebar != before {
		t.Fatal("⌘B reached the window behind an open modal")
	}
}

// 1.5: the selectable text of a bubble, of a tool's output and of an assistant
// reply offers the system's Copy and Select All. Nothing here installs a menu:
// MyGo gives selectable text one, and this test is what says so. Select All
// works without a selection; Copy waits for one.
func TestSelectableTextKeepsCopyAndSelectAll(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sessionID = "text"
	a.uiPrefs.StepsDetail = "verbose"
	a.current = snapshot{SessionID: a.sessionID, Messages: []message{
		{ID: "u", Role: "user", Kind: "user", Turn: 1, Text: "气泡里的文字"},
		{ID: "t", Role: "tool", Kind: "tool", Turn: 1, Text: "HTTP/1.1 200 OK tool output",
			Tool: &toolNode{Name: "bash", Phase: "settled", ArgsRaw: `{"command":"echo hi","description":"run"}`}},
		{ID: "a", Role: "assistant", Kind: "assistant", Turn: 1, Text: "助手回复正文",
			AssistantBlocks: []assistantBlock{{Kind: "text", Text: "助手回复正文"}}},
		{ID: "c", Role: "assistant", Kind: "assistant", Turn: 1, Text: "示例：\n\n```go\ncodeBlockLine()\n```\n",
			AssistantBlocks: []assistantBlock{{Kind: "text", Text: "示例：\n\n```go\ncodeBlockLine()\n```\n"}}},
	}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if err := tt.Click("运行命令"); err != nil {
		t.Fatalf("expand the tool row: %v", err)
	}
	tt.Frame()

	for _, target := range []string{"气泡里的文字", "HTTP/1.1 200 OK tool output", "助手回复正文", "codeBlockLine()"} {
		if err := tt.RightClick(target); err != nil {
			t.Fatalf("right click %q: %v", target, err)
		}
		tt.Frame()
		menu := tt.Menu()
		if !menuHas(menu, "Copy") || !menuHas(menu, "Select All") {
			t.Fatalf("%q 的右键菜单 = %v, want Copy 与 Select All", target, menu)
		}
		tt.CloseMenu()
	}

	// Without a selection Copy is disabled; Select All is the item that works.
	if err := tt.RightClick("气泡里的文字"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if err := tt.ChooseMenuItem("Copy"); err == nil {
		t.Fatal("Copy was enabled with nothing selected")
	}
	tt.CloseMenu()
	if err := tt.RightClick("气泡里的文字"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if err := tt.ChooseMenuItem("Select All"); err != nil {
		t.Fatalf("Select All: %v", err)
	}
	tt.Frame()
	if err := tt.RightClick("气泡里的文字"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if err := tt.ChooseMenuItem("Copy"); err != nil {
		t.Fatalf("Copy after Select All: %v", err)
	}
	tt.Frame()
	if got := tt.Clipboard(); got != "气泡里的文字" {
		t.Fatalf("clipboard = %q, want the selected bubble text", got)
	}
}

func menuHas(menu []string, label string) bool {
	for _, item := range menu {
		if item == label {
			return true
		}
	}
	return false
}

// ⌘R belongs to the application menu: its item carries the key equivalent and
// AppKit delivers the key there before the window sees it, so shortcuts.go must
// not bind it a second time — this test is what keeps the two from claiming it.
func TestApplicationMenuOwnsTheReloadKey(t *testing.T) {
	for _, binding := range shortcutBindings {
		if binding.Key == (shortcutKey{Mods: ui.Cmd, Key: ui.KeyR}) {
			t.Fatalf("%s 在窗口里又绑了一次 ⌘R；应用菜单已经拥有这个键", binding.ID)
		}
	}
	menu := (&app{}).applicationMenu()
	var reload *mygo.MenuItem
	for _, item := range menu.Items() {
		for _, sub := range item.Submenu {
			if sub.ID == "workspace.reload" {
				reload = sub
			}
		}
	}
	if reload == nil {
		t.Fatal("the application menu lost 重新加载工作区")
	}
	if reload.Click == nil {
		t.Fatal("重新加载工作区 has no click handler")
	}
	accelerator := reload.Accelerator
	if strings.Contains(accelerator, "Shift") || strings.Contains(accelerator, "Alt") {
		t.Fatalf("重新加载工作区 的键位带着 Shift 或 Alt: %q", accelerator)
	}
	if !strings.Contains(accelerator, "Cmd") || !strings.HasSuffix(accelerator, "+R") {
		t.Fatalf("重新加载工作区 的键位不是 ⌘R: %q", accelerator)
	}
}

// A held key repeats. A toggle takes the press alone, so holding ⌘B cannot
// flip the sidebar back and forth; the scroll keys step on every repeat.
func TestHeldKeysStepButTogglesTakeThePressAlone(t *testing.T) {
	a, tt := shortcutApp(t)
	before := a.sidebar
	tt.KeyRepeat(ui.Cmd, ui.KeyB)
	tt.Frame()
	if a.sidebar != before {
		t.Fatal("an auto-repeated ⌘B toggled the sidebar")
	}

	long := newApp(true)
	t.Cleanup(long.cancel)
	long.sessionID = "held"
	messages := make([]message, 0, 40)
	for i := 0; i < 40; i++ {
		messages = append(messages, message{ID: shortID(i), Role: "user", Kind: "user", Turn: i + 1, Text: shortRow(i)})
	}
	long.current = snapshot{SessionID: long.sessionID, Messages: messages}
	lt := ui.NewTester(long.view, 1280, 820)
	lt.Frame()
	lt.KeyRepeat(ui.Cmd, ui.KeyUp)
	lt.Frame()
	if !lt.HasText(shortRow(0)) {
		t.Fatal("a repeated ⌘↑ did not scroll the conversation")
	}
}

// The copy this batch may not edit names keys too (the sidebar's search hint).
// Deriving the label from the table is what keeps a hint from naming a key the
// table no longer binds.
func TestSearchHintNamesTheKeyTheTableBinds(t *testing.T) {
	label := ""
	for _, binding := range shortcutBindings {
		if binding.ID == "session.search" {
			label = binding.Key.label()
		}
	}
	if label == "" {
		t.Fatal("session.search is not in the table")
	}
	a := newApp(true)
	t.Cleanup(a.cancel)
	if hint := a.searchTooltip(); !strings.Contains(hint, label) {
		t.Fatalf("搜索提示 %q 没有写出表里的键 %s", hint, label)
	}
}

// ⌘O asks for a new Workspace through the sheet's own entry point: an
// unauthorised launch is sent to the connection page rather than to a form it
// cannot submit.
func TestAddWorkspaceKeyRunsTheSheetEntryPoint(t *testing.T) {
	a := newApp(false)
	t.Cleanup(a.cancel)
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	press(t, tt, ui.Cmd, ui.KeyO)
	if !a.connectionOpen {
		t.Fatal("⌘O did not reach the add-workspace decision")
	}
}
