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
	theme := flag.String("theme", "", "client appearance: system, light, dark")
	windowDiagnostics := flag.String("window-diagnostics", "", "write this client's own window visibility and bounds after startup")
	document := flag.String("demo-document", "", "explicit demo only: long or table native render regression")
	listClip := flag.Bool("qa-list-clip", false, "explicit demo only: reproduce redundant list clip")
	defaultTables := flag.Bool("qa-default-tables", false, "explicit demo only: use framework table renderer")
	demoPane := flag.Bool("demo-right-pane", false, "explicit demo only: constrain conversation with right pane")
	fontCalibration := flag.Bool("font-calibration", false, "explicit demo only: compare native font weights at the original 14 DIP")
	flag.Parse()
	a := newApp(*demo)
	if a.demo {
		a.fontCalibration = *fontCalibration
		a.rightPaneOpen = *demoPane
		a.qaListClip = *listClip
		if *defaultTables {
			a.md.Block = nil
		}
		if *document != "" {
			a.current.Messages = []message{{ID: "render-fixture", Role: "assistant", Kind: "assistant", Text: renderFixture(*document)}}
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
				title = "Native DSH Remote · 界面回放"
				a.sessionID = id
				a.current.SessionID = id
			}
			a.sessions = append(a.sessions, session{ID: id, Title: title, Running: i < *running, WorkspaceID: "demo-workspace"})
		}
		a.current.Running = *running > 0
		if *document == "images" {
			a.installImageFixture()
		}
	}
	mygo.App.SetName("Native DSH Remote")
	mygo.App.WhenReady(func() {
		a.systemDark = mygo.Theme.IsDark()
		mygo.Theme.OnUpdated(func() { a.update(func() { a.systemDark = mygo.Theme.IsDark() }) })
		a.win = mygo.NewWindow(mygo.WindowOptions{Title: "Native DSH Remote", Width: 1280, Height: 820, MinWidth: 780, MinHeight: 560, TitleBarStyle: mygo.TitleBarHiddenInset, Transparent: true, Vibrancy: mygo.VibrancySidebar, BackgroundColor: "#00000000", Content: ui.View(a.view)})
		// Show after assigning the handle. This supported call avoids depending
		// on the deferred first-show callback or a later capture/getter.
		a.win.Show()
		mygo.App.Focus()
		a.win.Focus()
		a.win.OnFocus(func() { a.win.Invalidate() })
		a.win.OnClosed(func() {
			a.releaseComposerImages()
			a.resetMessageImages()
			a.closeCompat()
			a.closeWeb()
			a.cancel()
			if a.client != nil {
				_ = a.client.Close()
			}
		})
		if !a.demo {
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
		if *capture != "" {
			go func() {
				time.Sleep(time.Second)
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
