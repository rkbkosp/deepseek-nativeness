package main

// The application menu is the shell's only route to the process-level actions
// the original app has: closing the window, hiding the app, and quitting. These
// tests read the template the application installs, so a reordering or a lost
// role is a test failure rather than something only a key press would show.

import (
	"strings"
	"testing"

	"github.com/egoist/mygo"
)

// findMenuItem walks a menu template, and its submenus, for one ID.
func findMenuItem(items []*mygo.MenuItem, id string) *mygo.MenuItem {
	for _, item := range items {
		if item.ID == id {
			return item
		}
		if found := findMenuItem(item.Submenu, id); found != nil {
			return found
		}
	}
	return nil
}

// menuRoles lists the roles a submenu wires, in order.
func menuRoles(item *mygo.MenuItem) []mygo.MenuRole {
	roles := make([]mygo.MenuRole, 0, len(item.Submenu))
	for _, child := range item.Submenu {
		if child.Role != "" {
			roles = append(roles, child.Role)
		}
	}
	return roles
}

// setLocalLaunch makes the launch flags say what a --local-native run says, and
// restores them for the next test.
func setLocalLaunch(t *testing.T, local bool) {
	t.Helper()
	previous := localNativeMode
	localNativeMode = local
	t.Cleanup(func() { localNativeMode = previous })
}

func TestApplicationMenuKeepsItsExistingEntries(t *testing.T) {
	setLocalLaunch(t, false)
	menu := (&app{}).applicationMenu()
	items := menu.Items()
	if len(items) < 5 {
		t.Fatalf("menu has %d top-level items: %v", len(items), items)
	}
	if items[0].Role != mygo.RoleAppMenu || items[1].Role != mygo.RoleFileMenu {
		t.Fatalf("application and file menus are not first: %q %q", items[0].Role, items[1].Role)
	}
	for _, want := range []struct{ id, accelerator string }{
		{"about", ""},
		{"workspace.local", "CmdOrCtrl+Shift+L"},
		{"workspace.native", "CmdOrCtrl+Shift+N"},
		{"workspace.reload", "CmdOrCtrl+R"},
	} {
		item := findMenuItem(items, want.id)
		if item == nil {
			t.Fatalf("menu lost %q", want.id)
		}
		if item.Accelerator != want.accelerator {
			t.Errorf("%s accelerator = %q, want %q", want.id, item.Accelerator, want.accelerator)
		}
		if item.Click == nil {
			t.Errorf("%s has no click handler", want.id)
		}
	}
	// The About entry stays this client's panel, not the native one: it reports
	// the runtime version.
	if about := findMenuItem(items, "about"); !strings.HasPrefix(about.Label, "关于 ") || !strings.Contains(about.Label, productName) {
		t.Errorf("about label = %q", about.Label)
	}
	roles := map[mygo.MenuRole]bool{}
	for _, item := range items {
		roles[item.Role] = true
	}
	if !roles[mygo.RoleEditMenu] || !roles[mygo.RoleWindowMenu] {
		t.Errorf("edit or window menu lost: %v", roles)
	}
	// No Remote-era entry belongs in the menu of this client: the device list
	// and the Remote login are views, and a menu item must not point at them.
	for _, item := range menuWalk(items) {
		if item.Label != "" && strings.Contains(item.Label, "Remote") {
			t.Errorf("menu shows a Remote entry: %q", item.Label)
		}
	}
}

// menuWalk lists every item of a template, submenus included.
func menuWalk(items []*mygo.MenuItem) []*mygo.MenuItem {
	out := make([]*mygo.MenuItem, 0, len(items))
	for _, item := range items {
		out = append(out, item)
		out = append(out, menuWalk(item.Submenu)...)
	}
	return out
}

// The App menu has to offer what the original shell offers: the services
// submenu, hide/hide others/show all, and a quit entry that goes through the
// existing confirmation instead of a second quit path.
func TestApplicationMenuHasHideAndQuitRoles(t *testing.T) {
	setLocalLaunch(t, false)
	items := (&app{}).applicationMenu().Items()
	appMenu := items[0]
	roles := menuRoles(appMenu)
	for _, want := range []mygo.MenuRole{mygo.RoleServices, mygo.RoleHide, mygo.RoleHideOthers, mygo.RoleUnhide, mygo.RoleQuit} {
		found := false
		for _, role := range roles {
			if role == want {
				found = true
			}
		}
		if !found {
			t.Fatalf("application menu lost the %q role: %v", want, roles)
		}
	}
	quit := findMenuItem(items, "app.quit")
	if quit == nil {
		t.Fatal("quit entry is missing")
	}
	if quit.Role != mygo.RoleQuit {
		t.Fatalf("quit role = %q, want %q", quit.Role, mygo.RoleQuit)
	}
	if quit.Accelerator != "Cmd+Q" {
		t.Errorf("quit accelerator = %q, want Cmd+Q", quit.Accelerator)
	}
	// No Click of its own: MyGo's quit role asks the application to quit, which
	// runs OnBeforeQuit and therefore confirmQuit and stopLocalRuntimeForQuit.
	// A Click would be a second quit path that could skip both.
	if quit.Click != nil {
		t.Error("quit entry replaced the role with its own quit path")
	}
	hide := findMenuItem(items, "app.hide")
	if hide.Role != mygo.RoleHide || hide.Accelerator != "Cmd+H" {
		t.Errorf("hide = %q %q", hide.Role, hide.Accelerator)
	}
	// The services role needs a submenu of its own for AppKit to own it.
	services := findMenuItem(items, "app.services")
	if services.Role != mygo.RoleServices || services.Submenu == nil {
		t.Errorf("services entry = %q submenu=%v", services.Role, services.Submenu != nil)
	}
}

// The File menu closes the window (which the close policy turns into hide while
// this process owns a Host) and offers the Session archive.
func TestApplicationMenuHasCloseAndSessionArchive(t *testing.T) {
	setLocalLaunch(t, true)
	items := (&app{}).applicationMenu().Items()
	fileMenu := items[1]
	closeItem := findMenuItem(items, "file.close")
	if closeItem == nil || closeItem.Role != mygo.RoleClose {
		t.Fatalf("file menu lost the close role: %+v", fileMenu.Submenu)
	}
	if closeItem.Accelerator != "CmdOrCtrl+W" {
		t.Errorf("close accelerator = %q, want CmdOrCtrl+W", closeItem.Accelerator)
	}
	zip := findMenuItem(items, "file.exportSessionZip")
	if zip == nil {
		t.Fatal("file menu lost the Session archive entry")
	}
	if zip.Label != "导出会话 ZIP…" {
		t.Errorf("archive label = %q", zip.Label)
	}
	if zip.Click == nil {
		t.Error("archive entry has no action")
	}
	if zip.Disabled {
		t.Error("a launch that owns its Host cannot export its Session archive")
	}
	if zip.ToolTip != sessionZipLocalTooltip {
		t.Errorf("local tooltip = %q", zip.ToolTip)
	}
}

// The same entry in a Remote launch: still there, still disabled, with the copy
// it always had.
func TestApplicationMenuRemoteKeepsTheArchiveEntryDisabled(t *testing.T) {
	setLocalLaunch(t, false)
	items := (&app{}).applicationMenu().Items()
	zip := findMenuItem(items, "file.exportSessionZip")
	if zip == nil {
		t.Fatal("file menu lost the Session archive entry")
	}
	if !zip.Disabled {
		t.Error("a Remote launch offered an archive its Host cannot serve")
	}
	if zip.ToolTip != "当前 Remote 未提供原始 Session 日志下载接口" {
		t.Errorf("remote tooltip = %q", zip.ToolTip)
	}
	if zip.Label != "导出会话 ZIP…" {
		t.Errorf("archive label = %q", zip.Label)
	}
}

// The conversation menu entry follows the same mode rule, and stays disabled
// without a Session even in a launch that owns its Host.
func TestSessionArchiveOfferFollowsTheLaunch(t *testing.T) {
	local := sessionZipOffer(true)
	if !local.Enabled || local.Tooltip != sessionZipLocalTooltip || strings.Contains(local.Tooltip, "Remote") {
		t.Errorf("local offer = %+v", local)
	}
	remote := sessionZipOffer(false)
	if remote.Enabled {
		t.Error("a Remote launch offered the archive")
	}
	if remote.Tooltip != "当前 Remote 未提供原始 Session 日志下载接口" {
		t.Errorf("remote offer = %+v", remote)
	}
}

// canExportSessionZip answers for the menu before the runtime object exists:
// only a launch that owns its Host can produce the archive.
func TestCanExportSessionZipNeedsALocalLaunch(t *testing.T) {
	setLocalLaunch(t, true)
	if !(&app{}).canExportSessionZip() {
		t.Error("a --local-native launch cannot export its archive")
	}
	setLocalLaunch(t, false)
	if (&app{}).canExportSessionZip() {
		t.Error("a plain launch claimed it can export an archive")
	}
	// The runtime object on its own is enough once it is there.
	native := &app{localRuntime: &localRuntime{native: true}}
	if !native.canExportSessionZip() {
		t.Error("an owned local Host cannot export its archive")
	}
	// The web workspace mode owns the Host too, but it is not this client's
	// native surface: only the native mode answers here.
	web := &app{localRuntime: &localRuntime{}}
	if web.canExportSessionZip() {
		t.Error("the web workspace claimed the native archive action")
	}
}
