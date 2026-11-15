package main

import (
	"context"
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

// A Workspace is a directory registered on the Host. This sheet only holds
// client-side form state; the directory and its registry entry stay on the
// Host, and every write goes through the same fenced mutation path as the rest
// of the remote actions.

type workspaceDirectoryEntry struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	Hidden bool   `json:"hidden"`
}

type workspaceDirectoryListing struct {
	Path      string                    `json:"path"`
	Home      string                    `json:"home"`
	Entries   []workspaceDirectoryEntry `json:"entries"`
	Truncated bool                      `json:"truncated"`
}

type workspaceCreateState struct {
	HostID, AccountScope, Path, Error string
	RemoteGeneration                  uint64
	Listing                           workspaceDirectoryListing
	Loading, Creating, Listed         bool
	// Open marks the new-Workspace sheet, and keeps a row that is only being
	// renamed from opening it. The inline rename (Rename) shares this
	// Host-scoped state because *app is frozen for this batch, and both edits
	// belong to the same Host/account/connection epoch: a reconnect retires them
	// together instead of leaving one armed against another Host's catalog.
	Open   bool
	Rename workspaceRenameState
}

// workspaceRenameState is one inline Workspace rename. It mirrors the Session
// rename fields (renameID/renameHost/renameScope/renameTitle): the target is
// pinned with its Host and account so a reply for an old selection cannot
// rename a row that now belongs to someone else.
type workspaceRenameState struct {
	WorkspaceID, HostID, AccountScope, Title string
}

// workspaceDeleteDialog is the one system prompt a delete shows. It is a
// package variable so a test can answer it without a window; the product path
// is mygo.Dialog.Message.
var workspaceDeleteDialog = mygo.Dialog.Message

// workspaceShowInFinder reveals a directory in the platform's file manager.
// The product path is MyGo's own reveal command, which selects the item in
// Finder rather than opening it as a new window.
var workspaceShowInFinder = mygo.Shell.ShowItemInFolder

// workspaceEditor returns the sheet state for the current Host selection. A
// different Host, account or connection epoch retires the old form so a late
// reply cannot fill another Host's sheet.
func (a *app) workspaceEditor() *workspaceCreateState {
	s := a.workspaceCreate
	if s == nil || s.HostID != a.hostID || s.AccountScope != a.accountScope || s.RemoteGeneration != a.remoteGeneration {
		s = &workspaceCreateState{HostID: a.hostID, AccountScope: a.accountScope, RemoteGeneration: a.remoteGeneration}
		a.workspaceCreate = s
	}
	return s
}

func (a *app) openWorkspaceCreate() {
	if a.demo {
		a.error = "当前是本地界面回放。请以正常模式连接 Remote 后操作。"
		return
	}
	switch a.workspaceCreateIntent() {
	case intentOpenConnection:
		a.connectionOpen = true
		a.fetchDevices()
		return
	case intentHold:
		// A local launch has no login page to send the reader to; the Host is
		// still starting or failed, and the status line already says which.
		a.error = a.localHostPhaseLabel()
		return
	}
	s := a.workspaceEditor()
	s.Path = ""
	s.Error = ""
	s.Listed = false
	s.Open = true
	s.Listing = workspaceDirectoryListing{}
	a.loadWorkspaceDirectory("")
}

func (a *app) closeWorkspaceCreate() {
	a.workspaceCreate = nil
}

// loadWorkspaceDirectory lists one Host directory. An empty path asks the Host
// for its home directory, which is also where the sheet starts.
func (a *app) loadWorkspaceDirectory(directory string) {
	s := a.workspaceEditor()
	if a.client == nil || !a.connected {
		s.Error = "请先连接远程主机。"
		return
	}
	if s.Loading {
		return
	}
	host, scope, generation, client := a.hostID, a.accountScope, a.remoteGeneration, a.client
	s.Loading = true
	s.Error = ""
	params := map[string]any{
		"path":        directory,
		"clientScope": map[string]any{"hostId": host, "generation": generation},
	}
	go func() {
		ctx, cancel := context.WithTimeout(a.ctx, 20*time.Second)
		defer cancel()
		raw, err := client.Call(ctx, "listDirectories", params)
		a.update(func() {
			if a.workspaceCreate != s || a.hostID != host || a.accountScope != scope || a.remoteGeneration != generation || a.client != client {
				return
			}
			s.Loading = false
			if err != nil {
				s.Error = err.Error()
				return
			}
			var listing workspaceDirectoryListing
			if err := json.Unmarshal(raw, &listing); err != nil {
				s.Error = err.Error()
				return
			}
			s.Listing = listing
			s.Listed = true
			if directory == "" || s.Path == "" {
				s.Path = listing.Home
			}
		})
	}()
}

func (a *app) createWorkspace() {
	s := a.workspaceEditor()
	path := strings.TrimSpace(s.Path)
	if path == "" {
		s.Error = "请填写主机上的工作区目录。"
		return
	}
	if !strings.HasPrefix(path, "/") {
		s.Error = "请填写主机上的绝对路径。"
		return
	}
	if !a.can("createWorkspace") {
		s.Error = "当前连接不允许新建工作区。"
		return
	}
	host, scope, generation := a.hostID, a.accountScope, a.remoteGeneration
	s.Creating = true
	s.Error = ""
	a.mutateWithFailure("createWorkspace", map[string]any{"path": path}, func(raw json.RawMessage) error {
		if a.workspaceCreate != s || a.hostID != host || a.accountScope != scope || a.remoteGeneration != generation {
			return nil
		}
		var result struct {
			Workspace struct {
				WorkspaceID string `json:"workspaceId"`
				Path        string `json:"path"`
				Title       string `json:"title"`
			} `json:"workspace"`
			Created bool `json:"created"`
		}
		if err := json.Unmarshal(raw, &result); err != nil {
			s.Error = err.Error()
			return nil
		}
		if result.Workspace.WorkspaceID == "" {
			s.Error = "主机未返回工作区标识，请刷新工作区目录后核对。"
			return nil
		}
		id := result.Workspace.WorkspaceID
		a.closeWorkspaceCreate()
		// The helper answers selectWorkspace from its own Workspace rows, so the
		// registry is re-read before the new row can be selected.
		a.refreshWorkspaces(func() {
			for _, w := range a.workspaces {
				if w.ID != id {
					continue
				}
				if a.uiPrefs.Expanded == nil {
					a.uiPrefs.Expanded = map[string]bool{}
				}
				a.uiPrefs.Expanded[id] = true
				a.savePreferences()
				a.selectWorkspace(id)
				return
			}
			a.detail = "工作区已创建，但尚未出现在远程目录中，请稍后刷新工作区。"
		})
		return nil
	}, func(error) {
		if a.workspaceCreate != s {
			return
		}
		s.Creating = false
	})
}

func (a *app) workspaceCreateView(c *ui.Context) {
	s := a.workspaceCreate
	if s == nil || !s.Open {
		return
	}
	open := true
	ui.Modal(c, &open, func() {
		ui.Column(c).Width(520).Gap(12).Children(func() {
			ui.Text(c, "新建远端工作区").FontSize(18).FontWeight(500)
			ui.Text(c, "工作区是主机上的一个目录。填写已存在的绝对路径，或从下面的目录中选择。").FontSize(12).TextColor(a.theme.TextMuted).Wrap()
			ui.TextInput(c, &s.Path).Label("主机目录").Placeholder("/Users/you/projects/app").AutoFocus()
			ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
				if s.Listing.Home != "" && s.Listing.Path != s.Listing.Home {
					if ui.ButtonBase(c).Label("主目录").Padding(4, 8).Children(func() { ui.Text(c, "主目录").FontSize(12) }).Clicked() {
						s.Path = s.Listing.Home
						a.loadWorkspaceDirectory(s.Listing.Home)
					}
				}
				if s.Listing.Path != "" {
					ui.Text(c, s.Listing.Path).FontSize(11).TextColor(a.theme.TextMuted).SingleLine().Ellipsis("…").Grow(1)
				}
				if ui.ButtonBase(c).Label("刷新目录").Padding(4, 8).Children(func() { ui.Text(c, "刷新").FontSize(12) }).Clicked() {
					a.loadWorkspaceDirectory(strings.TrimSpace(s.Path))
				}
				if ui.ButtonBase(c).Label("选择上级目录").Padding(4, 8).Children(func() { ui.Text(c, "上一级").FontSize(12) }).Clicked() {
					a.loadWorkspaceDirectory(parentDirectory(s.Listing.Path))
				}
			})
			if s.Loading {
				ui.Text(c, "正在读取主机目录…").FontSize(12).TextColor(a.theme.TextMuted)
			} else if s.Listed {
				entries := make([]workspaceDirectoryEntry, 0, len(s.Listing.Entries))
				for _, e := range s.Listing.Entries {
					if !e.Hidden {
						entries = append(entries, e)
					}
				}
				if len(entries) == 0 {
					ui.Text(c, "这个目录下没有子目录。").FontSize(12).TextColor(a.theme.TextMuted)
				} else {
					ui.Scroll(c).MaxHeight(220).Children(func() {
						ui.Column(c).Gap(2).Children(func() {
							for _, entry := range entries {
								child := entry
								if ui.ButtonBase(c.Key("workspace-dir-"+child.Path)).Height(28).Padding(0, 8).Gap(6).Radius(6).Justify(ui.Start).Label("目录 " + child.Name).Children(func() {
									icon(c, "folder-outline", 15).TextColor(a.theme.TextMuted)
									ui.Text(c, child.Name).FontSize(13).SingleLine().Ellipsis("…")
								}).Clicked() {
									s.Path = child.Path
									a.loadWorkspaceDirectory(child.Path)
								}
							}
						})
					})
				}
				if s.Listing.Truncated {
					ui.Text(c, "目录内容较多，只显示了一部分。").FontSize(11).TextColor(a.theme.TextMuted)
				}
			}
			if s.Error != "" {
				ui.Text(c, s.Error).FontSize(12).TextColor(ui.Hex("#b53a3a")).Wrap()
			}
			ui.Row(c).Justify(ui.End).Gap(8).Children(func() {
				if ui.Button(c, "取消").Clicked() {
					a.closeWorkspaceCreate()
				}
				if ui.PrimaryButton(c, "新建工作区").Disabled(s.Creating || strings.TrimSpace(s.Path) == "" || !a.can("createWorkspace")).Clicked() {
					a.createWorkspace()
				}
			})
		})
	})
	if !open && a.workspaceCreate == s {
		a.closeWorkspaceCreate()
	}
}

// parentDirectory walks one path segment up without assuming POSIX semantics
// beyond the absolute paths the Host already returned.
func parentDirectory(path string) string {
	path = strings.TrimRight(path, "/")
	if path == "" {
		return "/"
	}
	if i := strings.LastIndex(path, "/"); i > 0 {
		return path[:i]
	}
	return "/"
}

// --- Workspace row actions --------------------------------------------------
//
// The Workspace context menu is built as data first, then drawn. The
// capability rules and the menu the reader sees are one object, so a test can
// check the matrix without a window and the drawing code cannot grow a second
// copy of the conditions.

const (
	workspaceCommandNewSession = "new-session"
	workspaceCommandRename     = "rename"
	workspaceCommandDelete     = "delete"
	workspaceCommandReveal     = "reveal"
	workspaceCommandArchive    = "archive"
	workspaceCommandUnarchive  = "unarchive"
)

// workspaceMenuSessionLimit bounds the per-Session submenus. A Workspace with
// more Sessions than this offers the rest through the sidebar's own archived
// view instead of a menu that runs off the screen.
const workspaceMenuSessionLimit = 12

// workspaceMenuEntry is one item of the Workspace row's context menu, or one
// item of a submenu. Children turn the entry into a submenu; Separator draws a
// group break and is dropped when nothing surrounds it.
type workspaceMenuEntry struct {
	Command   string
	Label     string
	Subtitle  string
	Detail    string
	SessionID string
	Danger    bool
	Separator bool
	Visible   bool
	Enabled   bool
	Children  []workspaceMenuEntry
}

// actionBlockedDetail names why a Host operation is unavailable, using the
// reason the Host itself reported when it gave one.
func (a *app) actionBlockedDetail(method, fallback string) string {
	if !a.connected {
		return "连接主机后可用。"
	}
	if a.busy {
		return "上一操作尚未完成，请稍候。"
	}
	if !a.operationCaps[method].Supported {
		if reason := a.operationCaps[method].Reason; reason != "" {
			return reason
		}
		return fallback
	}
	return ""
}

// workspaceMenuEntries is the Workspace row's context menu for this Host and
// account. A row that is not a real Workspace ("未分组" carries no ID) offers
// no action at all: there is nothing on the Host to rename, delete or reveal.
func (a *app) workspaceMenuEntries(w workspace) []workspaceMenuEntry {
	real := w.ID != ""
	entry := func(command, method, label string, enabled bool, fallback string) workspaceMenuEntry {
		e := workspaceMenuEntry{Command: command, Label: label, Visible: real, Enabled: enabled}
		if !enabled {
			e.Detail = a.actionBlockedDetail(method, fallback)
		}
		return e
	}
	entries := []workspaceMenuEntry{
		entry(workspaceCommandNewSession, "createSession", "新建会话", a.can("createSession"), "当前连接不允许新建会话。"),
		entry(workspaceCommandRename, "renameWorkspace", "重命名工作区", a.can("renameWorkspace"), "当前连接不允许重命名工作区。"),
	}
	reveal := workspaceMenuEntry{
		Command: workspaceCommandReveal,
		Label:   "在 Finder 中显示",
		Visible: a.workspaceRevealAvailable(w),
		Enabled: a.workspaceRevealAvailable(w),
	}
	entries = append(entries, reveal, workspaceMenuEntry{Separator: true, Visible: real})

	active := a.workspaceMenuSessionEntries(w, false)
	archived := a.workspaceMenuSessionEntries(w, true)
	if len(active) > 0 {
		e := workspaceMenuEntry{Command: workspaceCommandArchive, Label: "归档会话", Visible: true, Enabled: a.can("archiveSession"), Children: active}
		if !e.Enabled {
			e.Detail = a.actionBlockedDetail("archiveSession", "当前连接不允许归档会话。")
		}
		entries = append(entries, e)
	}
	if len(archived) > 0 {
		e := workspaceMenuEntry{Command: workspaceCommandUnarchive, Label: "已归档会话", Visible: true, Enabled: a.can("unarchiveSession"), Children: archived}
		if !e.Enabled {
			e.Detail = a.actionBlockedDetail("unarchiveSession", "当前连接不允许取消归档。")
		}
		entries = append(entries, e)
	}
	entries = append(entries,
		workspaceMenuEntry{Separator: true, Visible: real},
		workspaceMenuEntry{
			Command: workspaceCommandDelete,
			Label:   "删除工作区…",
			Visible: real,
			Enabled: a.can("deleteWorkspace"),
			Danger:  true,
			Detail:  a.actionBlockedDetail("deleteWorkspace", "当前连接不允许删除工作区。"),
		},
	)
	return entries
}

// workspaceMenuSessionEntries lists the Sessions one submenu offers: the ones
// still in the default list for 归档会话, and the archived ones for the
// recovery submenu. Archived rows stay reachable whatever the sidebar filter
// shows, which is what makes archiving reversible from the menu.
func (a *app) workspaceMenuSessionEntries(w workspace, archived bool) []workspaceMenuEntry {
	method, command := "archiveSession", workspaceCommandArchive
	if archived {
		method, command = "unarchiveSession", workspaceCommandUnarchive
	}
	var out []workspaceMenuEntry
	for _, s := range a.workspaceSessions(w) {
		if s.Archived != archived {
			continue
		}
		label := strings.TrimSpace(s.Title)
		if label == "" {
			label = "未命名会话"
		}
		e := workspaceMenuEntry{Command: command, Label: label, SessionID: s.ID, Visible: true, Enabled: a.can(method)}
		if s.Running {
			e.Subtitle = "运行中"
		}
		if !e.Enabled {
			e.Detail = a.actionBlockedDetail(method, "当前连接不允许改动会话归档状态。")
		}
		out = append(out, e)
	}
	if len(out) > workspaceMenuSessionLimit {
		hidden := len(out) - workspaceMenuSessionLimit
		out = append(out[:workspaceMenuSessionLimit], workspaceMenuEntry{
			Label:   "还有 " + strconv.Itoa(hidden) + " 个会话…",
			Visible: true,
			Enabled: false,
			Detail:  "用侧栏的「视图选项」显示全部会话。",
		})
	}
	return out
}

// workspaceMenu draws the entries. Separators with nothing before or after
// them are dropped, so a Workspace without Sessions keeps a short menu.
func (a *app) workspaceMenu(m *ui.Menu, w workspace) {
	pendingSeparator, shown := false, false
	for _, e := range a.workspaceMenuEntries(w) {
		if !e.Visible {
			continue
		}
		if e.Separator {
			pendingSeparator = shown
			continue
		}
		if pendingSeparator {
			m.Separator()
			pendingSeparator = false
		}
		if e.Children != nil {
			item := m.Submenu(e.Label, func(sub *ui.Menu) {
				for _, child := range e.Children {
					if !child.Visible || child.Separator {
						continue
					}
					it := sub.Item(child.Label).Disabled(!child.Enabled)
					if child.Detail != "" {
						it.Tooltip(child.Detail)
					}
					if child.Subtitle != "" {
						it.Subtitle(child.Subtitle)
					}
					if it.Chosen() {
						a.runWorkspaceCommand(child.Command, w, child.SessionID)
					}
				}
			}).Disabled(!e.Enabled)
			if e.Detail != "" {
				item.Tooltip(e.Detail)
			}
			shown = true
			continue
		}
		item := m.Item(e.Label).Disabled(!e.Enabled)
		if e.Detail != "" {
			item.Tooltip(e.Detail)
		}
		if e.Danger {
			item.Danger()
		}
		if item.Chosen() {
			a.runWorkspaceCommand(e.Command, w, e.SessionID)
		}
		shown = true
	}
}

// runWorkspaceCommand is the one dispatcher for the entries above, so a menu
// item cannot be drawn enabled and then do nothing.
func (a *app) runWorkspaceCommand(command string, w workspace, sessionID string) {
	switch command {
	case workspaceCommandNewSession:
		a.createSessionIn(w.ID)
	case workspaceCommandRename:
		a.beginWorkspaceRename(w)
	case workspaceCommandReveal:
		a.revealWorkspace(w)
	case workspaceCommandDelete:
		a.confirmDeleteWorkspace(w)
	case workspaceCommandArchive, workspaceCommandUnarchive:
		for _, s := range a.sessions {
			if s.ID == sessionID {
				a.setSessionArchived(s, command == workspaceCommandArchive)
				return
			}
		}
		a.error = "会话已不在目录中，请刷新后重试。"
	}
}

// activeWorkspaceRename is the inline editor, or nil when there is none or it
// belongs to a retired Host/account/connection epoch.
func (a *app) activeWorkspaceRename() *workspaceRenameState {
	s := a.workspaceCreate
	if s == nil || s.Rename.WorkspaceID == "" {
		return nil
	}
	if s.HostID != a.hostID || s.AccountScope != a.accountScope || s.RemoteGeneration != a.remoteGeneration {
		return nil
	}
	return &s.Rename
}

func (a *app) workspaceRenaming(workspaceID string) bool {
	rename := a.activeWorkspaceRename()
	return rename != nil && rename.WorkspaceID == workspaceID
}

func (a *app) beginWorkspaceRename(w workspace) {
	if w.ID == "" {
		a.error = "「未分组」不是工作区，无法重命名。"
		return
	}
	if !a.can("renameWorkspace") {
		a.error = "当前连接不允许重命名工作区。" + a.actionBlockedDetail("renameWorkspace", "")
		return
	}
	s := a.workspaceEditor()
	// This state only carries the row's editor: it must not open the sheet.
	s.Open = false
	s.Rename = workspaceRenameState{WorkspaceID: w.ID, HostID: a.hostID, AccountScope: a.accountScope, Title: w.Name}
	a.error = ""
}

// cancelWorkspaceRename drops the editor without touching the catalog.
func (a *app) cancelWorkspaceRename() {
	s := a.workspaceCreate
	if s == nil {
		return
	}
	s.Rename = workspaceRenameState{}
	if !s.Open {
		a.workspaceCreate = nil
	}
}

// commitWorkspaceRename applies the typed name optimistically so the row
// updates at once, and restores the previous name when the Host refuses it.
// An unconfirmed receipt keeps the typed name: the client cannot know whether
// the Host applied it, and the mutation ledger already tells the reader to
// check the remote state rather than replay the write.
func (a *app) commitWorkspaceRename() {
	rename := a.activeWorkspaceRename()
	if rename == nil {
		return
	}
	title := strings.TrimSpace(rename.Title)
	if title == "" {
		a.error = "工作区名称不能为空。"
		return
	}
	var target workspace
	found := false
	for _, w := range a.workspaces {
		if w.ID == rename.WorkspaceID {
			target, found = w, true
			break
		}
	}
	if !found {
		a.error = "工作区已不在目录中，请刷新后重试。"
		a.cancelWorkspaceRename()
		return
	}
	if title == target.Name {
		a.cancelWorkspaceRename()
		return
	}
	if !a.can("renameWorkspace") {
		a.error = "当前连接不允许重命名工作区。" + a.actionBlockedDetail("renameWorkspace", "")
		return
	}
	id, previous, host, scope, generation := target.ID, target.Name, a.hostID, a.accountScope, a.remoteGeneration
	for i := range a.workspaces {
		if a.workspaces[i].ID == id {
			a.workspaces[i].Name = title
			break
		}
	}
	a.cancelWorkspaceRename()
	a.mutateWithFailure("renameWorkspace", map[string]any{"workspaceId": id, "title": title}, func(json.RawMessage) error {
		return nil
	}, func(err error) {
		for i := range a.workspaces {
			if a.workspaces[i].ID == id {
				a.workspaces[i].Name = previous
				break
			}
		}
		if a.hostID == host && a.accountScope == scope && a.remoteGeneration == generation {
			a.error = "重命名工作区失败，已恢复原名称：" + err.Error()
		}
	})
}

// confirmDeleteWorkspace asks before the only Workspace action that removes a
// row from every list. A cancelled or unshowable prompt sends nothing.
func (a *app) confirmDeleteWorkspace(w workspace) {
	if w.ID == "" {
		a.error = "「未分组」不是工作区，无法删除。"
		return
	}
	if !a.can("deleteWorkspace") {
		a.error = "当前连接不允许删除工作区。" + a.actionBlockedDetail("deleteWorkspace", "")
		return
	}
	answer, err := workspaceDeleteDialog(a.deleteWorkspaceConfirmation(w))
	if err != nil {
		a.error = "无法打开删除确认：" + err.Error()
		return
	}
	if answer.Button != 1 {
		return
	}
	a.deleteWorkspace(w)
}

// deleteWorkspace removes the Workspace from the Host registry. The directory
// and its logs stay on the Host; the Sessions it held fall back to 未分组.
func (a *app) deleteWorkspace(w workspace) {
	if w.ID == "" {
		a.error = "「未分组」不是工作区，无法删除。"
		return
	}
	if !a.can("deleteWorkspace") {
		a.error = "当前连接不允许删除工作区。" + a.actionBlockedDetail("deleteWorkspace", "")
		return
	}
	id, host, scope, generation := w.ID, a.hostID, a.accountScope, a.remoteGeneration
	a.mutateWithFailure("deleteWorkspace", map[string]any{"workspaceId": id}, func(json.RawMessage) error {
		a.forgetWorkspace(id)
		// The receipt is the Host's own acceptance, so the row leaves the list
		// at once; the refresh below is what makes the two catalogs agree,
		// including a read that is late or refused.
		kept := a.workspaces[:0]
		for _, row := range a.workspaces {
			if row.ID != id {
				kept = append(kept, row)
			}
		}
		a.workspaces = kept
		a.refreshCatalog(nil)
		return nil
	}, func(err error) {
		if a.hostID == host && a.accountScope == scope && a.remoteGeneration == generation {
			a.error = "删除工作区失败：" + err.Error()
		}
	})
}

// forgetWorkspace drops the client-side state that pointed at a removed row.
// Preferences are not rewritten here: an unused key is harmless, and a delete
// must not become a client-settings write.
func (a *app) forgetWorkspace(id string) {
	if a.uiPrefs.Expanded != nil {
		delete(a.uiPrefs.Expanded, id)
	}
	if a.watermarks != nil {
		delete(a.watermarks, id)
	}
	if a.workspaceID == id {
		a.workspaceID = ""
	}
	if a.workspaceRenaming(id) {
		a.cancelWorkspaceRename()
	}
}

// revealWorkspace selects the Host directory in this Mac's Finder. A missing
// directory is reported instead of opening its former parent.
func (a *app) revealWorkspace(w workspace) {
	if !a.workspaceRevealAvailable(w) {
		a.error = "工作区目录在主机上，这个窗口无法显示。"
		return
	}
	if _, err := os.Stat(w.Path); err != nil {
		a.error = "工作区目录已不存在：" + w.Path
		return
	}
	workspaceShowInFinder(w.Path)
}
