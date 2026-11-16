package main

import (
	"slices"
	"strings"
	"testing"

	"github.com/egoist/mygo/ui"
)

// heroPresetApp is a cold-start hero (no Session yet) with a roster already
// read, so the seat draws without a Host.
func heroPresetApp(t *testing.T) *app {
	t.Helper()
	a := newApp(false)
	t.Cleanup(a.cancel)
	a.connected = true
	a.heroPresetsLoaded = true
	a.heroPresets = []heroPresetEntry{
		{ID: "standard", Name: "标准模式", Description: "处理代码、文件和资料。", Default: true},
		{ID: "ptc", Name: "PTC 模式", Description: "更适合批量调用工具。"},
		{ID: "minimal", Name: "极简模式", Description: "仅使用终端工具。"},
		{ID: "cordis", Name: "创造模式", Description: "用对话定制 DSH。"},
	}
	return a
}

// The new-session hero carries the agent-preset seat beside the Workspace
// picker, and picking stages the choice for the Session that starts next.
func TestHeroPresetSeatListsTheRosterAndStagesAPick(t *testing.T) {
	a := heroPresetApp(t)
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("标准模式") {
		t.Fatalf("the hero does not name the default preset: %v", tt.Texts())
	}
	if err := tt.Click("标准模式"); err != nil {
		t.Fatalf("open the preset seat: %v", err)
	}
	labels := tt.Menu()
	for _, want := range []string{"标准模式", "PTC 模式", "极简模式", "创造模式"} {
		if !slices.Contains(labels, want) {
			t.Fatalf("the preset menu %v lacks %q", labels, want)
		}
	}
	if err := tt.ChooseMenuItem("PTC 模式"); err != nil {
		t.Fatalf("choose PTC: %v", err)
	}
	if a.heroPresetStaged != "ptc" {
		t.Fatalf("the pick was not staged for the next Session: %q", a.heroPresetStaged)
	}
	tt.Frame()
	if !tt.HasText("PTC 模式") {
		t.Fatalf("the chip did not follow the staged pick: %v", tt.Texts())
	}
}

// A staged pick reaches a blank Session through the projection reply and is
// forgotten afterwards. A Session whose conversation already started keeps its
// composition, so the stage is dropped instead of written.
func TestHeroPresetStageSettlesOnTheBlankSession(t *testing.T) {
	a := heroPresetApp(t)
	preset := "standard"
	s := &composerState{hostID: a.hostID, sessionID: "blank", generation: a.remoteGeneration, values: composerProjectionValues{AgentPreset: &preset}}
	a.composer = s
	a.sessionID = "blank"
	a.current = snapshot{SessionID: "blank"}
	a.heroPresetStaged = "ptc"
	a.operationCaps = map[string]operationCapability{"selectAgentPreset": {Supported: true}}
	// No client is attached, so the write cannot leave the process: the stage
	// must be consumed here, not looped on the next reply.
	a.applyStagedHeroPreset(s)
	if a.heroPresetStaged != "" {
		t.Fatal("a staged pick stayed staged after it was applied")
	}

	// The same choice a Session already records just clears the stage.
	a.heroPresetStaged = "standard"
	a.applyStagedHeroPreset(s)
	if a.heroPresetStaged != "" {
		t.Fatal("a staged pick equal to the composition stayed staged")
	}

	// A started Session is not switchable; the stage is dropped.
	a.heroPresetStaged = "ptc"
	a.current = snapshot{SessionID: "blank", Messages: []message{{ID: "u", Role: "user", Text: "go"}}}
	a.applyStagedHeroPreset(s)
	if a.heroPresetStaged != "" {
		t.Fatal("a started Session kept a stage it can never receive")
	}
}

// Display copy falls back to the shipped dictionary for a recorded preset the
// roster no longer carries, which is what keeps an old Session readable.
func TestHeroPresetLabelFallsBackToBuiltins(t *testing.T) {
	name, description, found := heroPresetLabel(nil, "ptc")
	if !found || name != "PTC 模式" || !strings.Contains(description, "批量") {
		t.Fatalf("builtin PTC label = %q / %q / %v", name, description, found)
	}
	if name, _, found := heroPresetLabel(nil, "team-review"); !found || name != "team-review" {
		t.Fatalf("unknown preset should read as its id: %q / %v", name, found)
	}
	entries := []heroPresetEntry{{ID: "review", Name: "代码评审", Description: "只读审阅"}}
	if name, description, _ := heroPresetLabel(entries, "review"); name != "代码评审" || description != "只读审阅" {
		t.Fatalf("roster label = %q / %q", name, description)
	}
}
