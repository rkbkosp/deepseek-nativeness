package main

import (
	"github.com/egoist/mygo/ui"
	"strconv"
	"testing"
)

func TestCandidatePopupHasVisibleMouseTargets(t *testing.T) {
	for _, width := range []int{420, 900} {
		t.Run(strconv.Itoa(width), func(t *testing.T) {
			open := true
			chosen := ""
			items := []candidate{{Label: "Fixture source"}, {Label: "中文 file.md"}, {Label: "with space"}}
			tt := ui.NewTester(func(c *ui.Context) {
				c.SetTheme(ui.DarkTheme())
				ui.Column(c).Fill().Padding(24).Children(func() {
					ui.Text(c, "input surface geometry")
					anchor := ui.NativeView(c, nil).FillWidth().Height(180).Shrink(0)
					candidatePopup(c, anchor, &open, items, 0, func(item candidate) { chosen = item.Label; open = false })
					ui.Text(c, "footer")
				})
			}, width, 620)
			tt.Frame()
			for _, item := range items {
				r, ok := tt.Find(item.Label)
				if !ok || r.W <= 0 || r.H < 10 || r.X < 0 || r.Y < 0 || r.X+r.W > float32(width) || r.Y+r.H > 620 {
					t.Fatalf("candidate not visibly bounded: %q %+v", item.Label, r)
				}
				t.Logf("%s %+v", item.Label, r)
			}
			if err := tt.Click("中文 file.md"); err != nil {
				t.Fatal(err)
			}
			if chosen != "中文 file.md" {
				t.Fatal("pointer did not choose candidate")
			}
		})
	}
}

// Preserve the old ordinary-flow geometry as a diagnostic. This does not
// replace root's actual NativeView screenshot evidence.
func TestPreviousInlineCandidateGeometryDiagnostic(t *testing.T) {
	hasItems := false
	tt := ui.NewTester(func(c *ui.Context) {
		ui.Column(c).Fill().Padding(24).Gap(10).Children(func() {
			ui.Text(c, "NSTextView reference editor").FontSize(18)
			ui.Text(c, "fixture only").FontSize(12)
			ui.Row(c).Gap(8).Children(func() { ui.Button(c, "A/B"); ui.Button(c, "theme"); ui.Button(c, "clear"); ui.Button(c, "focus") })
			ui.NativeView(c, nil).FillWidth().Height(180)
			if hasItems {
				ui.Column(c).FillWidth().MaxHeight(180).Padding(6).Children(func() {
					for _, s := range []string{"Fixture source", "中文 file.md", "with space"} {
						ui.Button(c, s)
					}
				})
			}
			ui.Row(c).Children(func() { ui.Button(c, "Native popup"); ui.Button(c, "send") })
			ui.Text(c, "canonical mirror")
			ui.Text(c, "pending physical IME")
		})
	}, 900, 620)
	hasItems = true
	tt.Frame()
	for _, s := range []string{"Fixture source", "中文 file.md", "with space"} {
		r, ok := tt.Find(s)
		t.Logf("old inline candidate %q found=%v bounds=%+v", s, ok, r)
	}
}
