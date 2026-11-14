package main

import (
	"github.com/egoist/mygo/ui"
	"strings"
	"testing"
)

func TestHeaderPresetUsesRecordedValueAndRosterMetadata(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	a.composer = &composerState{hostID: a.hostID, sessionID: a.sessionID, accountScope: a.accountScope, generation: a.remoteGeneration}
	if _, _, ok := a.headerPresetText(); ok {
		t.Fatal("undefined projection invented a default")
	}
	id := "standard"
	a.composer.values.AgentPreset = &id
	if name, hint, ok := a.headerPresetText(); !ok || name != "standard" || hint != presetHeaderHint {
		t.Fatal(name, hint, ok)
	}
	desc := "ignored shipped metadata"
	a.composer.presets = []composerPreset{{ID: id, Description: &desc}}
	if name, hint, _ := a.headerPresetText(); name != "标准模式" || hint != presetHeaderBuiltins[id][1] {
		t.Fatal(name, hint)
	}
	name := "用户命名"
	a.composer.presets[0].Name = &name
	if got, hint, _ := a.headerPresetText(); got != name || hint != desc {
		t.Fatal(got, hint)
	}
	a.accountScope = "new-account"
	if _, _, ok := a.headerPresetText(); ok {
		t.Fatal("stale roster leaked across account")
	}
}
func TestHeaderPresetIsTitleAdjacentReadonlyAndHiddenInNarrowColumn(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	id := "standard"
	a.composer = &composerState{hostID: a.hostID, sessionID: a.sessionID, accountScope: a.accountScope, generation: a.remoteGeneration, values: composerProjectionValues{AgentPreset: &id}, presets: []composerPreset{{ID: id}}}
	a.sessions[0].Title = "短标题"
	a.sessionID = a.sessions[0].ID
	a.composer.sessionID = a.sessionID
	tt := ui.NewTester(a.view, 1280, 820)
	r := composerUnclippedRects(t, tt)
	title, chip := r["会话标题"], r["任务模式"]
	if chip.W <= 14 || chip.W > 180 || chip.H != 22 || abs(chip.X-title.X-title.W-8) > .1 {
		t.Fatalf("not title adjacent: title%+v label%+v", title, chip)
	}
	a.sessions[0].Title = strings.Repeat("长会话名称", 80)
	tt.Frame()
	r = composerUnclippedRects(t, tt)
	if r["任务模式"].X+r["任务模式"].W > r["切换右侧栏"].X {
		t.Fatalf("long title pushed label over controls: %v", r)
	}
	a.rightPaneOpen = true
	tt.Frame()
	r = composerUnclippedRects(t, tt)
	if _, ok := r["任务模式"]; ok {
		t.Fatal("passive label not hidden in <=540 column")
	}
}
