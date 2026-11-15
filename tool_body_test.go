package main

import (
	"strings"
	"testing"

	"github.com/egoist/mygo/ui"
)

// The original tool row is expandable for every settled call that has
// arguments, output or a card — including tools this client has no dedicated
// body for (MCP and plugin tools). Those rows used to be dead ends: the title
// showed "工具调用", the summary only knew a few argument keys, and a click had
// nothing to open.
func TestUnknownToolRowExpandsItsArguments(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.uiPrefs.StepsDetail = "verbose"
	a.current = snapshot{SessionID: a.sessionID, Messages: []message{
		{ID: "mcp", Role: "tool", Kind: "tool", Turn: 1,
			Tool: &toolNode{Name: "figma_get_design_context", Phase: "settled", ArgsRaw: `{"nodeId":"12:34","depth":2}`}},
	}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("工具调用") {
		t.Fatalf("unknown tool row missing its title: %v", tt.Texts())
	}
	if err := tt.Click("工具调用"); err != nil {
		t.Fatalf("unknown tool row is not clickable: %v", err)
	}
	tt.Frame()
	if !tt.HasText("输入") || !tt.HasText(`"nodeId": "12:34"`) || !tt.HasText(`"depth": 2`) {
		t.Fatalf("arguments did not open as JSON: %v", tt.Texts())
	}
}

func TestPreparingToolRowHasNoBodyYet(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.uiPrefs.StepsDetail = "verbose"
	a.current = snapshot{SessionID: a.sessionID, Messages: []message{
		{ID: "prep", Role: "tool", Kind: "tool", Turn: 1,
			Tool: &toolNode{Name: "bash", Phase: "preparing", ArgsRaw: `{"command":"ls"}`}},
	}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if err := tt.Click("运行命令"); err != nil {
		t.Fatalf("preparing row should still be a row: %v", err)
	}
	tt.Frame()
	if tt.HasText("$ ls") || tt.HasText(`"command": "ls"`) || hasExactText(tt, "输入") {
		t.Fatalf("a preparing call opened a body: %v", tt.Texts())
	}
}

// A call with no arguments, no output and no sub-calls is a summary only,
// exactly like the original's `inputRaw === null && outputText === null`.
func TestToolRowWithoutArgumentsOrOutputStaysSummary(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.uiPrefs.StepsDetail = "verbose"
	a.current = snapshot{SessionID: a.sessionID, Messages: []message{
		{ID: "bare", Role: "tool", Kind: "tool", Turn: 1,
			Tool: &toolNode{Name: "list_agents", Phase: "settled"}},
	}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if err := tt.Click("列出智能体"); err != nil {
		t.Fatalf("row should be clickable as a row: %v", err)
	}
	tt.Frame()
	if hasExactText(tt, "输入") || hasExactText(tt, "输出") {
		t.Fatalf("a bare call opened an empty body: %v", tt.Texts())
	}
}

func hasExactText(tt *ui.Tester, want string) bool {
	for _, text := range tt.Texts() {
		if text == want {
			return true
		}
	}
	return false
}

func TestToolArgsTextMatchesOriginalFormatting(t *testing.T) {
	cases := []struct{ raw, want string }{
		{``, ""},
		{`   `, ""},
		{`null`, ""},
		{`{"a":1}`, "{\n  \"a\": 1\n}"},
		{`{"b":[1,2]}`, "{\n  \"b\": [\n    1,\n    2\n  ]\n}"},
		// The Host's argument order survives, as JSON.stringify keeps it.
		{`{"nodeId":"12:34","depth":2}`, "{\n  \"nodeId\": \"12:34\",\n  \"depth\": 2\n}"},
		{`"plain"`, `"plain"`},
		{`not json`, "not json"},
	}
	for _, c := range cases {
		if got := toolArgsText(c.raw); got != c.want {
			t.Fatalf("toolArgsText(%q) = %q, want %q", c.raw, got, c.want)
		}
	}
	if strings.Contains(toolArgsText(`{"a":1}`), `{"a":1}`) {
		t.Fatal("arguments must be pretty-printed")
	}
}

// A plan update usually has no result text, so its row used to be a dead end
// even though the call carries the whole plan in its arguments.
func TestTodoRowExpandsItsPlanWithoutOutput(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.uiPrefs.StepsDetail = "verbose"
	a.current = snapshot{SessionID: a.sessionID, Messages: []message{
		{ID: "todo", Role: "tool", Kind: "tool", Turn: 1,
			Tool: &toolNode{Name: "todo_write", Phase: "settled",
				ArgsRaw: `{"todos":[{"content":"补齐工具行详情","status":"in_progress"}]}`}},
	}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if err := tt.Click("更新任务清单"); err != nil {
		t.Fatalf("plan row is not clickable: %v", err)
	}
	tt.Frame()
	if !tt.HasText(`"content": "补齐工具行详情"`) || !tt.HasText(`"status": "in_progress"`) {
		t.Fatalf("plan arguments did not open: %v", tt.Texts())
	}
}
