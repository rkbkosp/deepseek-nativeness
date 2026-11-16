package main

import (
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
)

// A catalog row reports the child's live state first, then how it is addressed,
// so "1 个子智能体" opens on facts instead of bare names.
func TestSubagentRowSubtitleReportsActivityAndMode(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sessions = []session{{ID: "running", Running: true}, {ID: "idle"}}
	now := time.Now()
	running := subagentEntry{ID: "running", Label: "worker", Mode: "continuable", CreatedAt: float64(now.Add(-75 * time.Second).UnixMilli())}
	subtitle := a.subagentRowSubtitle(running, now)
	for _, want := range []string{"正在运行", "1分", "可继续"} {
		if !strings.Contains(subtitle, want) {
			t.Fatalf("running row subtitle %q lacks %q", subtitle, want)
		}
	}
	idle := subagentEntry{ID: "idle", Mode: "one-shot", CreatedAt: float64(now.UnixMilli())}
	if got := a.subagentRowSubtitle(idle, now); got != "未运行 · 一次性" {
		t.Fatalf("idle row subtitle = %q", got)
	}
	if mode := subagentModeLabel("external"); mode != "外部任务" {
		t.Fatalf("external mode label = %q", mode)
	}
}

// The count opens the catalog and a row moves the main view into the child
// Session, remembering the label it was listed under.
func TestSubagentCountMenuOpensAChildSession(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sessionID = "s"
	a.sidebar = false
	a.composer = &composerState{sessionID: "s", values: composerProjectionValues{
		SubagentCatalog: []subagentEntry{{ID: "child", Label: "worker", Mode: "continuable", CreatedAt: 1700000000000}},
	}}
	a.current = snapshot{SessionID: "s", Messages: []message{{ID: "u", Role: "user", Text: "go", Turn: 1}}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("1 个子智能体") {
		t.Fatalf("the header does not count the children: %v", tt.Texts())
	}
	if err := tt.Click("1 个子智能体"); err != nil {
		t.Fatalf("open the subagent catalog: %v", err)
	}
	labels := tt.Menu()
	if len(labels) != 1 || labels[0] != "worker" {
		t.Fatalf("catalog menu = %v", labels)
	}
	if err := tt.ChooseMenuItem("worker"); err != nil {
		t.Fatalf("open the child: %v", err)
	}
	if a.sessionID != "child" {
		t.Fatalf("the child Session was not opened: %q", a.sessionID)
	}
	if a.subagentTitles["child"] != "worker" {
		t.Fatalf("the child label was not remembered: %v", a.subagentTitles)
	}
}

// A child Session replaces the plain title with the parent breadcrumb, and its
// own descendants move into that lineage slot instead of the actions band.
func TestChildSessionHeaderShowsTheParentBreadcrumb(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sidebar = false
	a.sessions = []session{
		{ID: "parent", Title: "母会话"},
		{ID: "child", Title: "worker", ParentSessionID: "parent", Origin: "subagent"},
	}
	a.sessionID = "child"
	a.current = snapshot{SessionID: "child", Messages: []message{{ID: "u", Role: "user", Text: "go", Turn: 1}}}
	a.composer = &composerState{sessionID: "child", values: composerProjectionValues{}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("父会话") || !tt.HasText("母会话") {
		t.Fatalf("the breadcrumb is missing: %v", tt.Texts())
	}
	if parent, child := a.sessionParent("child"); !child || parent != "parent" {
		t.Fatalf("sessionParent(child) = %q / %v", parent, child)
	}
	if _, child := a.sessionParent("parent"); child {
		t.Fatal("a root Session reported a parent")
	}
	if got := a.sessionTitle("child"); got != "worker" {
		t.Fatalf("child title = %q", got)
	}
}

// A child's own catalog stays in the lineage slot: the actions band must not
// draw the same count twice.
func TestChildSessionCountStaysInTheLineage(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sidebar = false
	a.sessions = []session{{ID: "parent", Title: "母会话"}, {ID: "child", Title: "worker", ParentSessionID: "parent"}}
	a.sessionID = "child"
	a.current = snapshot{SessionID: "child", Messages: []message{{ID: "u", Role: "user", Text: "go", Turn: 1}}}
	a.composer = &composerState{sessionID: "child", values: composerProjectionValues{
		SubagentCatalog: []subagentEntry{{ID: "grand", Label: "checker", Mode: "continuable"}},
	}}
	if a.headerSubagentVisible() {
		t.Fatal("a child Session kept the actions-band count")
	}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("1 个子智能体") {
		t.Fatalf("the lineage slot did not draw the child's own count: %v", tt.Texts())
	}
}
