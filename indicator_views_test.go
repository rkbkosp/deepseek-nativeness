package main

import (
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
)

type fakeIndicatorView struct {
	handle                 uintptr
	stops, closes, updates int
}

func (v *fakeIndicatorView) NativeView() uintptr                          { return v.handle }
func (v *fakeIndicatorView) Update(ui.Color, indicatorBacking, time.Time) { v.updates++ }
func (v *fakeIndicatorView) Stop()                                        { v.stops++ }
func (v *fakeIndicatorView) Close()                                       { v.closes++; v.handle = 0 }
func TestIndicatorPoolReusesStoppedViewsAndClosesOnce(t *testing.T) {
	created := 0
	p := &indicatorViewPool{create: func() indicatorView { created++; return &fakeIndicatorView{handle: uintptr(created)} }}
	first, second := p.acquire(), p.acquire()
	a, b := first.view.(*fakeIndicatorView), second.view.(*fakeIndicatorView)
	first.Close()
	first.Close()
	reused := p.acquire()
	if created != 2 || reused.view != a || a.stops != 1 || first.NativeView() != 0 {
		t.Fatalf("lease reuse/stop failed: created=%d stops=%d", created, a.stops)
	}
	p.Close()
	p.Close()
	reused.Close()
	second.Close()
	if a.closes != 1 || b.closes != 1 || p.acquire() != nil || reused.NativeView() != 0 {
		t.Fatal("window did not close its views exactly once")
	}
}
func TestIndicatorPoolReturnsPainterFallbackOnCreationFailure(t *testing.T) {
	p := &indicatorViewPool{create: func() indicatorView { return nil }}
	if p.acquire() != nil || len(p.all) != 0 {
		t.Fatal("failed construction retained a view")
	}
	p.Close()
}
func TestNativeIndicatorStopsForSettledAndReducedMotionPaths(t *testing.T) {
	v := &fakeIndicatorView{handle: 1}
	stats := renderStats{indicators: &indicatorViewPool{create: func() indicatorView { return v }}}
	allowed, show := true, true
	tt := ui.NewTester(func(c *ui.Context) {
		if show {
			nativeStateIndicator(c, ui.Box(c).Size(14, 14), time.Time{}, ui.RGB(1, 2, 3), &stats, allowed, indicatorBacking{})
		}
	}, 80, 60)
	if v.updates != 1 {
		t.Fatal("native indicator not acquired")
	}
	allowed = false
	tt.Frame()
	if v.stops != 1 || len(stats.indicators.idle) != 1 {
		t.Fatal("fallback left the native animation running")
	}
	allowed = true
	tt.Frame()
	if len(stats.indicators.all) != 1 || v.updates != 2 {
		t.Fatal("resuming allocated a retained replacement")
	}
	show = false
	tt.Frame()
	if v.stops != 2 {
		t.Fatal("unmounted row left the animation running")
	}
	stats.indicators.Close()
}
