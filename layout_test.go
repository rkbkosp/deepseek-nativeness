package main

import (
	"github.com/egoist/mygo/ui"
	"math"
	"strings"
	"testing"
)

func TestLongConversationKeepsHeaderAndComposerInsideWindow(t *testing.T) {
	a := newApp(true)
	a.current.Running = false
	defer a.cancel()
	a.current.Messages = []message{{ID: "long", Role: "assistant", Text: strings.Repeat("A long conversation paragraph with enough words to wrap and scroll.\n\n", 300)}}
	tt := ui.NewTester(a.view, 1280, 820)
	for _, name := range []string{"消息输入框", "发送消息"} {
		r, ok := tt.Find(name)
		if !ok {
			t.Fatalf("missing %s", name)
		}
		if r.Y < 76 || r.Y+r.H > 820 {
			t.Fatalf("%s out of content bounds: %+v", name, r)
		}
	}
	r, _ := tt.Find("对话")
	if r.Y < 0 || r.Y+r.H > 76 {
		t.Fatalf("header bounds %+v", r)
	}
	a.settingsOpen = true
	tt.Frame()
	r, ok := tt.Find("关闭设置")
	if !ok || r.Y < 0 || r.Y+r.H > 820 {
		t.Fatalf("settings close bounds %+v", r)
	}
}

func TestCustomTableFiniteAndConstrained(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	a.current.Running = false
	a.current.Messages = []message{{ID: "table", Role: "assistant", Text: renderFixture("table")}}
	tt := ui.NewTester(a.view, 1280, 820)
	for _, name := range []string{"项目", "值", "安装包"} {
		r, ok := tt.Find(name)
		if !ok {
			t.Fatalf("missing %s", name)
		}
		if math.IsNaN(float64(r.X+r.Y+r.W+r.H)) || math.IsInf(float64(r.X+r.Y+r.W+r.H), 0) {
			t.Fatalf("nonfinite table cell %s %+v", name, r)
		}
		if r.X < 280 || r.X+r.W > 1248 {
			t.Fatalf("cell outside conversation %s %+v", name, r)
		}
	}
}
