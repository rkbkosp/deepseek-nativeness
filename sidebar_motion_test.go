package main

import (
	"github.com/egoist/mygo/ui"
	"testing"
	"time"
)

func TestSidebarSlideKeepsExpandedContentWidthAndStopsAfter300ms(t *testing.T) {
	a := newApp(true)
	defer a.cancel()
	a.current.Running = false
	for i := range a.sessions {
		a.sessions[i].Running = false
	}
	tt := ui.NewTester(a.view, 1280, 820)
	before, ok := tt.Find("DeepSeek Harness")
	if !ok {
		t.Fatal("missing logo")
	}
	if err := tt.Click("收起侧栏"); err != nil {
		t.Fatal(err)
	}
	tt.Advance(150 * time.Millisecond)
	during, ok := tt.Find("DeepSeek Harness")
	if !ok || a.sidebarLayoutWidth != 280 || during.W >= before.W || a.sidebarShown <= 0 || a.sidebarShown >= 1 {
		t.Fatalf("sidebar did not keep frozen layout: before=%+v during=%+v shown=%v", before, during, a.sidebarShown)
	}
	tt.Advance(250 * time.Millisecond)
	if a.sidebarShown != 0 {
		t.Fatalf("sidebar did not settle: %v", a.sidebarShown)
	}
	if _, ok := tt.Find("DeepSeek Harness"); ok {
		t.Fatal("hidden sidebar still built")
	}
	builds := a.builds
	tt.Advance(time.Second)
	if a.builds != builds {
		t.Fatal("settled sidebar keeps rebuilding")
	}
}
