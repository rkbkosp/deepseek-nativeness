package main

import (
	"image/png"
	"os"
	"testing"

	"github.com/egoist/mygo/ui"
)

// TestToolBodyVisualCapture writes the expanded body of a tool this client has
// no dedicated card for: the original shows the call's argument JSON and the
// result text, so the row must not be a dead end. Skipped unless DSH_CAPTURE=1.
func TestToolBodyVisualCapture(t *testing.T) {
	if os.Getenv("DSH_CAPTURE") == "" {
		t.Skip("set DSH_CAPTURE=1 to write local baseline PNGs")
	}
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.uiPrefs.StepsDetail = "verbose"
	a.current = snapshot{SessionID: a.sessionID, Messages: []message{
		{ID: "u1", Role: "user", Kind: "user", Turn: 1, Text: "看一下这个设计节点的上下文。"},
		{ID: "mcp", Role: "tool", Kind: "tool", Turn: 1, Text: `{"name":"Frame 12","type":"FRAME"}`,
			Tool: &toolNode{Name: "figma_get_design_context", Phase: "settled",
				ArgsRaw: `{"nodeId":"12:34","depth":2,"includeScreenshot":false}`}},
	}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if err := tt.Click("工具调用"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	file, err := os.Create("/tmp/native-tool-body-arguments.png")
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(file, tt.Image()); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
}
