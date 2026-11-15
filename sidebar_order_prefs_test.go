package main

// The sidebar view has two persisted toggles, grouping (by workspace, as a
// tree, or as one flat list) and order (a manual snapshot, or most recently
// updated), and the search field owns a small keyboard path. These tests read
// the rows each matrix cell builds, the preference file a restart reads back,
// and the key transitions, so the toggles and the keys stay wired.

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/egoist/mygo/ui"
)

// sidebarMatrixApp is one catalog with a nested workspace, a pinned session
// and two recencies, so every matrix cell differs from its neighbours.
func sidebarMatrixApp() *app {
	return &app{
		hostID:  "h",
		uiPrefs: defaultViewPreferences(),
		workspaces: []workspace{
			{ID: "w1", Name: "项目", Path: "/proj"},
			{ID: "w2", Name: "子项目", Path: "/proj/sub"},
		},
		sessions: []session{
			{ID: "s-old", Title: "旧会话", WorkspaceID: "w1", UpdatedAt: 100},
			{ID: "s-new", Title: "新会话", WorkspaceID: "w1", UpdatedAt: 300},
			{ID: "s-pin", Title: "置顶会话", WorkspaceID: "w2", UpdatedAt: 50, Pinned: true},
		},
		watermarks: map[string]int{},
	}
}

func sidebarRowKeys(a *app) []string {
	var keys []string
	for _, r := range a.sidebarRows() {
		keys = append(keys, r.Key)
	}
	return keys
}

func TestSidebarOrderMatrixKeepsItsSemanticsAcrossBothToggles(t *testing.T) {
	a := sidebarMatrixApp()
	for _, tc := range []struct {
		name    string
		groupBy string
		orderBy string
		want    []string
	}{
		{
			name:    "workspace grouping, most recently updated",
			groupBy: "workspace",
			orderBy: "updated",
			want:    []string{"w:w1", "s:s-new", "s:s-old", "w:w2", "s:s-pin"},
		},
		{
			name:    "flat list, most recently updated",
			groupBy: "flat",
			orderBy: "updated",
			want:    []string{"s:s-pin", "s:s-new", "s:s-old"},
		},
		{
			name:    "workspace grouping, manual snapshot",
			groupBy: "workspace",
			orderBy: "manual",
			want:    []string{"w:w1", "s:s-new", "s:s-old", "w:w2", "s:s-pin"},
		},
		{
			name:    "flat list, manual snapshot",
			groupBy: "flat",
			orderBy: "manual",
			want:    []string{"s:s-pin", "s:s-new", "s:s-old"},
		},
	} {
		a.uiPrefs.GroupBy = tc.groupBy
		a.setSidebarOrder(tc.orderBy)
		// A turn that finishes while the manual snapshot is on must not
		// reorder it.
		if tc.orderBy == "manual" {
			a.sessions[0].UpdatedAt = 900
		}
		if got := sidebarRowKeys(a); !slices.Equal(got, tc.want) {
			t.Fatalf("%s: %v, want %v", tc.name, got, tc.want)
		}
		a.sessions[0].UpdatedAt = 100
	}
	// Back to recency: the turn that finished while manual was on now counts,
	// and the manual snapshot this Host froze is discarded.
	a.sessions[0].UpdatedAt = 900
	a.uiPrefs.GroupBy = "workspace"
	a.setSidebarOrder("updated")
	if got, want := sidebarRowKeys(a), []string{"w:w1", "s:s-old", "s:s-new", "w:w2", "s:s-pin"}; !slices.Equal(got, want) {
		t.Fatalf("recency after manual: %v, want %v", got, want)
	}
	a.uiPrefs.GroupBy = "flat"
	if got, want := sidebarRowKeys(a), []string{"s:s-pin", "s:s-old", "s:s-new"}; !slices.Equal(got, want) {
		t.Fatalf("flat recency after manual: %v, want %v", got, want)
	}
	for key := range a.uiPrefs.ManualOrder {
		if strings.HasPrefix(key, a.viewKey("sidebar:")) {
			t.Fatalf("recency kept the manual snapshot %q", key)
		}
	}
}

func TestSidebarTreeGroupingOnlyIndentsNestedWorkspaces(t *testing.T) {
	a := sidebarMatrixApp()
	depth := func() map[string]int {
		out := map[string]int{}
		for _, r := range a.sidebarRows() {
			out[r.Key] = r.Depth
		}
		return out
	}
	a.uiPrefs.GroupBy = "tree"
	tree := depth()
	if tree["w:w1"] != 0 || tree["w:w2"] != 1 || tree["s:s-pin"] != 1 {
		t.Fatalf("tree depths %v", tree)
	}
	a.uiPrefs.GroupBy = "workspace"
	grouped := depth()
	if grouped["w:w1"] != 0 || grouped["w:w2"] != 0 || grouped["s:s-pin"] != 0 {
		t.Fatalf("workspace depths %v", grouped)
	}
}

func TestSidebarViewPreferencesSurviveRestart(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "preferences.json")

	first := sidebarMatrixApp()
	first.setSidebarOrder("manual")
	first.uiPrefs.GroupBy = "tree"
	// A snapshot taken before a turn finishes is what the next run must show.
	first.sessions[1].UpdatedAt = 10
	first.savePreferencesTo(path)

	restored := sidebarMatrixApp()
	restored.uiPrefs = defaultViewPreferences()
	restored.loadPreferencesFrom(path)
	if restored.sidebarGroupMode() != "tree" || restored.sidebarOrderMode() != "manual" {
		t.Fatalf("restored %q/%q", restored.sidebarGroupMode(), restored.sidebarOrderMode())
	}
	if got, want := sidebarRowKeys(restored), sidebarRowKeys(first); !slices.Equal(got, want) {
		t.Fatalf("restored rows %v, want %v", got, want)
	}
	// The view state is not inherited by another Host, and switching back to
	// recency drops this Host's snapshot.
	restored.setSidebarOrder("updated")
	if _, ok := restored.uiPrefs.ManualOrder[restored.viewKey("sidebar:w1")]; ok {
		t.Fatal("recency kept a frozen workspace order")
	}
}

// viewControlApp is a demo app with a controlled catalog: every preference
// path is a no-op for it, so a test that drives the real control never touches
// the user's preference directory.
func viewControlApp(t *testing.T) (*app, *ui.Tester) {
	t.Helper()
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.testDispatch = func(fn func()) { fn() }
	a.sessions = []session{
		{ID: "alpha", Title: "Alpha 计划", WorkspaceID: "w", UpdatedAt: 300},
		{ID: "beta", Title: "Beta 计划", WorkspaceID: "w", UpdatedAt: 200},
		{ID: "gamma", Title: "Gamma 其他", WorkspaceID: "w", UpdatedAt: 100},
	}
	a.workspaces = []workspace{{ID: "w", Name: "工作区"}}
	a.sessionID = ""
	return a, ui.NewTester(a.view, 1280, 820)
}

func chooseViewMenuItem(t *testing.T, tt *ui.Tester, label string) {
	t.Helper()
	if err := tt.Click("视图选项"); err != nil {
		t.Fatal(err)
	}
	if labels := tt.Menu(); !slices.Contains(labels, label) {
		t.Fatalf("view menu has %v, not %q", labels, label)
	}
	if err := tt.ChooseMenuItem(label); err != nil {
		t.Fatal(err)
	}
}

func TestSidebarViewControlWritesBothTogglesAndPersistsThem(t *testing.T) {
	a, tt := viewControlApp(t)

	chooseViewMenuItem(t, tt, "手动排序")
	if a.uiPrefs.OrderBy != "manual" || len(a.uiPrefs.ManualOrder) == 0 {
		t.Fatalf("manual toggle did not freeze its snapshot: %q %v", a.uiPrefs.OrderBy, a.uiPrefs.ManualOrder)
	}
	chooseViewMenuItem(t, tt, "单列表")
	if a.uiPrefs.GroupBy != "flat" {
		t.Fatalf("grouping toggle stored %q", a.uiPrefs.GroupBy)
	}
	if got := a.sidebarViewTooltip(); !strings.Contains(got, "单列表") || !strings.Contains(got, "手动排序") {
		t.Fatalf("title row names another view: %q", got)
	}

	// The modes the controls stored are the modes a restart reads back. Demo
	// apps never write preferences, so the round trip goes through a temp
	// file with a non-demo app, as the preference tests do.
	path := filepath.Join(t.TempDir(), "preferences.json")
	stored := &app{hostID: "h", uiPrefs: a.uiPrefs}
	stored.savePreferencesTo(path)
	restored := &app{hostID: "h", uiPrefs: defaultViewPreferences()}
	restored.loadPreferencesFrom(path)
	if restored.sidebarGroupMode() != "flat" || restored.sidebarOrderMode() != "manual" {
		t.Fatalf("restored %q/%q", restored.sidebarGroupMode(), restored.sidebarOrderMode())
	}
	if stored, err := os.ReadFile(path); err != nil {
		t.Fatal(err)
	} else if !strings.Contains(string(stored), `"orderBy": "manual"`) || !strings.Contains(string(stored), `"groupBy": "flat"`) {
		t.Fatalf("preferences file lacks the two modes: %s", stored)
	}

	chooseViewMenuItem(t, tt, "最近更新")
	if a.uiPrefs.OrderBy != "updated" {
		t.Fatalf("recency toggle stored %q", a.uiPrefs.OrderBy)
	}
	chooseViewMenuItem(t, tt, "按工作区树")
	if a.uiPrefs.GroupBy != "tree" || !strings.Contains(a.sidebarViewTooltip(), "按工作区树") {
		t.Fatalf("tree toggle: %q %q", a.uiPrefs.GroupBy, a.sidebarViewTooltip())
	}
	if a.sidebarViewIcon() != "branch-outline" {
		t.Fatalf("tree view shows icon %q", a.sidebarViewIcon())
	}
}

func TestSearchKeyboardMovesOpensClearsAndShowsEmptyState(t *testing.T) {
	a, tt := viewControlApp(t)

	// ⌘K opens the field with the focus, and asking for it again closes it.
	tt.Key(ui.Cmd, ui.KeyK)
	if !a.searchOpen {
		t.Fatal("⌘K did not open the search")
	}
	if !tt.Focused("搜索会话输入框") {
		t.Fatal("the search field does not hold the focus")
	}
	tt.Type("计划")
	if a.search != "计划" {
		t.Fatalf("typed into the search: %q", a.search)
	}
	// The workspace header is row 0, so the first hit is row 1.
	if a.searchPick != "alpha" || a.searchRow != 1 {
		t.Fatalf("initial choice %q at %d", a.searchPick, a.searchRow)
	}
	tt.Key(0, ui.KeyDown)
	if a.searchPick != "beta" || a.searchRow != 2 {
		t.Fatalf("Down moved to %q at %d", a.searchPick, a.searchRow)
	}
	tt.Key(0, ui.KeyDown)
	if a.searchPick != "beta" {
		t.Fatalf("Down at the last hit moved to %q", a.searchPick)
	}
	tt.Key(0, ui.KeyUp)
	tt.Key(0, ui.KeyUp)
	if a.searchPick != "alpha" || a.searchRow != 1 {
		t.Fatalf("Up beyond the first hit moved to %q at %d", a.searchPick, a.searchRow)
	}

	// Enter opens the choice and closes the search.
	tt.Key(0, ui.KeyEnter)
	if a.searchOpen || a.search != "" || a.searchPick != "" || a.searchRow != -1 {
		t.Fatalf("Enter left the search open: %v %q %q %d", a.searchOpen, a.search, a.searchPick, a.searchRow)
	}
	if a.sessionID != "alpha" {
		t.Fatalf("Enter opened %q", a.sessionID)
	}
	if a.sessionList.Selected != nil {
		t.Fatal("the closed search left the list choosing rows")
	}

	// Esc closes the search and clears the query without opening anything.
	tt.Key(ui.Cmd, ui.KeyK)
	tt.Type("Gamma")
	if a.searchPick != "gamma" {
		t.Fatalf("one hit chose %q", a.searchPick)
	}
	tt.Key(0, ui.KeyEscape)
	if a.searchOpen || a.search != "" || a.searchPick != "" || a.searchRow != -1 {
		t.Fatalf("Esc left the search open: %v %q %q %d", a.searchOpen, a.search, a.searchPick, a.searchRow)
	}
	if a.sessionID != "alpha" {
		t.Fatalf("Esc navigated to %q", a.sessionID)
	}

	// No hits says so, and Enter has nothing to open.
	tt.Key(ui.Cmd, ui.KeyK)
	tt.Type("zzz")
	if a.searchRow != -1 || a.searchPick != "" {
		t.Fatalf("no hits chose %q at %d", a.searchPick, a.searchRow)
	}
	if !tt.HasText("没有匹配的会话") {
		t.Fatalf("no empty state; texts %v", tt.Texts())
	}
	tt.Key(0, ui.KeyEnter)
	if !a.searchOpen || a.sessionID != "alpha" {
		t.Fatalf("Enter without a hit changed the view: %v %q", a.searchOpen, a.sessionID)
	}
	// Esc closes the empty search, and reopening it asks again.
	tt.Key(0, ui.KeyEscape)
	tt.Key(ui.Cmd, ui.KeyK)
	tt.Type("计划")
	if a.searchPick != "alpha" || a.searchRow != 1 {
		t.Fatalf("typing back to a hit chose %q at %d", a.searchPick, a.searchRow)
	}
}

func TestSearchKeyboardChoiceFollowsTheHitsAcrossQueries(t *testing.T) {
	a, tt := viewControlApp(t)
	tt.Key(ui.Cmd, ui.KeyK)
	tt.Type("计划")
	tt.Key(0, ui.KeyDown)
	if a.searchPick != "beta" {
		t.Fatalf("query chose %q", a.searchPick)
	}
	// A query that filters the choice away clears it instead of pointing at a
	// row that is no longer there.
	tt.Type("x")
	if a.searchPick != "" || a.searchRow != -1 {
		t.Fatalf("no hit chose %q at %d", a.searchPick, a.searchRow)
	}
	if !tt.HasText("没有匹配的会话") {
		t.Fatalf("no empty state; texts %v", tt.Texts())
	}
	// The next search starts clean: its first hit is chosen, and the row is the
	// list row behind the workspace header, not the hit number.
	tt.Key(0, ui.KeyEscape)
	tt.Key(ui.Cmd, ui.KeyK)
	tt.Type("Beta")
	if a.searchPick != "beta" || a.searchRow != 1 {
		t.Fatalf("narrow query chose %q at %d", a.searchPick, a.searchRow)
	}
	tt.Key(0, ui.KeyEscape)
	tt.Key(ui.Cmd, ui.KeyK)
	tt.Type("计划")
	if a.searchPick != "alpha" || a.searchRow != 1 {
		t.Fatalf("renewed hits chose %q at %d", a.searchPick, a.searchRow)
	}
}
