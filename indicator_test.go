package main

import (
	"math"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"
)

func TestSpinnerMatchesCSSKeyframes(t *testing.T) {
	for _, tc := range []struct {
		at                       time.Duration
		rotation, length, offset float64
	}{
		{0, 0, 12, 0},
		{375 * time.Millisecond, math.Pi / 2, 18, -3},
		{750 * time.Millisecond, math.Pi, 24, -6},
		{1125 * time.Millisecond, math.Pi * 1.5, 18, -3},
		{1500 * time.Millisecond, 0, 12, 0},
	} {
		r, l, o := spinnerGeometry(tc.at)
		if math.Abs(r-tc.rotation) > 0.0001 || math.Abs(l-tc.length) > 0.0001 || math.Abs(o-tc.offset) > 0.0001 {
			t.Fatalf("at %s: rotation=%f length=%f offset=%f", tc.at, r, l, o)
		}
	}
	// Check the Bezier curve between keyframes too; linear pacing changes the visual.
	if e := easeInOut(.25); e < .128 || e > .131 {
		t.Fatalf("quarter easing=%f", e)
	}
}

func TestSpinnerPaintsWithoutRebuildingAndStopsWhenRemoved(t *testing.T) {
	var stats renderStats
	show := true
	tt := ui.NewTester(func(c *ui.Context) {
		stats.Builds++
		if show {
			stateIndicator(c, true, time.Time{}, ui.RGB(100, 100, 100), &stats)
		}
	}, 80, 60)
	builds, paints := stats.Builds, stats.IndicatorPaints
	tt.Advance(1500 * time.Millisecond)
	if stats.Builds != builds {
		t.Fatalf("animation rebuilt view: before=%d after=%d", builds, stats.Builds)
	}
	if stats.IndicatorPaints <= paints {
		t.Fatal("animation did not paint")
	}
	show = false
	tt.Frame()
	paints = stats.IndicatorPaints
	tt.Advance(1500 * time.Millisecond)
	if stats.IndicatorPaints != paints {
		t.Fatal("removed indicator continued painting")
	}
	if tt.FramePending() {
		t.Fatal("removed indicator left a frame scheduled")
	}
}

func TestNormalStartupDoesNotContainDemoSessions(t *testing.T) {
	a := newApp(false)
	defer a.cancel()
	if a.demo || len(a.sessions) != 0 || len(a.current.Messages) != 0 {
		t.Fatal("normal startup published demo data")
	}
}

func TestUnauthenticatedConnectOpensLoginWithoutProtocolError(t *testing.T) {
	a := newApp(false)
	defer a.cancel()
	tt := ui.NewTester(a.view, 1280, 820)
	if err := tt.Click("连接远程主机"); err != nil {
		t.Fatal(err)
	}
	if !a.connectionOpen || a.error != "" || a.busy {
		t.Fatalf("normal login route: open=%v error=%q busy=%v", a.connectionOpen, a.error, a.busy)
	}
	if a.detail != "请先登录 Remote，再选择工作主机。" {
		t.Fatal("missing actionable login guidance")
	}
}
