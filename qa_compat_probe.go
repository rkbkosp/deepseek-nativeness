package main

// Diagnostics for a compatibility page that renders nothing.
//
// A blank compatibility page is indistinguishable from a capture limitation, a
// route that failed to load, and a page whose JavaScript threw: MyGo exposes no
// console hook, and the app's own window capture cannot say which. With
// NATIVE_DSH_COMPAT_PROBE=<path> set, every compatibility page reports what its
// document actually contains — ready state, DOM size, visible text, and the
// errors the loader recorded — and the result is appended to that file. This is
// QA only: nothing here runs unless the variable names a path.

import (
	"encoding/json"
	"log"
	"os"
	"time"

	"github.com/egoist/mygo"
)

const compatProbeEnv = "NATIVE_DSH_COMPAT_PROBE"

// compatProbeReport is one page's self-description.
type compatProbeReport struct {
	At       string `json:"at"`
	Page     string `json:"page"`
	Owner    string `json:"owner,omitempty"`
	Ready    any    `json:"readyState"`
	Title    any    `json:"title"`
	HTMLLen  any    `json:"htmlLength"`
	TextLen  any    `json:"textLength"`
	RootKids any    `json:"rootChildren"`
	BodyText any    `json:"bodyText"`
	Error    any    `json:"lastError"`
	EvalErr  string `json:"evalError,omitempty"`
}

// compatProbeScript asks the document what it rendered. The compatibility
// bundle records transport and render failures on window.__nativeDSHPageError;
// a page that failed before that hook exists simply reports an empty document.
const compatProbeScript = `
const err = window.__nativeDSHPageError ?? window.__dshCompatError ?? null;
const text = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
return {
  readyState: document.readyState,
  title: document.title,
  htmlLength: document.documentElement?.outerHTML?.length ?? 0,
  textLength: text.length,
  rootChildren: document.getElementById("root")?.childElementCount ?? -1,
  bodyText: text.slice(0, 300),
  lastError: err === null ? null : String(err && (err.stack || err.message || err)),
};
`

// probeCompatPage schedules one report after the page has had time to render.
// It is called from the page-creation path, which runs on the main thread, so
// the evaluation happens on its own goroutine; Eval itself is thread-safe.
func (a *app) probeCompatPage(page string, owner string) {
	path := os.Getenv(compatProbeEnv)
	if path == "" {
		return
	}
	target := page
	go func() {
		// Give the route a moment to fetch its first data and render.
		time.Sleep(8 * time.Second)
		view := a.compat
		if view == nil {
			return
		}
		report := compatProbeReport{At: time.Now().UTC().Format(time.RFC3339), Page: target, Owner: owner}
		raw, err := view.Page().Eval(compatProbeScript)
		if err != nil {
			report.EvalErr = err.Error()
		} else if record, ok := raw.(map[string]any); ok {
			report.Ready = record["readyState"]
			report.Title = record["title"]
			report.HTMLLen = record["htmlLength"]
			report.TextLen = record["textLength"]
			report.RootKids = record["rootChildren"]
			report.BodyText = record["bodyText"]
			report.Error = record["lastError"]
		}
		line, err := json.Marshal(report)
		if err != nil {
			return
		}
		if err := appendLine(path, string(line)); err != nil {
			log.Printf("compat probe: %v", err)
			return
		}
		log.Printf("compat probe: %s ready=%v text=%v root=%v", report.Page, report.Ready, report.TextLen, report.RootKids)
	}()
}

// appendLine adds one JSON line, so several pages can share one report file.
func appendLine(path, line string) error {
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer func() { _ = file.Close() }()
	_, err = file.WriteString(line + "\n")
	return err
}

var _ = mygo.RunOnMain
