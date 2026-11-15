package main

import (
	"fmt"
	"github.com/egoist/mygo"
	"time"
)

// Explicit author-only host integration exercise. The default GUI never runs
// it; it changes theme intents only, never document content or Host tasks.
func runProofThemeIntegration(toggle func(proofThemeIntent), driveDiagnosticFrame func() error, pixelsRequired bool, inspect func() (map[string]any, bool), done func(map[string]any)) {
	go func() {
		steps := []struct {
			name           string
			action         int
			dark, hostDark bool
			styleDelta     int
		}{{"startup", -1, true, true, 1}, {"single-click-light", 0, false, false, 1}, {"single-click-dark", 0, true, true, 1}, {"host-opposite-light", 1, true, false, 0}, {"single-click-light-on-dark-host", 0, false, true, 1}, {"single-click-dark-on-light-host", 0, true, false, 1}, {"host-follow-again", 1, true, true, 0}}
		all := true
		before := 0
		var records []map[string]any
		for _, step := range steps {
			if step.action >= 0 {
				mygo.RunOnMain(func() { toggle(proofThemeIntent(step.action)) })
			}
			driverErr := driveDiagnosticFrame()
			var record map[string]any
			matched := false
			closed := false
			deadline := time.Now().Add(3 * time.Second)
			for time.Now().Before(deadline) {
				mygo.RunOnMain(func() { var live bool; record, live = inspect(); closed = !live })
				if closed {
					return
				}
				if record != nil {
					native, _ := record["native"].(map[string]any)
					wanted := record["expectedBackground"]
					host := "light"
					if step.hostDark {
						host = "dark"
					}
					appearance := "NSAppearanceNameAqua"
					if step.dark {
						appearance = "NSAppearanceNameDarkAqua"
					}
					matched = record["targetDark"] == step.dark && record["renderedDark"] == step.dark && record["goPaintedDark"] == step.dark && record["hostSource"] == host && native["background"] == wanted && native["clipBackground"] == wanted && native["textBackground"] == wanted && native["foreground"] == record["expectedForeground"] && native["appearance"] == appearance && native["windowAttached"] == true
					if matched {
						break
					}
				}
				time.Sleep(20 * time.Millisecond)
			}
			if record == nil {
				record = map[string]any{"error": "no integration state"}
			}
			count, _ := record["styleApplyCount"].(int)
			delta := count - before
			before = count
			record["step"] = step.name
			record["frameDriver"] = "natural Window.Update only; property reads only"
			if pixelsRequired {
				record["frameDriver"] = "one explicit public Window.CapturePage per intent and native subtree bitmap; diagnostic only"
			}
			if driverErr != nil {
				record["frameDriverError"] = driverErr.Error()
			}
			record["styleApplyDelta"] = delta
			record["expectedStyleDelta"] = step.styleDelta
			pixelOK := false
			if native, ok := record["native"].(map[string]any); ok {
				if pixel, ok := native["nativeSubtreePixel"].([]any); ok && len(pixel) == 4 {
					var r, g, b int
					if _, err := fmt.Sscanf(record["expectedBackground"].(string), "#%02x%02x%02x", &r, &g, &b); err == nil {
						wanted := []int{r, g, b, 255}
						pixelOK = true
						for i, n := range pixel {
							v, _ := n.(float64)
							if int(v) != wanted[i] {
								pixelOK = false
							}
						}
					}
				}
			}
			record["actualNativePropertiesMatch"] = matched
			record["nativeSubtreePixelMatches"] = pixelOK
			if !pixelsRequired {
				record["nativeSubtreePixelMatches"] = "not-sampled-in-natural-frame-run"
			}
			record["passed"] = matched && delta == step.styleDelta && (!pixelsRequired || pixelOK) && driverErr == nil
			if record["passed"] != true {
				all = false
			}
			records = append(records, record)
		}
		mygo.RunOnMain(func() {
			scope := "actual natural MyGo Window.Update/Content rebuild -> FFI -> mounted public NativeView property reads; no CapturePage or bitmap draw; not physical click/external-screen CUA acceptance"
			if pixelsRequired {
				scope = "diagnostic public CapturePage frame driver -> FFI mounted NativeView properties and native-subtree RGBA; not external-screen CUA acceptance"
			}
			done(map[string]any{"passed": all, "steps": records, "scope": scope, "presentationBoundary": "Go Draw callback/FFI NativeView properties, optionally CapturePage/native subtree. No WindowServer capture and no external-screen presentation claim.", "singleIntentStyleApplications": "one per palette transaction, zero for host-only changes"})
		})
	}()
}
