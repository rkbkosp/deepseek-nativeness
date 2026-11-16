package main

import (
	"encoding/json"
	"testing"

	"github.com/egoist/mygo/ui"
)

// A subagent activation opens a receipt card: the agent name, the child Session
// id, what it was asked to do, and the prompt itself, with a way in.
func TestSubagentToolCardShowsTheActivationReceipt(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.uiPrefs.StepsDetail = "verbose"
	a.current = snapshot{SessionID: a.sessionID, Messages: []message{
		{ID: "u", Role: "user", Text: "派一个子代理", Turn: 1},
		{ID: "call", Role: "tool", Kind: "tool", Turn: 1, Text: "started subagent child-1", Tool: &toolNode{
			Name: "subagent", Phase: "settled",
			ArgsRaw: `{"description":"审阅页面","prompt":"检查会话页的间距"}`,
			Meta:    json.RawMessage(`{"kind":"activation","name":"reviewer","subagentId":"child-1"}`),
		}},
	}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if err := tt.Click("子智能体"); err != nil {
		t.Fatalf("open the subagent card: %v", err)
	}
	tt.Frame()
	for _, want := range []string{"已启动", "reviewer", "child-1", "审阅页面", "检查会话页的间距", "打开子会话"} {
		if !tt.HasText(want) {
			t.Fatalf("the receipt card lacks %q: %v", want, tt.Texts())
		}
	}
}

// Historical results carry no structured meta, so the recorded
// "started subagent <id>" line still resolves the child.
func TestSubagentCardFallsBackToTheRecordedLine(t *testing.T) {
	name, id := subagentActivation(&toolNode{}, "started background subagent job job-7")
	if name != "" || id != "job-7" {
		t.Fatalf("historical receipt = %q / %q", name, id)
	}
	name, id = subagentActivation(&toolNode{Meta: json.RawMessage(`{"kind":"activation","name":"reviewer","subagentId":"child-1"}`)}, "")
	if name != "reviewer" || id != "child-1" {
		t.Fatalf("structured receipt = %q / %q", name, id)
	}
	if name, id := subagentActivation(&toolNode{Meta: json.RawMessage(`{"kind":"other"}`)}, "final reply"); name != "" || id != "" {
		t.Fatalf("foreign meta resolved a child: %q / %q", name, id)
	}
}
