// Independent next-slice host. No user identity/configuration or real Host.
package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"flag"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"image/color"
	"log"
	native "native-dsh/desktop/composer_native"
	"native-dsh/desktop/internal/bridge"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type candidate struct{ Label, Kind, Ref, Value string }

func main() {
	timeout := flag.Duration("exit-after", 10*time.Minute, "self-close interval")
	result := flag.String("result", "/tmp/native-composer-theme-proof.json", "local checks path")
	flag.Parse()
	executable, _ := os.Executable()
	frameworks := filepath.Join(filepath.Dir(executable), "../Frameworks")
	lib := filepath.Join(frameworks, "libNativeComposer.dylib")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var client *bridge.Client
	var editor *native.Editor
	var win *mygo.Window
	var state native.Snapshot
	var status string
	docKey := "document-a"
	epoch := rand.Text()
	dark := true
	oppositeHost := false
	applyHostTheme := func() {
		hostDark := dark
		if oppositeHost {
			hostDark = !hostDark
		}
		if hostDark {
			mygo.Theme.SetSource(mygo.ThemeDark)
		} else {
			mygo.Theme.SetSource(mygo.ThemeLight)
		}
	}
	popup := false
	popupText := ""
	var items []candidate
	candidatesOpen := false
	highlight := 0
	queryToken := ""
	queryStart := 0
	invalid := false
	var invalidAfterRevision uint64
	closed := false
	proof := map[string]any{"scope": "interactive local fixture; no startup selftests or automatic draft cleanup"}
	applyCounts := map[string]int{}
	writeProof := func() {
		proof["hostCommandCounts"] = applyCounts
		proof["hostThemeSource"] = mygo.Theme.Source()
		proof["targetDark"] = dark
		b, _ := json.MarshalIndent(proof, "", "  ")
		_ = os.WriteFile(*result, b, 0600)
	}
	appliedTheme := ""
	documents := map[string]native.Snapshot{}
	pending := map[string]string{}
	unknown := map[string]bool{}
	scope := map[string]any{"hostId": "composer-host", "generation": 7, "sessionId": "composer-session"}
	apply := func(command native.Command) bool {
		if editor == nil || closed {
			return false
		}
		if command.Op == "scope" {
			command.AccountScope = "fixture-account"
		}
		if command.Op == "replace" {
			command.Op = "replaceSpan"
			version := state.SemanticRevision
			command.ExpectedSemanticRevision = &version
			command.ExpectedSemanticDigest = state.SemanticDigest
		}
		command.Epoch = epoch
		command.DocKey = docKey
		applyCounts[command.Op]++
		if proof != nil {
			proof["hostCommandCounts"] = applyCounts
		}
		s, e := editor.Apply(command)
		if e != nil {
			status = e.Error()
			invalid = !editor.Valid()
			if invalid {
				invalidAfterRevision = max(invalidAfterRevision, s.Revision)
			}
			return false
		}
		state = s
		invalid = false
		invalidAfterRevision = 0
		documents[docKey] = s
		return true
	}
	var refresh func()
	var pick func(candidate, bool)
	var submit func(native.Snapshot)
	query := func(method string, params map[string]any, done func(json.RawMessage)) {
		if client == nil {
			return
		}
		capturedEpoch, capturedDoc, capturedQuery := epoch, docKey, queryToken
		params["sessionId"] = "composer-session"
		params["clientScope"] = scope
		go func() {
			raw, e := client.Call(ctx, method, params)
			mygo.RunOnMain(func() {
				if closed || epoch != capturedEpoch || docKey != capturedDoc || queryToken != capturedQuery {
					return
				}
				if e != nil {
					status = e.Error()
				} else {
					done(raw)
				}
				win.Invalidate()
			})
		}()
	}
	refresh = func() {
		if state.Marked || invalid {
			return
		}
		at := native.RuneAtUTF16(state.DetectText, state.SelectionEnd)
		r := []rune(state.DetectText)
		prefix := string(r[:at])
		kind, token, start := "", "", 0
		if strings.HasPrefix(state.CanonicalText, "/permission ") {
			kind = "permission"
			token = "/permission "
			start = 0
		} else if strings.HasPrefix(prefix, "/") && !strings.ContainsAny(prefix, " \n\t") {
			kind = "command"
			token = prefix
		} else {
			for i := at - 1; i >= 0; i-- {
				if r[i] == '@' && (i == 0 || r[i-1] == ' ' || r[i-1] == '\n') {
					t := string(r[i:at])
					if !strings.ContainsAny(t, " \t\n") {
						kind = "reference"
						token = t
						start = i
					}
					break
				}
			}
		}
		if token == queryToken {
			return
		}
		queryToken = token
		queryStart = start
		items = nil
		candidatesOpen = false
		highlight = 0
		if token == "" {
			apply(native.Command{Op: "completion", Open: false})
			return
		}
		switch kind {
		case "permission":
			query("permissionCatalog", map[string]any{}, func(raw json.RawMessage) {
				var catalog struct {
					Options []struct{ Value, Name string }
				}
				_ = json.Unmarshal(raw, &catalog)
				for _, p := range catalog.Options {
					items = append(items, candidate{Label: p.Name, Kind: "permission", Value: p.Value})
				}
				candidatesOpen = len(items) > 0
				apply(native.Command{Op: "completion", Open: candidatesOpen})
			})
		case "command":
			query("listCommands", map[string]any{}, func(raw json.RawMessage) {
				var commands []struct{ Name string }
				_ = json.Unmarshal(raw, &commands)
				for _, c := range commands {
					if c.Name == "permission" && strings.Contains(c.Name, strings.TrimPrefix(token, "/")) {
						items = append(items, candidate{Label: "/permission", Kind: "command", Ref: "/permission"})
					}
				}
				candidatesOpen = len(items) > 0
				apply(native.Command{Op: "completion", Open: candidatesOpen})
			})
		case "reference":
			query("listSessionReferences", map[string]any{"query": strings.TrimPrefix(token, "@")}, func(raw json.RawMessage) {
				var refs []struct{ DisplayTitle, Label, Mention string }
				_ = json.Unmarshal(raw, &refs)
				for _, v := range refs {
					label := v.DisplayTitle
					if label == "" {
						label = v.Label
					}
					items = append(items, candidate{Label: label, Kind: "session", Ref: v.Mention})
				}
				query("listFileReferences", map[string]any{"query": strings.TrimPrefix(token, "@")}, func(raw json.RawMessage) {
					var files []struct{ Path, Kind string }
					_ = json.Unmarshal(raw, &files)
					for _, f := range files {
						ref := "@\"" + f.Path + "\""
						items = append(items, candidate{Label: filepath.Base(f.Path), Kind: f.Kind, Ref: ref})
					}
					candidatesOpen = len(items) > 0
					apply(native.Command{Op: "completion", Open: candidatesOpen})
				})
			})
		}
	}
	submit = func(s native.Snapshot) {
		if closed || editor == nil || !editor.Valid() || invalid || s.Marked || s.Repeat || strings.TrimSpace(s.CanonicalText) == "" {
			status = "提交已阻止：原生文本尚未同步、marked或重复键。"
			return
		}
		before, key, capturedEpoch, capturedDoc := s.CanonicalText, docKey+"\x00"+s.CanonicalText, epoch, docKey
		if unknown[key] {
			status = "上次fixture回执unknown，保留草稿且不重放。"
			return
		}
		requestID := pending[key]
		if requestID == "" {
			requestID = rand.Text()
			pending[key] = requestID
		}
		method := "sendMessage"
		params := map[string]any{"sessionId": "composer-session", "requestId": requestID, "clientScope": scope, "mode": "queue", "text": before}
		if strings.HasPrefix(before, "/permission ") {
			method = "executeCommand"
			params = map[string]any{"sessionId": "composer-session", "requestId": requestID, "clientScope": scope, "line": strings.TrimSpace(before)}
		}
		go func() {
			raw, e := client.Call(ctx, method, params)
			mygo.RunOnMain(func() {
				if closed {
					return
				}

				if e != nil {
					status = e.Error()
					return
				}
				var receipt struct{ Status string }
				_ = json.Unmarshal(raw, &receipt)
				if receipt.Status != "accepted" {
					unknown[key] = true
					status = "fixture unknown：保留原生草稿"
					return
				}
				delete(pending, key)
				status = "本地fixture已accepted；未触及真实Host"
				if epoch != capturedEpoch || docKey != capturedDoc {
					return
				}
				current, err := editor.Apply(native.Command{Op: "snapshot", Epoch: epoch, DocKey: docKey})
				if err == nil {
					version := current.SemanticRevision
					apply(native.Command{Op: "commitAccepted", RequestID: requestID, CommittedRuns: s.Runs, CommittedSemanticDigest: s.SemanticDigest, ExpectedSemanticRevision: &version, ExpectedSemanticDigest: current.SemanticDigest})
					queryToken = ""
					items = nil
					candidatesOpen = false
				}
				win.Invalidate()
			})
		}()
	}
	pick = func(item candidate, drill bool) {
		expected := state.CanonicalText
		if item.Kind == "permission" {
			line := "/permission " + item.Value
			start := 0
			if len(state.Runs) > 0 && state.Runs[0].Kind == "command" && state.Runs[0].ClipboardText == "/permission" {
				start = 1
				line = " " + item.Value
			}
			if apply(native.Command{Op: "replace", ExpectedCanonical: &expected, Start: start, End: native.UTF16Len(state.DetectText), Runs: []native.Run{{Kind: "text", Text: line}}}) {
				submit(state)
			}
			return
		}
		start, end := native.UTF16AtRune(state.DetectText, queryStart), state.SelectionEnd
		if item.Kind == "directory" && drill {
			apply(native.Command{Op: "replace", ExpectedCanonical: &expected, Start: start, End: end, Runs: []native.Run{{Kind: "text", Text: strings.TrimSuffix(item.Ref, "\"") + "/"}}})
		} else {
			kind, appearance := "reference", item.Kind
			if item.Kind == "command" {
				kind = "command"
				appearance = ""
			}
			source := ""
			if kind == "reference" {
				source = "reference"
			}
			if appearance == "directory" {
				appearance = "folder"
			}
			apply(native.Command{Op: "replace", ExpectedCanonical: &expected, Start: start, End: end, Runs: []native.Run{{Kind: kind, Source: source, ID: rand.Text(), Ref: item.Ref, Label: item.Label, Appearance: appearance, ClipboardText: item.Ref}, {Kind: "text", Text: " "}}})
		}
		queryToken = ""
		items = nil
		candidatesOpen = false
		apply(native.Command{Op: "completion", Open: false})
		apply(native.Command{Op: "focus"})
		refresh()
	}
	node := filepath.Join(filepath.Dir(executable), "../Resources/runtime/node")
	var e error
	helper := filepath.Join(filepath.Dir(executable), "../Resources/composer-wire-fixture.mjs")
	client, e = bridge.Start(ctx, node, helper)
	if e != nil {
		log.Fatal(e)
	}
	applyHostTheme()
	mygo.App.SetName("Native Composer Theme Proof")
	mygo.App.WhenReady(func() {

		editor, e = native.New(lib, func(s native.Snapshot) {
			if win == nil {
				return
			}
			win.Update(func() {
				if closed || s.Epoch != epoch || s.DocKey != docKey {
					return
				}
				if s.Revision < state.Revision {
					return
				}
				if s.Invalid {
					invalid = true
					invalidAfterRevision = max(invalidAfterRevision, s.Revision)
					status = s.Error
					return
				}
				if invalid && s.Revision <= invalidAfterRevision {
					return
				}
				state = s
				documents[docKey] = s
				invalid = false
				invalidAfterRevision = 0
				switch s.Kind {
				case "submit":
					if len(items) > 0 {
						pick(items[highlight], false)
					} else {
						submit(s)
					}
				case "completionReturn":
					if len(items) > 0 {
						pick(items[highlight], false)
					}
				case "completionKey":
					if len(items) > 0 {
						switch s.Key {
						case 125:
							highlight = (highlight + 1) % len(items)
						case 126:
							highlight = (highlight + len(items) - 1) % len(items)
						case 48:
							pick(items[highlight], true)
						case 53:
							items = nil
							candidatesOpen = false
							queryToken = ""
							apply(native.Command{Op: "completion", Open: false})
						}
					}
				default:
					refresh()
				}
			})
		})
		if e != nil {
			log.Fatal(e)
		}
		apply(native.Command{Op: "scope", Runs: []native.Run{}})
		win = mygo.NewWindow(mygo.WindowOptions{Title: "Native Composer Theme Proof · fixture only", Width: 900, Height: 620, Content: ui.View(func(c *ui.Context) {
			theme := ui.LightTheme()
			if dark {
				theme = ui.DarkTheme()
			}
			c.SetTheme(theme)
			ui.Column(c).Fill().Padding(24).Gap(10).Background(theme.Background).TextColor(theme.Text).Children(func() {
				ui.Text(c, "NSTextView原生引用/命令组件 · 本地fixture").FontSize(18)
				ui.Text(c, "无真实Host/身份/任务。仅系统输入区域为AppKit；无WK。").FontSize(12)
				ui.Row(c).Gap(8).Children(func() {
					if ui.Button(c, "文档 A/B").Clicked() {
						documents[docKey] = state
						if docKey == "document-a" {
							docKey = "document-b"
						} else {
							docKey = "document-a"
						}
						epoch = rand.Text()
						seed := documents[docKey]
						apply(native.Command{Op: "scope", Runs: seed.Runs})
						queryToken = ""
						items = nil
					}
					if ui.Button(c, "深色/浅色").Clicked() {
						dark = !dark
						applyHostTheme()
					}
					if ui.Button(c, "宿主跟随/反向").Clicked() {
						oppositeHost = !oppositeHost
						applyHostTheme()
					}
					if ui.Button(c, "清空草稿").Clicked() {
						apply(native.Command{Op: "replace", Start: 0, End: native.UTF16Len(state.DetectText), Runs: []native.Run{}})
						queryToken = ""
						items = nil
					}
					if ui.Button(c, "原生焦点").Clicked() {
						apply(native.Command{Op: "focus"})
					}
				})
				desiredTheme := "light"
				if dark {
					desiredTheme = "dark"
				}
				backing, backingErr := proofBacking(theme.Surface, theme.Background)
				if backingErr != nil {
					status = backingErr.Error()
				}
				if appliedTheme != desiredTheme && backingErr == nil {
					appliedTheme = desiredTheme
					if dark {
						apply(native.Command{Op: "style", Style: map[string]any{"dark": true, "background": backing, "foreground": "#e0e0e2", "accent": "#9cbdff", "selection": "#304970", "placeholder": "#8e8e92"}})
					} else {
						apply(native.Command{Op: "style", Style: map[string]any{"dark": false, "background": backing, "foreground": "#17181b", "accent": "#477be2", "selection": "#dce6fa", "placeholder": "#878a90"}})
					}
				}
				inputAnchor := ui.NativeView(c, editor).FillWidth().Height(180).Shrink(0).Radius(12).Border(1, theme.Border)
				panel := candidatePopup(c, inputAnchor, &candidatesOpen, items, highlight, func(item candidate) { pick(item, false) })
				if panel.Dismissed() {
					items = nil
					queryToken = ""
					apply(native.Command{Op: "completion", Open: false})
				}
				var popupAnchor ui.Element
				ui.Row(c).Gap(10).Children(func() {
					popupAnchor = ui.Button(c, "Native popup")
					if popupAnchor.Clicked() {
						popup = !popup
					}
					if ui.Button(c, "发送到本地fixture").Disabled(invalid || editor == nil || !editor.Valid()).Clicked() {
						if apply(native.Command{Op: "snapshot"}) {
							submit(state)
						}
					}
				})
				ui.Popover(c, popupAnchor, &popup, func() { ui.TextInput(c, &popupText).Label("Popup input").Width(300).AutoFocus() })
				if status != "" {
					ui.Text(c, status).Wrap().FontSize(12)
				}
				ui.Text(c, "canonical mirror: "+state.CanonicalText).MaxLines(3).FontSize(11)
				ui.Text(c, "opaque native backing: "+backing+" · host "+string(mygo.Theme.Source())).FontSize(11)
				ui.Text(c, "真实系统拼音候选/外部NativeView视觉和焦点仍待实屏验收。").FontSize(11)
			})
		})})
		win.OnClosed(func() {
			proof["hostCommandCounts"] = applyCounts
			writeProof()
			closed = true
			editor.Close()
			_ = client.Close()
		})
		win.Show()
		mygo.App.Focus()
		win.Focus()

		go func() {
			time.Sleep(400 * time.Millisecond)
			mygo.RunOnMain(func() {
				if closed {
					return
				}
				proof["goCGO"] = 0
				proof["startupSelftestsEnabled"] = false
				writeProof()
			})
		}()
		go func() { time.Sleep(*timeout); mygo.App.Quit() }()
	})
	if e := mygo.App.Run(); e != nil {
		log.Fatal(e)
	}
}

func proofBacking(token, host ui.Color) (string, error) {
	return native.OpaqueBackingToken(color.NRGBA{R: token.R, G: token.G, B: token.B, A: token.A}, color.NRGBA{R: host.R, G: host.G, B: host.B, A: host.A})
}
