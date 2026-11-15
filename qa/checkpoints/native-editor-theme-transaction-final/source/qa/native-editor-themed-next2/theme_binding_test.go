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
