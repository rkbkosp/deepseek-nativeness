package main

import (
	"math"
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestInterruptedAssistantRemainsVisibleAndShowsOneStoppedTag(t *testing.T) {
	for _, final := range []bool{false, true} {
		for _, text := range []string{"", "部分回答"} {
			t.Run(text+map[bool]string{false: "/all", true: "/final"}[final], func(t *testing.T) {
				a := newApp(true)
				t.Cleanup(a.cancel)
				a.current.Running = false
				a.current.Messages = []message{{ID: "previous", Role: "assistant", Text: "此前回答", Turn: 1}, {ID: "stopped", Role: "assistant", Interrupted: true, Text: text, Turn: 1}}
				if final {
					a.uiPrefs.FoldedReplies = "final"
				}
				rows := a.chatRows()
				if len(rows) != 2 || rows[1].Process || rows[1].Messages[0].ID != "stopped" {
					t.Fatalf("stopped response must stay outside folded process: %+v", rows)
				}
				tt := ui.NewTester(a.view, 1280, 820)
				tt.Frame()
				count := 0
				for _, label := range tt.Texts() {
					if label == "已停止" {
						count++
					}
				}
				if count != 1 {
					t.Fatalf("expected exactly one stopped tag, got %d", count)
				}
				box, ok := tt.Find("已停止")
				if !ok || math.Abs(float64(box.H-18)) > .001 || box.W <= 12 {
					t.Fatalf("stopped tag must keep the original 18px line box: %+v, %v", box, ok)
				}
			})
		}
	}
}
