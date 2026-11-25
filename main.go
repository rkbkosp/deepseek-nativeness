package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"github.com/egoist/mygo"
	_ "github.com/egoist/mygo/plugins/automation"
	"github.com/egoist/mygo/ui"
	"log"
	"os"
	"path/filepath"
	"time"
)

func main() {
	demo := flag.Bool("demo", false, "show clearly labeled local UI replay; never connects")
	helper := flag.String("helper", "", "path to client-only Remote helper; bundled helper by default")
	capture := flag.String("capture", "", "capture native UI PNG after startup")
	exitAfter := flag.Duration("exit-after", 0, "close this client after a bounded manual smoke interval")
	metricsPath := flag.String("metrics", "", "write native render counters on exit")
	phase := flag.Duration("animation-time", -1, "freeze running indicator at elapsed duration (QA only)")
	running := flag.Int("demo-running", 2, "running session count in explicit demo (QA only)")
	hideSidebar := flag.Bool("hide-sidebar", false, "start with sidebar collapsed (QA only)")
	localRuntime := flag.Bool("local", false, "start the bundled local dsh runtime and show the served web client")
	localNative := flag.Bool("local-native", false, "start the bundled local dsh runtime and drive the native UI over /api/remote.mux")
	captureAfter := flag.Duration("capture-after", 0, "delay before --capture (QA only)")
	captureCompat := flag.String("capture-compat", "", "capture the compatibility web view itself (QA only; --capture only reaches the native layer)")
	recoveryProbe := flag.String("recovery-probe", "", "SIGKILL the local Host once and write local recovery evidence (QA only)")
	uiState := flag.String("ui-state", "", "open one reviewable surface on the first connected frame (QA only; see qa_ui_state.go)")
	theme := flag.String("theme", "", "client appearance: system, light, dark")
	windowDiagnostics := flag.String("window-diagnostics", "", "write this client's own window visibility and bounds after startup")
	document := flag.String("demo-document", "", "explicit demo only: long/table/images/structured native render regression")
	listClip := flag.Bool("qa-list-clip", false, "explicit demo only: reproduce redundant list clip")
	defaultTables := flag.Bool("qa-default-tables", false, "explicit demo only: use framework table renderer")
	demoPane := flag.Bool("demo-right-pane", false, "explicit demo only: constrain conversation with right pane")
	fontCalibration := flag.Bool("font-calibration", false, "explicit demo only: compare native font weights at the original 14 DIP")
	checkUpdateOnce := flag.String("check-update-once", "", "run one update check without a window and write its JSON evidence (development builds; QA only)")
	flag.Parse()
	// A headless QA check runs before the single-instance lock: a real client
	// may already own it, and this launch must not hand its command line over
	// and exit instead of checking. It never opens a window.
	if *checkUpdateOnce != "" {
		os.Exit(runUpdateCheckOnce(*checkUpdateOnce))
	}
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	localNativeMode = *localNative
	runtimeRecoveryProbePath = *recoveryProbe
	if localNativeMode {
		// The native client is the application in this mode; the web workspace
		// entry point is not a separate surface.
		*localRuntime = true
	}
	a := newApp(*demo)
	if a.demo {
		a.fontCalibration = *fontCalibration
		a.rightPaneOpen = *demoPane
		a.qaListClip = *listClip
		if *defaultTables {
			a.md.Block = nil
		}
	}
	mygo.Bind(&CompatAPI{a: a})
	if *theme == "system" || *theme == "light" || *theme == "dark" {
		a.uiPrefs.Theme = *theme
	}
	a.sidebar = !*hideSidebar
	if *phase >= 0 {
		a.metrics.FixedTime = phase
	}
	if a.demo {
		a.sessions = nil
		for i := 0; i < max(1, min(100, *running)); i++ {
			id := fmt.Sprintf("demo-%d", i)
			title := fmt.Sprintf("远程会话 %d · 界面回放", i+1)
			if i == 0 {
				title = productName + " · 界面回放"
				a.sessionID = id
				a.current.SessionID = id
			}
			a.sessions = append(a.sessions, session{ID: id, Title: title, Running: i < *running, WorkspaceID: "demo-workspace"})
		}
		a.current.Running = *running > 0
		a.applyDemoDocument(*document)
	}
	mygo.App.SetName(productName)
	// Set the app's AppKit appearance before its first window/material exists.
	// Rendering tokens alone do not change native vibrancy or title controls.
	mygo.Theme.SetSource(nativeAppearanceSource(a.uiPrefs.Theme))
	mygo.App.WhenReady(func() {
		a.effectiveDark = mygo.Theme.IsDark()
		mygo.Theme.OnUpdated(func() { a.update(func() { a.effectiveDark = mygo.Theme.IsDark() }) })
		// The bundle supplies the same .icns to Finder; this covers launches
		// that are not a packaged .app (go run, QA binaries).
		if err := mygo.App.Dock.SetIcon(appIconPNG); err != nil {
			log.Printf("app icon: %v", err)
		}
		a.metrics.indicators = newIndicatorViewPool()
		a.win = mygo.NewWindow(mygo.WindowOptions{Title: productName, Width: 1280, Height: 820, MinWidth: 780, MinHeight: 560, TitleBarStyle: mygo.TitleBarHiddenInset, Transparent: true, Vibrancy: mygo.VibrancySidebar, BackgroundColor: "#00000000", Content: ui.View(a.view)})
		a.win.OnEnterFullScreen(func() { a.update(func() { a.fullscreen = true }) })
		a.win.OnLeaveFullScreen(func() { a.update(func() { a.fullscreen = false }) })
		// Show after assigning the handle. This supported call avoids depending
		// on the deferred first-show callback or a later capture/getter.
		a.win.Show()
		// A recovery probe is a bounded QA launch too: it must not block on the
		// quit confirmation when it has written its evidence.
		a.installShell(*exitAfter > 0 || *recoveryProbe != "")
		mygo.App.Focus()
		a.win.Focus()
		a.win.OnFocus(func() { a.win.Invalidate() })
		a.win.OnClosed(func() {
			a.metrics.indicators.Close()
			a.releaseComposerImages()
			a.resetMessageImages()
			a.closeCompat()
			a.closeWeb()
			a.cancel()
			if a.client != nil {
				_ = a.client.Close()
			}
		})
		if *uiState != "" {
			go a.applyQAUIStateWhenReady(*uiState)
		}
		if *localRuntime {
			a.startLocalRuntime()
		} else if !a.demo {
			a.startBridge(nodeExecutable(), []string{resolveHelper(*helper)})
		}
		if *windowDiagnostics != "" {
			go func() {
				time.Sleep(200 * time.Millisecond)
				mygo.RunOnMain(func() {
					state := struct {
						PID           int            `json:"pid"`
						Visible       bool           `json:"visible"`
						Focused       bool           `json:"focused"`
						Minimized     bool           `json:"minimized"`
						Bounds        mygo.Rectangle `json:"bounds"`
						ContentBounds mygo.Rectangle `json:"contentBounds"`
					}{os.Getpid(), a.win.IsVisible(), a.win.IsFocused(), a.win.IsMinimized(), a.win.Bounds(), a.win.ContentBounds()}
					data, err := json.MarshalIndent(state, "", "  ")
					if err == nil {
						err = os.WriteFile(*windowDiagnostics, data, 0600)
					}
					if err != nil {
						log.Printf("window diagnostics: %v", err)
					}
				})
			}()
		}
		if *captureCompat != "" {
			delay := time.Second
			if *captureAfter > 0 {
				delay = *captureAfter
			}
			a.captureCompatPage(*captureCompat, delay)
		}
		if *capture != "" {
			delay := time.Second
			if *captureAfter > 0 {
				delay = *captureAfter
			}
			go func() {
				time.Sleep(delay)
				data, err := a.win.CapturePage()
				if err == nil {
					err = os.MkdirAll(filepath.Dir(*capture), 0755)
				}
				if err == nil {
					err = os.WriteFile(*capture, data, 0600)
				}
				if err != nil {
					log.Printf("capture: %v", err)
				} else {
					fmt.Printf("native capture: %s\n", *capture)
				}
			}()
		}
		if *exitAfter > 0 {
			go func() {
				select {
				case <-time.After(*exitAfter):
					mygo.App.Quit()
				case <-a.ctx.Done():
				}
			}()
		}
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
	if *metricsPath != "" {
		data, err := json.MarshalIndent(a.metrics, "", "  ")
		if err == nil {
			err = os.WriteFile(*metricsPath, data, 0600)
		}
		if err != nil {
			log.Printf("metrics: %v", err)
		}
	}
}
