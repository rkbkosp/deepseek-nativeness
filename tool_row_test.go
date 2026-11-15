package main

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestToolAndCommandRowsUseOriginalTitlesAndStructuredBodies(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	command, _ := json.Marshal(map[string]any{"commandId": "c1", "name": "permission", "outcome": map[string]any{"kind": "success", "text": "line one\nline two"}})
	a.uiPrefs.StepsDetail = "verbose"
	a.current = snapshot{SessionID: a.sessionID, Messages: []message{
		{ID: "bash", Role: "tool", Kind: "tool", Turn: 1, Text: "ok\n[exit code: 0]", Tool: &toolNode{Name: "bash", Phase: "settled", ArgsRaw: `{"command":"ls -la","description":"列出文件"}`}},
		{ID: "read", Role: "tool", Kind: "tool", Turn: 1, Text: "file body", Tool: &toolNode{Name: "read", Phase: "settled", ArgsRaw: `{"path":"/tmp/a.go"}`}},
		{ID: "cmd", Role: "command", Kind: "command", Turn: 1, Text: "line one\nline two", Command: command},
	}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	for _, want := range []string{"运行命令", "列出文件", "读取", "/tmp/a.go", "permission", "line one"} {
		if !tt.HasText(want) {
			t.Fatalf("missing %q in %v", want, tt.Texts())
		}
	}
	for _, text := range tt.Texts() {
		if strings.TrimSpace(text) == "bash" || strings.TrimSpace(text) == "read" {
			t.Fatalf("raw tool name leaked: %q", text)
		}
	}
	if summary := commandSummary(commandLifecycle{Name: "x", Outcome: &commandOutcome{Kind: "error", Text: ""}}); summary != "指令失败" {
		t.Fatalf("command error summary=%q", summary)
	}
	if out, code, signal := splitTerminalResult("ok\n[exit code: 7]"); out != "ok" || code == nil || *code != 7 || signal != "" {
		t.Fatal("exit marker parsing")
	}
}
