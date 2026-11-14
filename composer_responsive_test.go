package main

import (
	"encoding/json"
	"github.com/egoist/mygo/ui"
	"math"
	"reflect"
	"strings"
	"testing"
	"time"
)

// Read-only inspection of the pinned frozen MyGo node arena. Tester.Find is
// clipped AX geometry, so it cannot prove that a control didn't overflow.
func composerUnclippedRects(t *testing.T, tt *ui.Tester) map[string]ui.Rect {
	t.Helper()
	rt := reflect.ValueOf(tt).Elem().FieldByName("rt").Elem()
	c := rt.FieldByName("c")
	chunks := c.FieldByName("chunks")
	used := int(c.FieldByName("used").Int())
	out := map[string]ui.Rect{}
	index := 0
	for i := 0; i < chunks.Len() && index < used; i++ {
		chunk := chunks.Index(i)
		for j := 0; j < chunk.Len() && index < used; j++ {
			node := chunk.Index(j)
			index++
			x, y, w, h := node.FieldByName("x").Float(), node.FieldByName("y").Float(), node.FieldByName("w").Float(), node.FieldByName("h").Float()
			for _, n := range []float64{x, y, w, h, x + w, y + h} {
				if math.IsNaN(n) || math.IsInf(n, 0) {
					t.Fatal("nonfinite composer reachable layout")
				}
			}
			label := node.FieldByName("label").String()
			if label != "" {
				out[label] = ui.Rect{X: float32(x), Y: float32(y), W: float32(w), H: float32(h)}
			}
		}
	}
	return out
}
func composerResponsiveApp(t *testing.T, model string, customPermission, plan bool) *app {
	t.Helper()
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.current.Running = false
	for i := range a.sessions {
		a.sessions[i].Running = false
	}
	a.rightPaneOpen = true
	a.composer = &composerState{hostID: a.hostID, sessionID: a.sessionID, generation: a.remoteGeneration}
	permission := "workspace-write"
	if customPermission {
		permission = "custom-restricted"
	}
	baseline := `{"values":{"permissions":{"currentValue":"` + permission + `"},"plan":{"active":` + map[bool]string{true: "true", false: "false"}[plan] + `}}}`
	if err := a.acceptComposerProjections([]byte(baseline)); err != nil {
		t.Fatal(err)
	}
	a.composer.permissions = []settingsPermissionOption{{Value: permission, Name: permission}}
	if customPermission {
		a.composer.permissions[0].Name = "自定义工作目录权限"
	}
	raw := `{"default":{"provider":"fixture-provider","model":"fixture-model"},"groups":[{"id":"fixture-provider","name":"Magpie","models":[{"id":"fixture-model","name":` + string(mustComposerJSON(t, model)) + `,"reasoning":{"efforts":[]}}]}]}`
	if err := json.Unmarshal([]byte(raw), &a.composer.catalog); err != nil {
		t.Fatal(err)
	}
	a.composer.refreshLabels()
	return a
}
func mustComposerJSON(t *testing.T, v string) []byte {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func assertComposerControlsInsideChat(t *testing.T, a *app, tt *ui.Tester, windowWidth float32) {
	t.Helper()
	rects := composerUnclippedRects(t, tt)
	left := float32(280) * a.sidebarShown
	right := windowWidth
	if a.rightPaneOpen {
		right -= min(float32(576), windowWidth*.45)
	}
	for _, name := range []string{"消息输入框", "指令", "权限模式", "选择模型", "发送消息"} {
		r, ok := rects[name]
		if !ok || r.W <= 0 || r.H <= 0 {
			t.Fatalf("missing retained control %s: %+v", name, r)
		}
		if r.X < left+15 || r.X+r.W > right-15 || r.Y < 0 || r.Y+r.H > 820 {
			t.Fatalf("%s escaped actual chat [%g,%g]: %+v", name, left, right, r)
		}
	}
	names := []string{"权限模式", "选择模型", "发送消息"}
	for i := range names {
		for j := i + 1; j < len(names); j++ {
			a, b := rects[names[i]], rects[names[j]]
			if min(a.X+a.W, b.X+b.W)-max(a.X, b.X) > .5 && min(a.Y+a.H, b.Y+b.H)-max(a.Y, b.Y) > .5 {
				t.Fatalf("overlapping %s %+v and %s %+v", names[i], a, names[j], b)
			}
		}
	}
}
func TestComposerNarrowColumnUsesMeasuredModelGlyphAndWrapsWithoutClipping(t *testing.T) {
	for _, tc := range []struct {
		name, model  string
		width        int
		custom, plan bool
	}{{"comparison-column", "DeepSeek-Flash · Qoder CN", 1280, false, false}, {"long-names-and-plan", strings.Repeat("Long model 中文 ", 15), 1280, true, true}, {"narrow-wrap", "DeepSeek-Flash · Qoder CN", 900, false, true}} {
		t.Run(tc.name, func(t *testing.T) {
			a := composerResponsiveApp(t, tc.model, tc.custom, tc.plan)
			tt := ui.NewTester(a.view, tc.width, 820)
			tt.Frame()
			tt.Frame()
			assertComposerControlsInsideChat(t, a, tt, float32(tc.width))
			if tc.name != "comparison-column" && !a.composer.modelCompact {
				t.Fatal("narrow measured demand did not switch model text to original glyph")
			}
			if a.composerModelLabel() != tc.model+" Default" {
				t.Fatal("responsive switch discarded model/effort display data")
			}
			if tc.custom && !composerHasPermissionGlyph(a.composer.values.Permissions.CurrentValue) {
				if _, ok := tt.Find("自定义工作目录权限"); !ok {
					t.Fatal("unknown permission lost its only text identity")
				}
			}
		})
	}
}
func TestComposerExpandsAgainAfterPaneCloseAndWindowResizeWithoutPolling(t *testing.T) {
	a := composerResponsiveApp(t, "DeepSeek-Flash · Qoder CN Long Provider", false, false)
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !a.composer.modelCompact {
		t.Fatal("expected narrow glyph")
	}
	a.rightPaneOpen = false
	tt.Frame()
	tt.Frame()
	assertComposerControlsInsideChat(t, a, tt, 1280)
	if a.composer.modelCompact {
		t.Fatal("model text did not return when space became available")
	}
	a.rightPaneOpen = true
	tt.Frame()
	tt.Frame()
	tt.SetSize(1100, 820)
	tt.Frame()
	tt.Frame()
	assertComposerControlsInsideChat(t, a, tt, 1100)
	if !a.composer.modelCompact {
		t.Fatal("resize didn't re-evaluate expanded demand")
	}
	builds := a.builds
	tt.Advance(time.Second)
	if a.builds != builds {
		t.Fatal("stable responsive controls keep rebuilding")
	}
}
