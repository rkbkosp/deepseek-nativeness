package main

import (
	"github.com/egoist/mygo/ui"
	native "native-dsh/desktop/composer_native"
	"testing"
)

func TestActualThemeButtonsCommitOneCapturedFrameToNativeStyleSink(t *testing.T) {
	dark, opposite := true, false
	var queue []func()
	var styles []map[string]any
	var hostDark []bool
	var frame proofThemeFrame
	binding := proofThemeBinding{}
	enqueue := func(fn func()) { queue = append(queue, fn) }
	applyHost := func() {
		v := dark
		if opposite {
			v = !v
		}
		hostDark = append(hostDark, v)
	}
	apply := func(c native.Command) bool { styles = append(styles, c.Style); return true }
	tt := ui.NewTester(func(c *ui.Context) {
		theme := ui.LightTheme()
		if dark {
			theme = ui.DarkTheme()
		}
		var err error
		frame, err = captureProofThemeFrame(dark, theme)
		if err != nil {
			t.Fatal(err)
		}
		c.SetTheme(frame.Theme)
		ui.Column(c).Fill().Background(frame.Theme.Background).Children(func() {
			if ui.Button(c, "深色/浅色").Clicked() {
				queueProofThemeIntent(enqueue, &dark, &opposite, toggleProofPalette, applyHost)
			}
			if ui.Button(c, "宿主跟随/反向").Clicked() {
				queueProofThemeIntent(enqueue, &dark, &opposite, toggleProofHost, applyHost)
			}
			binding.reconcile(frame, apply)
			ui.Text(c, frame.Style.Background)
		})
	}, 900, 620)
	check := func() {
		t.Helper()
		last := styles[len(styles)-1]
		if last["dark"] != dark || last["background"] != frame.Style.Background || last["foreground"] != frame.Style.Foreground {
			t.Fatalf("native props frozen/mixed with another frame: target%v frame%+v native%+v", dark, frame.Style, last)
		}
	}
	check()
	for i := 0; i < 6; i++ {
		before := dark
		beforeCommands := len(styles)
		if err := tt.Click("深色/浅色"); err != nil {
			t.Fatal(err)
		}
		if dark != before || len(queue) != 1 || len(styles) != beforeCommands {
			t.Fatal("intent mutated the current captured view transaction")
		}
		jobs := queue
		queue = nil
		for _, fn := range jobs {
			fn()
		}
		tt.Frame()
		check()
		if dark == before || len(styles) != beforeCommands+1 {
			t.Fatal("new palette never reached native style")
		}
	}
	beforeCommands := len(styles)
	before := dark
	if err := tt.Click("宿主跟随/反向"); err != nil {
		t.Fatal(err)
	}
	jobs := queue
	queue = nil
	for _, fn := range jobs {
		fn()
	}
	tt.Frame()
	check()
	if dark != before || len(styles) != beforeCommands || hostDark[len(hostDark)-1] == dark {
		t.Fatal("host-only change changed logical/native palette")
	}
}
func TestFullStyleSignatureRetriesFailureAndDetectsSameThemeColorAndFontChange(t *testing.T) {
	theme := ui.DarkTheme()
	first, _ := captureProofThemeFrame(true, theme)
	binding := proofThemeBinding{}
	calls := 0
	reject := true
	apply := func(native.Command) bool { calls++; return !reject }
	if binding.reconcile(first, apply) || binding.hasApplied {
		t.Fatal("failed native apply was cached")
	}
	reject = false
	if !binding.reconcile(first, apply) || calls != 2 {
		t.Fatal("failed apply did not retry")
	}
	binding.reconcile(first, apply)
	if calls != 2 {
		t.Fatal("unchanged style reissued")
	}
	theme.Surface = ui.Hex("#303134")
	theme.FontSize = 18
	next, _ := captureProofThemeFrame(true, theme)
	binding.reconcile(next, apply)
	if calls != 3 || binding.applied.Background != "#303134" || binding.applied.FontSize != 18 {
		t.Fatal("boolean theme key froze changed colors/font")
	}
}

func TestAppearanceEventFenceIsBoundedDeferredAndCloseSafe(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		live, observed, committed := true, 0, 0
		var event func()
		var queue []func()
		off := bindProofAppearance(func(fn func()) func() { event = fn; return func() { event = nil } }, enabled,
			func() bool { return live }, func(fn func()) { queue = append(queue, fn) },
			func() { observed++ }, func() { committed++ })
		event()
		want := 0
		if enabled {
			want = 1
		}
		if len(queue) != want || observed != 1 || committed != 0 {
			t.Fatal("event did not defer exactly one update", enabled, observed, committed, len(queue))
		}
		for _, fn := range queue {
			fn()
		}
		if committed != want {
			t.Fatal("event update did not commit")
		}
		queue = nil
		event()
		live = false
		for _, fn := range queue {
			fn()
		}
		if committed != want {
			t.Fatal("queued appearance callback committed after close")
		}
		queue = nil
		event()
		if len(queue) != 0 {
			t.Fatal("closed owner queued more updates")
		}
		off()
		if event != nil {
			t.Fatal("observer not retired")
		}
	}
}

func TestSixPaletteTransitionsPaintGoCanvasPixelsInFirstNewFrame(t *testing.T) {
	dark := true
	var queue []func()
	painted := false
	tt := ui.NewTester(func(c *ui.Context) {
		theme := ui.LightTheme()
		if dark {
			theme = ui.DarkTheme()
		}
		c.SetTheme(theme)
		ui.Column(c).Fill().Background(theme.Background).DrawOver(func(_ *ui.Painter, _ ui.Rect) { painted = dark }).Children(func() {
			if ui.Button(c, "toggle").Clicked() {
				queue = append(queue, func() { dark = !dark })
			}
		})
	}, 900, 620)
	for i := 0; i < 6; i++ {
		if err := tt.Click("toggle"); err != nil {
			t.Fatal(err)
		}
		if len(queue) != 1 {
			t.Fatal("single click did not create single intent")
		}
		queue[0]()
		queue = nil
		tt.Frame()
		pixel := tt.Image().RGBAAt(850, 580)
		want := ui.LightTheme().Background
		if dark {
			want = ui.DarkTheme().Background
		}
		if painted != dark || pixel.R != want.R || pixel.G != want.G || pixel.B != want.B || pixel.A != want.A {
			t.Fatalf("scene pixels stale after one intent: dark=%v painted=%v pixel=%v expected=%v", dark, painted, pixel, want)
		}
	}
}
