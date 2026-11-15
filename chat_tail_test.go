package main

import (
	"strings"
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestMarkTailRowsFlagsOneResponsePerTurn(t *testing.T) {
	rows := []chatRow{
		{ID: "u1", User: true, Turn: 1},
		{ID: "r1", Response: true, Turn: 1},
		{ID: "r2", Response: true, Turn: 1},
		{ID: "u2", User: true, Turn: 2},
		{ID: "r3", Response: true, Turn: 2},
		{ID: "running", Running: true},
	}
	markTailRows(rows)
	if rows[1].Tail || !rows[2].Tail || !rows[4].Tail {
		t.Fatalf("tail flags=%+v", rows)
	}
	if latestTurn(rows) != 2 {
		t.Fatalf("latest turn=%d", latestTurn(rows))
	}
}

func TestRunningStatusLivesInTranscriptAndOnlyTailHasActions(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.current = snapshot{SessionID: a.sessionID, Running: true, Messages: []message{
		{ID: "u1", Role: "user", Text: "go", Turn: 1, Time: 1700000000000},
		{ID: "r1", Role: "assistant", Kind: "assistant", Text: "first", Turn: 1, Streaming: false, Time: 1700000001000, AssistantBlocks: []assistantBlock{{Kind: "text", Text: "first"}}},
		{ID: "r2", Role: "assistant", Kind: "assistant", Text: "second", Turn: 1, Streaming: true, Time: 1700000002000, AssistantBlocks: []assistantBlock{{Kind: "text", Text: "second"}}},
	}}
	a.uiPrefs.FoldedReplies = "all"
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("深度求索中") {
		t.Fatal("running status missing from transcript")
	}
	for _, text := range tt.Texts() {
		if strings.Contains(text, "运行中") {
			t.Fatalf("unexpected running chip %q", text)
		}
	}
	copies := 0
	for _, text := range tt.Texts() {
		if strings.HasPrefix(text, "复制消息 r") {
			copies++
		}
	}
	if copies != 0 {
		t.Fatalf("streaming turn exposed %d tail action strips", copies)
	}
	a.current.Messages[2].Streaming = false
	a.current.Running = false
	tt.Frame()
	copies = 0
	for _, text := range tt.Texts() {
		if strings.HasPrefix(text, "复制消息 r") {
			copies++
		}
	}
	if copies != 1 {
		t.Fatalf("closed turn must expose exactly one tail action strip, got %d", copies)
	}
}
