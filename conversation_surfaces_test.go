package main

import (
	"encoding/json"
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestHistoryHeroSteeringAndStatsSurfaces(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sessionID = "s"
	a.current = snapshot{SessionID: "s", HasMore: true, Messages: []message{{ID: "a", Role: "assistant", Kind: "assistant", Turn: 1, Text: "answer", Usage: json.RawMessage(`{"inputTokens":10,"outputTokens":20,"cacheReadTokens":70,"totalTokens":100}`), AssistantBlocks: []assistantBlock{{Kind: "text", Text: "answer"}}}}}
	a.composer = &composerState{sessionID: "s", values: composerProjectionValues{Inbox: map[string][]composerQueueItem{
		"next-step": {{ID: "steer", Content: []struct {
			Type       string          `json:"type"`
			Text       string          `json:"text"`
			Attachment json.RawMessage `json:"attachment"`
		}{{Type: "text", Text: "插话内容"}}}},
	}}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	for _, want := range []string{"加载更早", "插话内容", "1轮 1步", "100 tok"} {
		if !tt.HasText(want) {
			t.Fatalf("missing %q", want)
		}
	}

	empty := newApp(true)
	t.Cleanup(empty.cancel)
	empty.sessionID = "blank"
	empty.current = snapshot{SessionID: "blank"}
	et := ui.NewTester(empty.view, 1280, 820)
	et.Frame()
	if !et.HasText("探索未至之境") || !et.HasText("预览版") {
		t.Fatalf("hero missing: %v", et.Texts())
	}
}

func TestTriggerCardRendersSourceKind(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sessionID = "s"
	a.uiPrefs.StepsDetail = "verbose"
	a.current = snapshot{SessionID: "s", Messages: []message{{ID: "t", Role: "context", Kind: "context", Trigger: "github", Text: "event body", Time: 1700000000000}}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("收到 GitHub 事件") {
		t.Fatalf("trigger card missing: %v", tt.Texts())
	}
}

func TestTodoPanelUsesProjectedList(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sessionID = "s"
	todos := []todoItem{{Content: "读取文件", Status: "completed"}, {Content: "运行测试", Status: "in_progress"}}
	a.composer = &composerState{sessionID: "s", values: composerProjectionValues{Todos: &todos}}
	a.current = snapshot{SessionID: "s", Messages: []message{{ID: "u", Role: "user", Text: "go", Turn: 1}}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("任务") || !tt.HasText("1 已完成  ·  1 进行中") {
		t.Fatalf("todo panel missing: %v", tt.Texts())
	}
}
