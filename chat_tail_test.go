package main

import (
	"encoding/json"
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

func tailActionCopies(tt *ui.Tester, prefix string) int {
	copies := 0
	for _, text := range tt.Texts() {
		if strings.HasPrefix(text, "复制消息 "+prefix) {
			copies++
		}
	}
	return copies
}

// A reply that has settled inside a still-running Turn is not the Turn's tail:
// the original client publishes copy/feedback/branch chrome on turn/end only,
// so a running command must not grow a footer that the next thinking step then
// removes.
func TestOpenTurnWithSettledReplyHasNoTailActions(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	var s snapshot
	raw := `{"sessionId":"p","running":true,"messages":[
		{"id":"u1","seq":1,"turn":1,"step":1,"role":"user","kind":"user","text":"run it"},
		{"id":"a1","seq":2,"turn":1,"step":1,"role":"assistant","kind":"assistant","text":"starting","assistantBlocks":[{"kind":"text","text":"starting"}]}
	],"chatPresentation":{"schemaVersion":1,"presentationEpoch":"chat:1","baselineSerial":1,"presentationRevision":0,
		"turns":[{"turn":1,"status":"open","startLoaded":true,"latestStep":1,"foldEligible":true,"alwaysOpen":true,"spec":{"turn":1,"controlAnchorSeq":1,"processStartSeq":1,"answerAnchorSeq":2,"answerStep":1}}],
		"steps":[{"nodeKey":"s1","turn":1,"step":1,"payloadId":"a1","status":"settled","anchorSeq":2,"finalEventSeq":2,"hasReply":true}]}}`
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		t.Fatal(err)
	}
	if !a.replaceSnapshot(s) {
		t.Fatal("snapshot was rejected")
	}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if copies := tailActionCopies(tt, "a1"); copies != 0 {
		t.Fatalf("running turn exposed %d tail action strips", copies)
	}
	a.current.ChatPresentation.Turns[0].Status = "closed"
	tt.Frame()
	if copies := tailActionCopies(tt, "a1"); copies != 1 {
		t.Fatalf("closed turn must expose exactly one tail action strip, got %d", copies)
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
	if copies := tailActionCopies(tt, "r"); copies != 0 {
		t.Fatalf("streaming turn exposed %d tail action strips", copies)
	}
	// The reply settled, but its Turn still runs (a command, or the next
	// thinking step): no footer belongs on it yet.
	a.current.Messages[2].Streaming = false
	tt.Frame()
	if copies := tailActionCopies(tt, "r"); copies != 0 {
		t.Fatalf("settled reply in a running turn exposed %d tail action strips", copies)
	}
	a.current.Running = false
	tt.Frame()
	if copies := tailActionCopies(tt, "r"); copies != 1 {
		t.Fatalf("closed turn must expose exactly one tail action strip, got %d", copies)
	}
}
