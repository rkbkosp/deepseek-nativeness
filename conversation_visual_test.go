package main

import (
	"encoding/json"
	"image/png"
	"os"
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestConversationVisualCapture(t *testing.T) {
	if os.Getenv("DSH_CAPTURE") == "" {
		t.Skip("set DSH_CAPTURE=1 to write local baseline PNGs")
	}
	command, _ := json.Marshal(map[string]any{"commandId": "c1", "name": "permission", "outcome": map[string]any{"kind": "success", "text": "权限已更新"}})
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sessionID = "visual"
	a.uiPrefs.StepsDetail = "verbose"
	a.uiPrefs.FoldedReplies = "all"
	a.current = snapshot{SessionID: "visual", Messages: []message{
		{ID: "u", Role: "user", Text: "帮我看一下这个会话页面。", Turn: 1, Time: 1763200000000},
		{ID: "r", Role: "assistant", Kind: "assistant", Turn: 1, Step: 1, Text: "我先读取文件，再运行命令。", Time: 1763200001000, AssistantBlocks: []assistantBlock{{Kind: "reasoning", Text: "先确认文件内容，再运行测试。\n第二段思考。"}, {Kind: "text", Text: "我先读取文件，再运行命令。"}}},
		{ID: "read", Role: "tool", Kind: "tool", Turn: 1, Step: 1, Text: "package main\n\nfunc main() {}\n", Tool: &toolNode{Name: "read", Phase: "settled", ArgsRaw: `{"path":"/tmp/main.go"}`}},
		{ID: "bash", Role: "tool", Kind: "tool", Turn: 1, Step: 1, Text: "ok\n[exit code: 0]", Tool: &toolNode{Name: "bash", Phase: "settled", ArgsRaw: `{"command":"go test ./...","description":"运行测试"}`}},
		{ID: "cmd", Role: "command", Kind: "command", Turn: 1, Step: 1, Text: "权限已更新", Command: command},
		{ID: "final", Role: "assistant", Kind: "assistant", Turn: 1, Step: 2, Text: "读完了，测试通过。\n\n## 结论\n\n- 文件正常\n- 命令通过", Time: 1763200005000, Usage: json.RawMessage(`{"inputTokens":10,"outputTokens":20,"cacheReadTokens":70,"totalTokens":100}`), AssistantBlocks: []assistantBlock{{Kind: "text", Text: "读完了，测试通过。\n\n## 结论\n\n- 文件正常\n- 命令通过"}}},
	}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	for _, dark := range []bool{false, true} {
		a.effectiveDark = dark
		a.appearanceSignature = ""
		tt.SetDark(dark)
		tt.Frame()
		name := "/tmp/native-conversation-light.png"
		if dark {
			name = "/tmp/native-conversation-dark.png"
		}
		file, err := os.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if err := png.Encode(file, tt.Image()); err != nil {
			t.Fatal(err)
		}
		_ = file.Close()
	}

	empty := newApp(true)
	t.Cleanup(empty.cancel)
	empty.sessionID = "blank"
	empty.current = snapshot{SessionID: "blank"}
	et := ui.NewTester(empty.view, 1280, 820)
	et.Frame()
	file, err := os.Create("/tmp/native-conversation-hero.png")
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(file, et.Image()); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
}
