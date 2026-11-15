package main

import (
	"context"
	"encoding/json"
	"fmt"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
)

type paneFileEntry struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Size *int64 `json:"size,omitempty"`
}
type paneDirectory struct {
	Path      string          `json:"path"`
	Entries   []paneFileEntry `json:"entries"`
	Truncated bool            `json:"truncated"`
}
type paneTextFile struct {
	AbsolutePath string `json:"absolutePath"`
	Version      string `json:"version"`
	Bytes        *int64 `json:"bytes,omitempty"`
	Offset       int    `json:"offset"`
	Text         string `json:"text"`
	Lines        int    `json:"lines"`
	EOF          bool   `json:"eof"`
}
type paneTreeRow struct {
	Path, Name, Kind string
	Depth            int
}

// panePlan is the latest plan this Session submitted through `exit_plan_mode`.
// The plan text is a logged tool-call argument, not a separate Host endpoint:
// the Session projection this client already follows carries it, so reading it
// needs no extra call and cannot be a fake page.
type panePlan struct {
	Title, Markdown, CallID string
	Seq                     int64
	Found, Checked          bool
}

type rightPaneState struct {
	HostID, SessionID, Tab  string
	RemoteGeneration        uint64
	Directories             map[string]paneDirectory
	Expanded                map[string]bool
	Loading                 map[string]bool
	Error, Selected, Filter string
	// CurrentDir is the directory the breadcrumb names: the parent of the last
	// chosen row, or the last directory opened. "" is the workspace root.
	CurrentDir string
	ShowHidden bool
	Text       paneTextFile
	TextReady  bool
	Plan       panePlan
	Generation uint64
	TreeList   ui.ListState
	// TreeRow is TreeList's chosen row, -1 for none. It is state because the
	// list needs a stable *int across frames.
	TreeRow int
}

func (a *app) currentRightPane() *rightPaneState {
	if a.rightPane == nil || a.rightPane.HostID != a.hostID || a.rightPane.SessionID != a.sessionID || a.rightPane.RemoteGeneration != a.remoteGeneration {
		s := &rightPaneState{HostID: a.hostID, SessionID: a.sessionID, RemoteGeneration: a.remoteGeneration, Tab: "start", Directories: map[string]paneDirectory{}, Expanded: map[string]bool{"": true}, Loading: map[string]bool{}, TreeRow: -1}
		for directory, expanded := range a.paneSavedExpansion() {
			s.Expanded[directory] = expanded
		}
		a.rightPane = s
	}
	return a.rightPane
}

// paneScope names the tree the expansion belongs to: one Workspace keeps its
// open directories across its Sessions and across launches. A Session without
// a Workspace falls back to its own directory, then to its identity, so two
// unrelated trees never share keys.
func (a *app) paneScope() string {
	if a.workspaceID != "" {
		return "workspace:" + a.workspaceID
	}
	for _, s := range a.sessions {
		if s.ID == a.sessionID && s.Cwd != "" {
			return "cwd:" + s.Cwd
		}
	}
	return "session:" + a.sessionID
}

// panePrefPrefix keeps tree expansion in the one preference file this client
// already owns. The sidebar uses bare Workspace ids in the same map, so the
// prefix keeps the two apart.
func panePrefPrefix(scope string) string { return "pane:" + scope + ":" }

func (a *app) paneSavedExpansion() map[string]bool {
	prefix, saved := panePrefPrefix(a.paneScope()), map[string]bool{}
	for key, expanded := range a.uiPrefs.Expanded {
		if strings.HasPrefix(key, prefix) {
			if directory := strings.TrimPrefix(key, prefix); directory != "" {
				saved[directory] = expanded
			}
		}
	}
	return saved
}

// paneSaveExpansion writes one directory's state. Collapsing removes the entry
// so a tree that was browsed once does not grow the preference file forever.
func (a *app) paneSaveExpansion(directory string, expanded bool) {
	if directory == "" {
		return
	}
	if a.uiPrefs.Expanded == nil {
		a.uiPrefs.Expanded = map[string]bool{}
	}
	key := panePrefPrefix(a.paneScope()) + directory
	if expanded {
		a.uiPrefs.Expanded[key] = true
	} else {
		delete(a.uiPrefs.Expanded, key)
	}
	a.savePreferences()
}

func (a *app) setPaneExpanded(s *rightPaneState, directory string, expanded bool) {
	if s == nil {
		return
	}
	if directory == "" {
		s.Expanded[""] = true
		return
	}
	if s.Expanded[directory] == expanded {
		return
	}
	s.Expanded[directory] = expanded
	a.paneSaveExpansion(directory, expanded)
}

// paneRead owns read-only requests and checks the captured Host/Session before
// applying a reply. A late read cannot populate another Session's file panel.
func (a *app) paneRead(s *rightPaneState, method, key string, params map[string]any, accept func(json.RawMessage) error) {
	if a.demo || a.client == nil || !a.connected || s.SessionID == "" {
		s.Error = "请先连接主机并打开会话。"
		return
	}
	if s.Loading[key] {
		return
	}
	s.Loading[key] = true
	s.Error = ""
	params["sessionId"] = s.SessionID
	params["clientScope"] = map[string]any{"hostId": s.HostID, "generation": s.RemoteGeneration, "sessionId": s.SessionID}
	generation := s.Generation
	client := a.client
	go func() {
		ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
		defer cancel()
		raw, err := client.Call(ctx, method, params)
		a.update(func() {
			if a.rightPane != s || a.hostID != s.HostID || a.sessionID != s.SessionID || a.remoteGeneration != s.RemoteGeneration || a.client != client {
				return
			}
			delete(s.Loading, key)
			if strings.HasPrefix(key, "text:") && generation != s.Generation {
				return
			}
			if err != nil {
				s.Error = err.Error()
				return
			}
			if err := accept(raw); err != nil {
				s.Error = err.Error()
			}
		})
	}()
}

func (a *app) loadPaneDirectory(s *rightPaneState, directory string) {
	a.paneRead(s, "listFiles", "dir:"+directory, map[string]any{"path": directory}, func(raw json.RawMessage) error {
		var listing paneDirectory
		if err := json.Unmarshal(raw, &listing); err != nil {
			return err
		}
		if listing.Path != directory {
			return fmt.Errorf("目录响应与请求路径不一致，请刷新。")
		}
		sort.SliceStable(listing.Entries, func(i, j int) bool {
			x, y := listing.Entries[i], listing.Entries[j]
			if (x.Type == "directory") != (y.Type == "directory") {
				return x.Type == "directory"
			}
			return strings.ToLower(x.Name) < strings.ToLower(y.Name)
		})
		s.Directories[directory] = listing
		return nil
	})
}

func (a *app) loadPaneText(s *rightPaneState, filename string, offset int) {
	if offset < 1 {
		offset = 1
	}
	s.Selected = filename
	s.Tab = "document"
	s.Generation++
	generation := s.Generation
	a.paneRead(s, "readFile", fmt.Sprintf("text:%d", generation), map[string]any{"path": filename, "range": map[string]any{"offset": offset, "limit": 500}}, func(raw json.RawMessage) error {
		if generation != s.Generation || s.Selected != filename {
			return nil
		}
		var file paneTextFile
		if err := json.Unmarshal(raw, &file); err != nil {
			return err
		}
		if file.Offset != offset {
			return fmt.Errorf("文件页码与请求不一致，请刷新。")
		}
		if offset > 1 && s.TextReady && s.Text.Version != "" && file.Version != s.Text.Version {
			return fmt.Errorf("文件已变化，请从第一页重新载入。")
		}
		s.Text = file
		s.TextReady = true
		return nil
	})
}

func paneRows(s *rightPaneState, directory string, depth int) []paneTreeRow {
	if depth > 64 {
		return nil
	}
	var rows []paneTreeRow
	for _, entry := range s.Directories[directory].Entries {
		if entry.Name == "" || entry.Name == "." || entry.Name == ".." || strings.ContainsAny(entry.Name, "/\\") {
			continue
		}
		if !s.ShowHidden && strings.HasPrefix(entry.Name, ".") {
			continue
		}
		filename := path.Join(directory, entry.Name)
		if s.Filter != "" && !strings.Contains(strings.ToLower(filename), strings.ToLower(s.Filter)) && entry.Type != "directory" {
			continue
		}
		rows = append(rows, paneTreeRow{Path: filename, Name: entry.Name, Kind: entry.Type, Depth: depth})
		if entry.Type == "directory" && s.Expanded[filename] {
			rows = append(rows, paneRows(s, filename, depth+1)...)
		}
	}
	return rows
}

// paneParentDir is the directory a row lives in: "" is the workspace root.
func paneParentDir(filename string) string {
	parent := path.Dir(filename)
	if parent == "." || parent == "/" {
		return ""
	}
	return parent
}

type paneCrumb struct{ Name, Path string }

// paneCrumbs names the directories from the workspace root to current, so the
// files pane can show where it is instead of only the title.
func paneCrumbs(current string) []paneCrumb {
	crumbs := []paneCrumb{{Name: "工作区", Path: ""}}
	if current == "" {
		return crumbs
	}
	walked := ""
	for _, part := range strings.Split(strings.Trim(current, "/"), "/") {
		if part == "" || part == "." || part == ".." {
			continue
		}
		walked = path.Join(walked, part)
		crumbs = append(crumbs, paneCrumb{Name: part, Path: walked})
	}
	return crumbs
}

// paneTab is one discoverable right-pane entry. Enabled is what this launch
// can actually do: a disabled tab carries the Host's reason instead of
// pretending to be a button that does nothing.
type paneTab struct {
	ID, Title, Glyph, Reason string
	Enabled                  bool
}

func (a *app) paneCapReason(name, fallback string) string {
	if cap, ok := a.operationCaps[name]; ok && cap.Reason != "" {
		return cap.Reason
	}
	if fallback != "" {
		return fallback
	}
	return "当前连接未开放此操作"
}

func (a *app) paneTabs(s *rightPaneState) []paneTab {
	tabs := []paneTab{
		{ID: "start", Title: "开始", Glyph: "browse-outline", Enabled: true},
		{ID: "files", Title: "工作区文件", Glyph: "folder-open-outline", Enabled: a.can("listFiles"), Reason: a.paneCapReason("listFiles", "请先连接主机并打开会话")},
	}
	// A plan lives in the Session history this client already follows; a
	// Session with no history read has nothing to show.
	planReason := "请先打开会话"
	if s.SessionID != "" {
		planReason = "本会话已加载的历史中没有提交过的计划"
	}
	tabs = append(tabs, paneTab{ID: "plan", Title: "计划", Glyph: "plan-outline", Enabled: s.SessionID != "", Reason: planReason})
	// The document tab exists once a file is chosen, so a read in flight and a
	// later return to the preview both have a visible entry.
	if s.Selected != "" {
		tabs = append(tabs, paneTab{ID: "document", Title: path.Base(s.Selected), Glyph: "code-outline", Enabled: true})
	}
	return tabs
}

func (a *app) paneShowTab(s *rightPaneState, id string) {
	if s == nil || s.Tab == id {
		return
	}
	s.Tab = id
	if id == "files" && len(s.Directories) == 0 {
		a.loadPaneDirectory(s, s.CurrentDir)
	}
	if id == "plan" {
		a.refreshPanePlan(s)
	}
}

// refreshPanePlan reads the newest submitted plan out of the Session history
// this client already holds.
func (a *app) refreshPanePlan(s *rightPaneState) {
	if s == nil {
		return
	}
	s.Plan = panePlanFromMessages(a.current.Messages)
}

// panePlanFromMessages picks the newest `exit_plan_mode` call. The Host logs
// the plan as the call's `plan` argument, so the markdown is authentic rather
// than reconstructed copy.
func panePlanFromMessages(messages []message) panePlan {
	plan := panePlan{Checked: true}
	for i := len(messages) - 1; i >= 0; i-- {
		tool := messages[i].Tool
		if tool == nil || tool.Name != "exit_plan_mode" {
			continue
		}
		args := parseToolArgs(tool.ArgsRaw)
		markdown := stringArg(args, "plan")
		if strings.TrimSpace(markdown) == "" {
			continue
		}
		plan.Found = true
		plan.Markdown = markdown
		plan.CallID = tool.CallID
		plan.Seq = messages[i].Seq
		plan.Title = panePlanTitle(markdown)
		return plan
	}
	return plan
}

// panePlanTitle is the plan's own first heading, as the original review tab
// labels it; a plan without one is titled by its first non-empty line.
func panePlanTitle(markdown string) string {
	for _, line := range strings.Split(markdown, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "# ") {
			return strings.TrimSpace(strings.TrimPrefix(trimmed, "# "))
		}
		return trimmed
	}
	return ""
}

func (a *app) rightPaneView(c *ui.Context) {
	s := a.currentRightPane()
	ui.Column(c).Grow(1).MinHeight(0).MinWidth(0).Children(func() {
		a.paneHeader(c, s)
		if s.Error != "" {
			ui.Text(c, s.Error).Wrap().FontSize(12).TextColor(a.theme.Danger).Padding(8, 16)
		}
		switch s.Tab {
		case "files":
			a.paneFiles(c, s)
		case "document":
			a.paneDocument(c, s)
		case "plan":
			a.panePlanView(c, s)
		default:
			a.paneStart(c, s)
		}
	})
}

// paneHeader is the tab bar. Every entry states whether this launch can use it,
// so a click never lands on a control that cannot act.
func (a *app) paneHeader(c *ui.Context, s *rightPaneState) {
	ui.Row(c).Height(48).Shrink(0).Padding(10, 12).Gap(4).AlignItems(ui.Center).Children(func() {
		for _, tab := range a.paneTabs(s) {
			tab := tab
			active := s.Tab == tab.ID
			button := ui.ButtonBase(c.Key("pane-tab-"+tab.ID)).Height(28).Padding(0, 9).Radius(8).Gap(5).Label(tab.Title).Disabled(!tab.Enabled)
			if active {
				button.Background(a.settingsControlFill())
			} else if button.Hovered() && tab.Enabled {
				button.Background(a.colors.RowHover)
			}
			if !tab.Enabled {
				button.Tooltip(tab.Reason)
			} else if tab.ID == "plan" {
				button.Tooltip("查看本会话已提交的计划")
			}
			button.Children(func() {
				icon(c, tab.Glyph, 14).TextColor(a.theme.TextMuted)
				ui.Text(c, tab.Title).FontSize(13).Ellipsis("…")
			})
			if button.Clicked() && tab.Enabled {
				a.paneShowTab(s, tab.ID)
			}
		}
		ui.Spacer(c)
		if ui.ButtonBase(c).Size(24, 24).Label("收起右侧边栏").Children(func() { icon(c, "panel-left-outline", 16) }).Clicked() {
			a.rightPaneOpen = false
		}
	})
}

func (a *app) paneStart(c *ui.Context, s *rightPaneState) {
	ui.Column(c).Grow(1).Justify(ui.Center).Padding(28, 32).Gap(14).Children(func() {
		ui.Row(c).Justify(ui.Center).Padding(0, 0, 20).Children(func() { icon(c, "browse-outline", 44).TextColor(a.theme.TextMuted) })
		card := func(title, description, glyph, shortcut string, enabled bool, reason string, run func()) ui.Element {
			b := ui.ButtonBase(c.Key(title)).Height(68).Padding(14, 24).Radius(16).Border(1, a.theme.Border).Background(a.theme.Surface).Gap(18).Justify(ui.Start).Label(title).Disabled(!enabled)
			if !enabled && reason != "" {
				b.Tooltip(reason)
			}
			b.Children(func() {
				icon(c, glyph, 20).TextColor(a.theme.Accent)
				ui.Column(c).Grow(1).Gap(4).Children(func() {
					ui.Text(c, title).FontSize(14)
					if description != "" {
						ui.Text(c, description).FontSize(12).TextColor(a.theme.TextMuted).Wrap()
					}
				})
				if shortcut != "" {
					ui.Text(c, shortcut).FontSize(12).TextColor(a.theme.TextMuted)
				}
			})
			if b.Clicked() && run != nil && a.paneCurrent(s) {
				run()
			}
			return b
		}
		card("工作区文件", "浏览会话工作区的文件", "folder-open-outline", "", a.can("listFiles"), a.paneCapReason("listFiles", "请先连接主机并打开会话"), func() {
			s.Tab = "files"
			a.loadPaneDirectory(s, s.CurrentDir)
		})
		card("计划", "查看本会话已提交的计划", "plan-outline", "", s.SessionID != "", "请先打开会话", func() {
			a.paneShowTab(s, "plan")
		})
		card("新建终端", "打开会话终端", "code-outline", "", a.can("listTerminals"), a.paneCapReason("listTerminals", "请先连接主机并打开会话"), func() { a.openCompatAt("terminal", "right") })
		// The Browser card hosts the Remote web page; a launch that owns its Host
		// has no Remote server to browse.
		card("浏览器", "浏览网页", "globe-outline", "", !a.localMode(), "本地工作区没有可浏览的 Remote 网页", func() { a.openWeb() })
		more := card("更多工具", "选择工作区工具", "apps-add-outline", "", true, "", nil)
		more.Menu(func(m *ui.Menu) {
			current := a.paneCurrent(s)
			if m.Item("工作区文件").Disabled(!current || !a.can("listFiles")).Chosen() {
				s.Tab = "files"
				a.loadPaneDirectory(s, s.CurrentDir)
			}
			if m.Item("计划").Disabled(!current || s.SessionID == "").Chosen() {
				a.paneShowTab(s, "plan")
			}
			if m.Item("终端").Disabled(!current || !a.can("listTerminals")).Chosen() {
				a.openCompatAt("terminal", "right")
			}
			if m.Item("浏览器").Disabled(!current || a.localMode()).Chosen() {
				a.openWeb()
			}
		})
	})
}

// paneCurrent reports that a captured pane still belongs to the open Session,
// so a click queued before navigation cannot act on the new one.
func (a *app) paneCurrent(s *rightPaneState) bool {
	return s != nil && a.rightPane == s && s.HostID == a.hostID && s.SessionID == a.sessionID && s.RemoteGeneration == a.remoteGeneration
}

func (a *app) paneFiles(c *ui.Context, s *rightPaneState) {
	ui.Row(c).Shrink(0).Padding(8, 12).Gap(4).AlignItems(ui.Center).Children(func() {
		ui.Column(c).Grow(1).MinWidth(0).Children(func() {
			ui.Row(c).Gap(2).Wrap().AlignItems(ui.Center).Children(func() {
				for i, crumb := range paneCrumbs(s.CurrentDir) {
					crumb := crumb
					if i > 0 {
						ui.Text(c, "/").FontSize(12).TextColor(a.theme.TextMuted)
					}
					label := crumb.Name
					if i == len(paneCrumbs(s.CurrentDir))-1 {
						label = "当前位置 " + crumb.Name
					}
					b := ui.ButtonBase(c.Key("pane-crumb-"+crumb.Path)).Height(22).Padding(0, 4).Radius(4).Label(label)
					b.Disabled(!a.connected && i > 0)
					b.Children(func() { ui.Text(c, crumb.Name).FontSize(12).TextColor(a.theme.TextMuted) })
					if b.Clicked() && a.paneCurrent(s) {
						a.paneGoTo(s, crumb.Path)
					}
				}
			})
		})
		hidden := ui.ButtonBase(c).Size(24, 24).Label("隐藏文件")
		if s.ShowHidden {
			hidden.Background(a.settingsControlFill())
		}
		hidden.Tooltip(map[bool]string{true: "当前显示以点开头的文件，点击隐藏", false: "当前隐藏以点开头的文件，点击显示"}[s.ShowHidden])
		glyph := "eye-off-outline"
		if s.ShowHidden {
			glyph = "eye-outline"
		}
		hidden.Children(func() { icon(c, glyph, 14) })
		if hidden.Clicked() {
			s.ShowHidden = !s.ShowHidden
		}
		if ui.ButtonBase(c).Size(24, 24).Label("刷新文件树").Tooltip(a.paneCapReason("listFiles", "")).Disabled(!a.can("listFiles")).Children(func() { icon(c, "refresh-outline", 14) }).Clicked() {
			a.paneRefreshDirectories(s)
		}
	})
	ui.TextInput(c, &s.Filter).Shrink(0).Label("筛选已加载的文件名").Placeholder("筛选已加载的文件名").Margin(0, 12, 8)
	ui.Text(c, "仅筛选已加载目录；不包含主机的完整搜索与 Git 忽略规则。双击文件或按 Enter 打开。").Shrink(0).FontSize(11).TextColor(a.theme.TextMuted).Wrap().Padding(0, 12, 8)
	rows := paneRows(s, "", 0)
	s.TreeList.Key = func(i int) any { return rows[i].Path }
	s.TreeList.Label = func(i int) string { return rows[i].Name }
	s.TreeList.Selected = &s.TreeRow
	list := ui.List(c, &s.TreeList, len(rows), func(i int) {
		row := rows[i]
		line := ui.Row(c).FillWidth().Height(28).Padding(2, 8+float32(row.Depth)*14).Gap(6).AlignItems(ui.Center)
		if s.TreeRow == i {
			line.Background(a.colors.Selected)
		} else if line.Hovered() {
			line.Background(a.colors.RowHover)
		}
		line.Children(func() {
			if row.Kind == "directory" {
				glyph := "chevron-right-outline"
				if s.Expanded[row.Path] {
					glyph = "chevron-down-outline"
				}
				icon(c, glyph, 12)
				icon(c, "folder-open-outline", 15).TextColor(a.theme.Accent)
			} else {
				ui.Box(c).Width(12)
				icon(c, "code-outline", 14).TextColor(a.theme.TextMuted)
			}
			name := row.Name
			ui.Text(c, name).FontSize(13).Ellipsis("…")
			if s.Loading["dir:"+row.Path] {
				ui.Text(c, "…").FontSize(12)
			}
		})
	}).Grow(1).Shrink(1).MinHeight(0)
	if list.Changed() && s.TreeRow >= 0 && s.TreeRow < len(rows) && a.paneCurrent(s) {
		a.paneChooseRow(s, rows[s.TreeRow])
	}
	if list.Submitted() && s.TreeRow >= 0 && s.TreeRow < len(rows) && a.paneCurrent(s) {
		a.paneActivateRow(s, rows[s.TreeRow])
	}
	if s.Loading["dir:"+s.CurrentDir] {
		ui.Text(c, "正在加载目录…").FontSize(12).Padding(12, 16)
	} else if len(rows) == 0 {
		ui.Text(c, "此目录没有可见文件。").FontSize(12).TextColor(a.theme.TextMuted).Padding(12, 16)
	}
	for _, listing := range s.Directories {
		if listing.Truncated {
			ui.Text(c, "部分目录超过主机条目上限，当前列表不完整。").FontSize(11).TextColor(a.theme.TextMuted).Wrap().Padding(8, 16)
			break
		}
	}
}

// paneChooseRow follows the list's choice: a row names the directory the
// breadcrumb shows, without acting on the entry itself.
func (a *app) paneChooseRow(s *rightPaneState, row paneTreeRow) {
	if row.Kind == "directory" {
		s.CurrentDir = row.Path
		return
	}
	s.CurrentDir = paneParentDir(row.Path)
}

// paneActivateRow is the double click or Enter: a directory opens or closes, a
// file opens in the document tab.
func (a *app) paneActivateRow(s *rightPaneState, row paneTreeRow) {
	if row.Kind == "directory" {
		expanded := !s.Expanded[row.Path]
		a.setPaneExpanded(s, row.Path, expanded)
		s.CurrentDir = row.Path
		if expanded {
			if _, loaded := s.Directories[row.Path]; !loaded {
				a.loadPaneDirectory(s, row.Path)
			}
		}
		return
	}
	if !a.can("readFile") {
		s.Error = a.paneCapReason("readFile", "当前主机未开放工作区文件读取")
		return
	}
	s.TextReady = false
	a.loadPaneText(s, row.Path, 1)
}

// paneGoTo opens one breadcrumb segment: its ancestors stay open, so the tree
// shows the directory the breadcrumb names.
func (a *app) paneGoTo(s *rightPaneState, directory string) {
	s.CurrentDir = directory
	walked := ""
	for _, part := range strings.Split(strings.Trim(directory, "/"), "/") {
		if part == "" || part == "." || part == ".." {
			continue
		}
		walked = path.Join(walked, part)
		a.setPaneExpanded(s, walked, true)
		if _, loaded := s.Directories[walked]; !loaded {
			a.loadPaneDirectory(s, walked)
		}
	}
	if directory == "" {
		if _, loaded := s.Directories[""]; !loaded {
			a.loadPaneDirectory(s, "")
		}
	}
}

func (a *app) paneRefreshDirectories(s *rightPaneState) {
	for directory := range s.Directories {
		if s.Expanded[directory] || directory == "" || directory == s.CurrentDir {
			a.loadPaneDirectory(s, directory)
		}
	}
	if len(s.Directories) == 0 {
		a.loadPaneDirectory(s, s.CurrentDir)
	}
}

func (a *app) panePlanView(c *ui.Context, s *rightPaneState) {
	if !s.Plan.Checked {
		a.refreshPanePlan(s)
	}
	ui.Row(c).Shrink(0).Padding(8, 16).Gap(8).AlignItems(ui.Center).Children(func() {
		ui.Text(c, "计划").FontSize(14).Grow(1)
		if ui.ButtonBase(c).Size(24, 24).Label("重新读取计划").Tooltip("从已加载的会话历史重新读取").Children(func() { icon(c, "refresh-outline", 14) }).Clicked() {
			a.refreshPanePlan(s)
			s.Error = ""
		}
	})
	if !s.Plan.Found {
		ui.Column(c).Grow(1).Justify(ui.Center).Padding(24, 32).Gap(8).Children(func() {
			ui.Text(c, "本会话还没有提交过计划").FontSize(14).TextColor(a.theme.TextMuted)
			ui.Text(c, "计划由模型通过 exit_plan_mode 提交，读取自当前已加载的会话历史；评审仍在对话页进行。").FontSize(12).TextColor(a.theme.TextMuted).Wrap()
		})
		return
	}
	// The plan's own heading is inside the Markdown; the line above it names the
	// plan and where it came from instead of repeating that heading.
	provenance := fmt.Sprintf("来自会话历史 · 工具调用 %s · 序号 %d", s.Plan.CallID, s.Plan.Seq)
	if s.Plan.Title != "" {
		provenance = s.Plan.Title + " · " + provenance
	}
	ui.Text(c, provenance).Shrink(0).FontSize(11).TextColor(a.theme.TextMuted).Wrap().Selectable().Padding(4, 16, 8)
	ui.Scroll(c.Key(fmt.Sprintf("plan:%s:%s", s.SessionID, s.Plan.CallID))).Grow(1).Shrink(1).MinHeight(0).Clip().Children(func() {
		ui.Column(c).Grow(1).Padding(0, 16, 16).Children(func() {
			markdown.View(c.Key(fmt.Sprintf("plan-body:%s", s.Plan.CallID)), s.Plan.Markdown, &a.md)
		})
	})
}

func (a *app) paneDocument(c *ui.Context, s *rightPaneState) {
	ui.Row(c).Shrink(0).Padding(8, 16).Gap(8).Children(func() {
		if ui.Button(c, "文件").Clicked() {
			s.Tab = "files"
		}
		ui.Text(c, path.Base(s.Selected)).FontSize(13).Grow(1).Ellipsis("…")
		if ui.ButtonBase(c).Size(24, 24).Label("刷新文件").Disabled(!a.can("readFile")).Children(func() { icon(c, "refresh-outline", 14) }).Clicked() {
			s.TextReady = false
			a.loadPaneText(s, s.Selected, 1)
		}
	})
	if !s.TextReady {
		label := "正在读取文件…"
		if s.Error != "" {
			label = "无法预览此文件，可刷新后重试。"
		}
		ui.Text(c, label).FontSize(12).TextColor(a.theme.TextMuted).Padding(16)
		ui.Spacer(c).Grow(1)
		return
	}
	ui.Text(c, s.Text.AbsolutePath).Shrink(0).FontSize(11).TextColor(a.theme.TextMuted).Wrap().Selectable().Padding(0, 16, 8)
	ui.Scroll(c.Key(fmt.Sprintf("file:%s:%d", s.Selected, s.Text.Offset))).Grow(1).Shrink(1).MinHeight(0).Clip().Children(func() {
		font := "SF Mono, Menlo, monospace"
		if a.uiPrefs.CodeFontFamily != "" {
			font = a.uiPrefs.CodeFontFamily + ", " + font
		}
		weight := 300
		if a.uiPrefs.CodeFontFamily != "" {
			weight = 400
		}
		ui.Text(c, s.Text.Text).Font(font).FontWeight(weight).FontSize(a.uiPrefs.CodeFontSize).Wrap().Selectable().Padding(12, 16)
	})
	ui.Row(c).Shrink(0).Padding(10, 16).Gap(8).AlignItems(ui.Center).Children(func() {
		if ui.Button(c, "上一页").Disabled(s.Text.Offset <= 1 || !a.connected).Clicked() {
			a.loadPaneText(s, s.Selected, max(1, s.Text.Offset-500))
		}
		ui.Text(c, fmt.Sprintf("第 %d–%d 行", s.Text.Offset, max(s.Text.Offset, s.Text.Offset+s.Text.Lines-1))).FontSize(11).TextColor(a.theme.TextMuted).Grow(1)
		if ui.Button(c, "下一页").Disabled(s.Text.EOF || !a.connected).Clicked() {
			a.loadPaneText(s, s.Selected, s.Text.Offset+max(s.Text.Lines, 1))
		}
	})
}
