package main

import (
	"strings"
	"testing"

	"github.com/egoist/mygo/ui"
)

// paneRows is what the tree draws: hidden entries follow the toggle, the
// filter keeps directories so their matches stay reachable, and an expanded
// directory contributes its own rows with a deeper depth.
func TestPaneRowsFollowsHiddenFilterAndExpansion(t *testing.T) {
	s := &rightPaneState{
		Directories: map[string]paneDirectory{
			"": {Entries: []paneFileEntry{
				{Name: "src", Type: "directory"},
				{Name: ".env", Type: "file"},
				{Name: "README.md", Type: "file"},
			}},
			"src": {Entries: []paneFileEntry{{Name: "main.go", Type: "file"}}},
		},
		Expanded: map[string]bool{"": true},
	}
	names := func(rows []paneTreeRow) []string {
		out := make([]string, len(rows))
		for i, row := range rows {
			out[i] = row.Path
		}
		return out
	}
	if got := strings.Join(names(paneRows(s, "", 0)), ","); got != "src,README.md" {
		t.Fatalf("root rows with hidden entries off = %q", got)
	}
	s.ShowHidden = true
	if got := strings.Join(names(paneRows(s, "", 0)), ","); got != "src,.env,README.md" {
		t.Fatalf("root rows with hidden entries on = %q", got)
	}
	s.ShowHidden = false
	s.Expanded["src"] = true
	rows := paneRows(s, "", 0)
	if got := strings.Join(names(rows), ","); got != "src,src/main.go,README.md" {
		t.Fatalf("expanded rows = %q", got)
	}
	if rows[1].Depth != 1 {
		t.Fatalf("nested row depth = %d, want 1", rows[1].Depth)
	}
	s.Filter = "main"
	if got := strings.Join(names(paneRows(s, "", 0)), ","); got != "src,src/main.go" {
		t.Fatalf("filtered rows = %q: a directory must stay so its match is reachable", got)
	}
}

func TestPaneCrumbsWalkFromWorkspaceRoot(t *testing.T) {
	for _, tc := range []struct {
		current string
		names   []string
		paths   []string
	}{
		{"", []string{"工作区"}, []string{""}},
		{"src", []string{"工作区", "src"}, []string{"", "src"}},
		{"src/pane/ui/x", []string{"工作区", "src", "pane", "ui", "x"}, []string{"", "src", "src/pane", "src/pane/ui", "src/pane/ui/x"}},
		{"./src//pane/../", []string{"工作区", "src", "pane"}, []string{"", "src", "src/pane"}},
	} {
		crumbs := paneCrumbs(tc.current)
		var names, paths []string
		for _, crumb := range crumbs {
			names = append(names, crumb.Name)
			paths = append(paths, crumb.Path)
		}
		if got, want := strings.Join(names, "/"), strings.Join(tc.names, "/"); got != want {
			t.Fatalf("%q crumbs = %q, want %q", tc.current, got, want)
		}
		if got, want := strings.Join(paths, ","), strings.Join(tc.paths, ","); got != want {
			t.Fatalf("%q crumb paths = %q, want %q", tc.current, got, want)
		}
	}
	if got := paneParentDir("src/main.go"); got != "src" {
		t.Fatalf("parent of a nested file = %q", got)
	}
	if got := paneParentDir("README.md"); got != "" {
		t.Fatalf("parent of a root file = %q, want the workspace root", got)
	}
}

// Expansion is a user preference: it must survive navigating away and come
// back from the same file the sidebar uses.
func TestPaneExpansionPersistsInPreferences(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	a.workspaceID, a.sessionID, a.hostID = "ws-1", "session-1", "host-1"
	if a.uiPrefs.Expanded == nil {
		a.uiPrefs.Expanded = map[string]bool{}
	}
	s := &rightPaneState{Expanded: map[string]bool{"": true}}
	a.setPaneExpanded(s, "src/pane", true)
	key := "pane:workspace:ws-1:src/pane"
	if !a.uiPrefs.Expanded[key] {
		t.Fatalf("expanded directory was not recorded: %v", a.uiPrefs.Expanded)
	}
	a.rightPane = nil
	if reopened := a.currentRightPane(); !reopened.Expanded["src/pane"] || !reopened.Expanded[""] {
		t.Fatalf("reopened pane lost expansion: %v", reopened.Expanded)
	}
	a.setPaneExpanded(s, "src/pane", false)
	if a.uiPrefs.Expanded[key] {
		t.Fatalf("collapsing left the preference behind: %v", a.uiPrefs.Expanded)
	}
	// The sidebar's own keys use bare Workspace ids; the pane prefix must never
	// collide with them.
	if a.uiPrefs.Expanded["ws-1"] {
		t.Fatal("pane expansion wrote a sidebar key")
	}
}

func TestPanePlanReadsNewestSubmittedPlan(t *testing.T) {
	messages := []message{
		{ID: "tool:c1", Role: "tool", Kind: "tool", Seq: 4, Tool: &toolNode{CallID: "c1", Name: "exit_plan_mode", ArgsRaw: `{"plan":"# 旧计划\n\n- 旧步骤"}`}},
		{ID: "tool:c9", Role: "tool", Kind: "tool", Seq: 9, Tool: &toolNode{CallID: "c9", Name: "read_file", ArgsRaw: `{"path":"a.md"}`}},
		{ID: "tool:c2", Role: "tool", Kind: "tool", Seq: 12, Tool: &toolNode{CallID: "c2", Name: "exit_plan_mode", ArgsRaw: `{"plan":"# 迁移计划\n\n1. 备份现状\n2. 分批迁移"}`}},
	}
	plan := panePlanFromMessages(messages)
	if !plan.Found || !plan.Checked || plan.CallID != "c2" || plan.Seq != 12 {
		t.Fatalf("plan = %+v", plan)
	}
	if plan.Title != "迁移计划" {
		t.Fatalf("title = %q", plan.Title)
	}
	if !strings.Contains(plan.Markdown, "分批迁移") || strings.Contains(plan.Markdown, "旧步骤") {
		t.Fatalf("markdown = %q", plan.Markdown)
	}
	if empty := panePlanFromMessages(nil); empty.Found || !empty.Checked {
		t.Fatalf("empty history = %+v", empty)
	}
	malformed := panePlanFromMessages([]message{{Tool: &toolNode{Name: "exit_plan_mode", ArgsRaw: "{"}}})
	if malformed.Found {
		t.Fatal("malformed arguments produced a plan")
	}
	if title := panePlanTitle("\n\n没有标题的计划文本"); title != "没有标题的计划文本" {
		t.Fatalf("fallback title = %q", title)
	}
}

func tabByID(tabs []paneTab, id string) (paneTab, bool) {
	for _, tab := range tabs {
		if tab.ID == id {
			return tab, true
		}
	}
	return paneTab{}, false
}

func TestPaneTabsStateWhatTheLaunchCanDo(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	s := &rightPaneState{SessionID: "session-1"}
	tabs := map[string]paneTab{}
	for _, tab := range a.paneTabs(s) {
		tabs[tab.ID] = tab
	}
	files, ok := tabs["files"]
	if !ok {
		t.Fatal("files tab is missing")
	}
	if files.Enabled != a.can("listFiles") {
		t.Fatalf("files tab enabled=%v, capability=%v", files.Enabled, a.can("listFiles"))
	}
	if !files.Enabled && files.Reason == "" {
		t.Fatal("a disabled tab must state why")
	}
	plan, ok := tabs["plan"]
	if !ok || !plan.Enabled {
		t.Fatalf("an open Session must offer the plan tab: %+v", plan)
	}
	if _, ok := tabs["document"]; ok {
		t.Fatal("no document tab before a file is open")
	}
	// A read in flight already has its tab, so the pane never shows a document
	// without a way back to it.
	s.Selected = "README.md"
	if tab, found := tabByID(a.paneTabs(s), "document"); !found || !tab.Enabled {
		t.Fatalf("document tab while loading = %+v", tab)
	}
	s.TextReady, s.Selected = true, "src/main.go"
	withDocument := map[string]paneTab{}
	for _, tab := range a.paneTabs(s) {
		withDocument[tab.ID] = tab
	}
	if doc, ok := withDocument["document"]; !ok || doc.Title != "main.go" {
		t.Fatalf("document tab = %+v", doc)
	}
}

func TestPanePlanViewShowsSubmittedMarkdownAndEmptyState(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	s := &rightPaneState{HostID: a.hostID, SessionID: "session-1", Tab: "plan"}
	a.current.Messages = []message{{ID: "tool:c1", Role: "tool", Kind: "tool", Seq: 3, Tool: &toolNode{CallID: "c1", Name: "exit_plan_mode", ArgsRaw: `{"plan":"# 发布计划\n\n先跑回归测试"}`}}}
	a.refreshPanePlan(s)
	if !s.Plan.Found || s.Plan.Title != "发布计划" {
		t.Fatalf("plan = %+v", s.Plan)
	}
	tt := ui.NewTester(func(c *ui.Context) { a.applyAppearance(c); a.panePlanView(c, s) }, 420, 720)
	tt.Frame()
	for _, want := range []string{"发布计划", "先跑回归测试", "会话历史", "c1"} {
		if !tt.HasText(want) {
			t.Fatalf("plan pane missing %q: %v", want, tt.Texts())
		}
	}
	// A plan is read from the loaded history, so an empty history is what an
	// unplanned Session actually shows.
	a.current.Messages = nil
	empty := &rightPaneState{HostID: a.hostID, SessionID: "session-2", Tab: "plan"}
	ttEmpty := ui.NewTester(func(c *ui.Context) { a.applyAppearance(c); a.panePlanView(c, empty) }, 420, 720)
	ttEmpty.Frame()
	if !ttEmpty.HasText("本会话还没有提交过计划") {
		t.Fatalf("plan pane empty state: %v", ttEmpty.Texts())
	}
}

// The tree chooses on a click and opens on a double click, as the original
// file navigator does: a single click must not swap the pane to a new file.
func TestPaneFilesChoosesThenOpensOnDoubleClick(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	a.hostID, a.sessionID = "host-1", "session-1"
	// The activation path checks the Host's file-read grant before it opens a
	// document; the fixture proves the click wiring, not the grant.
	a.connected = true
	a.operationCaps = map[string]operationCapability{
		"readFile":  {Supported: true},
		"listFiles": {Supported: true},
	}
	s := &rightPaneState{
		HostID: "host-1", SessionID: "session-1", Tab: "files", TreeRow: -1,
		Directories: map[string]paneDirectory{"": {Entries: []paneFileEntry{
			{Name: "src", Type: "directory"},
			{Name: "README.md", Type: "file"},
		}}},
		Expanded: map[string]bool{"": true},
		Loading:  map[string]bool{},
	}
	a.rightPane = s
	tt := ui.NewTester(func(c *ui.Context) { a.applyAppearance(c); a.paneFiles(c, s) }, 380, 720)
	tt.Frame()
	row, found := tt.Find("README.md")
	if !found {
		t.Fatalf("file row not drawn: %v", tt.Texts())
	}
	tt.Advance(2000000000)
	if err := tt.Click("README.md"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if s.Tab != "files" || s.Selected != "" {
		t.Fatalf("a single click opened the file: tab=%q selected=%q", s.Tab, s.Selected)
	}
	if s.CurrentDir != "" {
		t.Fatalf("choosing a root file moved the breadcrumb to %q", s.CurrentDir)
	}
	// A fresh press sequence: the earlier click must not count as the first
	// half of this double click.
	tt.Advance(1000000000)
	tt.ClickAt(row.X+4, row.Y+4)
	tt.ClickAt(row.X+4, row.Y+4)
	tt.Frame()
	if s.Tab != "document" || s.Selected != "README.md" {
		t.Fatalf("double click did not open the file: tab=%q selected=%q", s.Tab, s.Selected)
	}
	// A directory toggles its expansion and the preference remembers it.
	a.workspaceID = "ws-1"
	directory, found := tt.Find("src")
	if !found {
		t.Fatalf("directory row not drawn: %v", tt.Texts())
	}
	s.Tab = "files"
	tt.ClickAt(directory.X+4, directory.Y+4)
	tt.ClickAt(directory.X+4, directory.Y+4)
	tt.Frame()
	if !s.Expanded["src"] {
		t.Fatal("double click did not expand the directory")
	}
	if !a.uiPrefs.Expanded["pane:workspace:ws-1:src"] {
		t.Fatalf("expansion was not persisted: %v", a.uiPrefs.Expanded)
	}
	if s.CurrentDir != "src" {
		t.Fatalf("breadcrumb did not follow the opened directory: %q", s.CurrentDir)
	}
}
