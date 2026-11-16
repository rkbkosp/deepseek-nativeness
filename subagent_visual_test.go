package main

import (
	"image/png"
	"os"
	"testing"

	"github.com/egoist/mygo/ui"
)

// TestPresetAndSubagentVisualCapture writes the new-session preset seat, the
// session-header subagent catalog, the child breadcrumb and the subagent tool
// card. Skipped unless DSH_CAPTURE=1, like the other local capture tests.
func TestPresetAndSubagentVisualCapture(t *testing.T) {
	if os.Getenv("DSH_CAPTURE") == "" {
		t.Skip("set DSH_CAPTURE=1 to write local baseline PNGs")
	}
	capture := func(tt *ui.Tester, name string) {
		t.Helper()
		file, err := os.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if err := png.Encode(file, tt.Image()); err != nil {
			t.Fatal(err)
		}
		_ = file.Close()
	}

	hero := heroPresetApp(t)
	hero.workspaces = []workspace{{ID: "w1", Name: "项目甲", Path: "/tmp/w1"}}
	ht := ui.NewTester(hero.view, 1280, 820)
	ht.Frame()
	capture(ht, "/tmp/native-hero-preset.png")
	if err := ht.Click("标准模式"); err != nil {
		t.Fatal(err)
	}
	capture(ht, "/tmp/native-hero-preset-open.png")
	ht.CloseMenu()
	hero.effectiveDark = true
	hero.appearanceSignature = ""
	ht.SetDark(true)
	ht.Frame()
	capture(ht, "/tmp/native-hero-preset-dark.png")
	hero.effectiveDark = false
	hero.appearanceSignature = ""
	ht.SetDark(false)
	ht.SetSize(720, 820)
	ht.Frame()
	capture(ht, "/tmp/native-hero-preset-narrow.png")
	ht.SetSize(1280, 820)
	ht.Frame()

	header := newApp(true)
	t.Cleanup(header.cancel)
	header.sessionID = "s"
	header.sidebar = false
	preset := "ptc"
	header.composer = &composerState{sessionID: "s", values: composerProjectionValues{
		AgentPreset: &preset,
		SubagentCatalog: []subagentEntry{
			{ID: "child", Label: "reviewer", Mode: "continuable", CreatedAt: 1700000000000},
			{ID: "idle", Label: "explorer", Mode: "one-shot", CreatedAt: 1700000000000},
		},
	}}
	header.current = snapshot{SessionID: "s", Messages: []message{{ID: "u", Role: "user", Text: "开始", Turn: 1}}}
	st := ui.NewTester(header.view, 1280, 820)
	st.Frame()
	capture(st, "/tmp/native-header-subagents.png")
	if err := st.Click("2 个子智能体"); err != nil {
		t.Fatal(err)
	}
	capture(st, "/tmp/native-header-subagents-open.png")

	child := newApp(true)
	t.Cleanup(child.cancel)
	child.sidebar = false
	child.sessions = []session{
		{ID: "parent", Title: "母会话"},
		{ID: "child", Title: "reviewer", ParentSessionID: "parent", Origin: "subagent"},
	}
	child.sessionID = "child"
	child.current = snapshot{SessionID: "child", Messages: []message{{ID: "u", Role: "user", Text: "开始", Turn: 1}}}
	child.composer = &composerState{sessionID: "child", values: composerProjectionValues{
		SubagentCatalog: []subagentEntry{{ID: "grand", Label: "checker", Mode: "continuable"}},
	}}
	ct := ui.NewTester(child.view, 1280, 820)
	ct.Frame()
	capture(ct, "/tmp/native-header-child-breadcrumb.png")

	card := newApp(true)
	t.Cleanup(card.cancel)
	card.uiPrefs.StepsDetail = "verbose"
	card.current = snapshot{SessionID: card.sessionID, Messages: []message{
		{ID: "u", Role: "user", Text: "派一个子代理", Turn: 1},
		{ID: "call", Role: "tool", Kind: "tool", Turn: 1, Text: "started subagent child-1", Tool: &toolNode{
			Name: "subagent", Phase: "settled",
			ArgsRaw: `{"description":"审阅会话页","prompt":"检查会话页的间距、气泡底色与折叠行，并给出具体行号。"}`,
			Meta:    []byte(`{"kind":"activation","name":"reviewer","subagentId":"child-1"}`),
		}},
	}}
	tt := ui.NewTester(card.view, 1280, 820)
	tt.Frame()
	if err := tt.Click("子智能体"); err != nil {
		t.Fatal(err)
	}
	capture(tt, "/tmp/native-subagent-card.png")
}
