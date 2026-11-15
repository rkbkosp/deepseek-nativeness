package main

// Capturing what a compatibility page actually shows.
//
// A compatibility page lives in its own web view, and the window capture only
// reaches the native layer plus the main view — the hosted page comes out
// black. Visual acceptance of those pages therefore has to ask the page's own
// view for its snapshot, which is what --capture-compat does. Like the other QA
// switches it changes nothing unless it is given a path.

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/egoist/mygo"
)

// captureCompatPage writes the compatibility view's own snapshot. It reports
// whether there was one to capture, so a run that expected a page and got none
// is visible in the log instead of silently producing nothing.
func (a *app) captureCompatPage(path string, delay time.Duration) {
	go func() {
		time.Sleep(delay)
		var view *mygo.WebView
		ready := make(chan struct{})
		mygo.RunOnMain(func() {
			view = a.compat
			close(ready)
		})
		<-ready
		if view == nil {
			log.Printf("capture-compat: no compatibility page is open")
			return
		}
		data, err := view.CapturePage()
		if err == nil {
			err = os.MkdirAll(filepath.Dir(path), 0o755)
		}
		if err == nil {
			err = os.WriteFile(path, data, 0o600)
		}
		if err != nil {
			log.Printf("capture-compat: %v", err)
			return
		}
		fmt.Printf("compat capture: %s\n", path)
	}()
}
