// Independent next-slice host. No user identity/configuration or real Host.
package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"flag"
	"github.com/ebitengine/purego"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"log"
	native "native-dsh/desktop/composer_native"
	"native-dsh/desktop/internal/bridge"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unsafe"
)

type candidate struct{ Label, Kind, Ref, Value string }

func main() {
	timeout := flag.Duration("exit-after", 120*time.Second, "self-close interval")
	result := flag.String("result", "/tmp/native-composer-next.json", "local checks path")
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
	popup := false
	popupText := ""
	var items []candidate
	highlight := 0
	queryToken := ""
	queryStart := 0
	invalid := false
	closed := false
	var proof map[string]any
	writeProof := func() {
		if proof == nil {
			return
		}
		if _, exists := proof["appKitPassed"]; !exists {
			proof["appKitPassed"] = proof["passed"]
		}
		proof["crossLayerPassed"] = proof["lateReceiptPreservesNewDraft"] == true && proof["lateReceiptPreservesNewReferenceIdentity"] == true
		proof["passed"] = proof["appKitPassed"] == true && proof["crossLayerPassed"] == true
		b, _ := json.MarshalIndent(proof, "", "  ")
		_ = os.WriteFile(*result, b, 0600)
	}
	var ackWaiter chan struct{}
	appliedTheme := ""
	documents := map[string]native.Snapshot{}
	pending := map[string]string{}
	unknown := map[string]bool{}
	scope := map[string]any{"hostId": "composer-host", "generation": 7, "sessionId": "composer-session"}
	apply := func(command native.Command) bool {
		if editor == nil || closed {
			return false
		}
		command.Epoch = epoch
		command.DocKey = docKey
		s, e := editor.Apply(command)
		if e != nil {
			status = e.Error()
			invalid = !editor.Valid()
			return false
		}
		state = s
		invalid = false
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
		capturedEpoch, capturedDoc := epoch, docKey
		params["sessionId"] = "composer-session"
		params["clientScope"] = scope
		go func() {
			raw, e := client.Call(ctx, method, params)
			mygo.RunOnMain(func() {
				if closed || epoch != capturedEpoch || docKey != capturedDoc {
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
				apply(native.Command{Op: "completion", Open: len(items) > 0})
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
				apply(native.Command{Op: "completion", Open: len(items) > 0})
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
					apply(native.Command{Op: "completion", Open: len(items) > 0})
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
				if ackWaiter != nil {
					defer func() { close(ackWaiter); ackWaiter = nil }()
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
				if err == nil && current.CanonicalText == before {
					apply(native.Command{Op: "scope", Epoch: epoch, DocKey: docKey, Runs: []native.Run{}})
					queryToken = ""
					items = nil
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
			if appearance == "directory" {
				appearance = "folder"
			}
			apply(native.Command{Op: "replace", ExpectedCanonical: &expected, Start: start, End: end, Runs: []native.Run{{Kind: kind, ID: rand.Text(), Ref: item.Ref, Label: item.Label, Appearance: appearance, ClipboardText: item.Ref}, {Kind: "text", Text: " "}}})
		}
		queryToken = ""
		items = nil
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
	mygo.App.SetName("Native Composer Next")
	mygo.App.WhenReady(func() {
		h, e := purego.Dlopen(lib, purego.RTLD_NOW|purego.RTLD_GLOBAL)
		if e != nil {
			log.Fatal(e)
		}
		var selfTest func() unsafe.Pointer
		var length func(unsafe.Pointer) int64
		var free func(unsafe.Pointer)
		purego.RegisterLibFunc(&selfTest, h, "nd_editor_selftest")
		purego.RegisterLibFunc(&length, h, "nd_editor_length")
		purego.RegisterLibFunc(&free, h, "nd_editor_free")
		p := selfTest()
		_ = json.Unmarshal(append([]byte(nil), unsafe.Slice((*byte)(p), int(length(p)))...), &proof)
		free(p)

		editor, e = native.New(lib, func(s native.Snapshot) {
			if win == nil {
				return
			}
			win.Update(func() {
				if closed || s.Epoch != epoch || s.DocKey != docKey {
					return
				}
				if s.Invalid {
					invalid = true
					status = s.Error
					return
				}
				if s.Revision < state.Revision {
					return
				}
				state = s
				documents[docKey] = s
				invalid = false
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
		win = mygo.NewWindow(mygo.WindowOptions{Title: "Native Composer Next · fixture only", Width: 900, Height: 620, Content: ui.View(func(c *ui.Context) {
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
				if appliedTheme != desiredTheme {
					appliedTheme = desiredTheme
					if dark {
						apply(native.Command{Op: "style", Style: map[string]any{"dark": true, "foreground": "#e0e0e2", "accent": "#9cbdff", "selection": "#304970", "placeholder": "#8e8e92"}})
					} else {
						apply(native.Command{Op: "style", Style: map[string]any{"dark": false, "foreground": "#17181b", "accent": "#477be2", "selection": "#dce6fa", "placeholder": "#878a90"}})
					}
				}
				ui.NativeView(c, editor).FillWidth().Height(180).Radius(12).Border(1, theme.Border)
				if len(items) > 0 {
					ui.Column(c).FillWidth().MaxHeight(180).Padding(6).Radius(8).Background(theme.Surface).Children(func() {
						for i, item := range items {
							item := item
							b := ui.Button(c, item.Label)
							if i == highlight {
								b.Background(theme.Accent).TextColor(ui.RGB(255, 255, 255))
							}
							if b.Clicked() {
								pick(item, false)
							}
						}
					})
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
				ui.Text(c, "真实系统拼音候选/外部NativeView视觉和焦点仍待实屏验收。").FontSize(11)
			})
		})})
		win.OnClosed(func() { closed = true; editor.Close(); _ = client.Close() })
		win.Show()
		mygo.App.Focus()
		win.Focus()
		go func() {
			time.Sleep(200 * time.Millisecond)
			var waiter chan struct{}
			mygo.RunOnMain(func() {
				if closed {
					return
				}
				epoch = rand.Text()
				apply(native.Command{Op: "scope", Runs: []native.Run{{Kind: "text", Text: "fixture delayed image"}}})
				waiter = make(chan struct{})
				ackWaiter = waiter
				submit(state)
				proof["lateStage"] = "submitted"
				proof["lateStatus"] = status
				proof["lateCanonical"] = state.CanonicalText
				proof["latePending"] = len(pending)
			})
			if waiter == nil {
				return
			}
			calls, callErr := client.Call(ctx, "fixture.calls", map[string]any{})
			mygo.RunOnMain(func() {
				proof["lateWireCalls"] = string(calls)
				if callErr != nil {
					proof["lateWireError"] = callErr.Error()
				}
			})
			_, err := client.Call(ctx, "fixture.waitPrompt", map[string]any{})
			if err != nil {
				mygo.RunOnMain(func() {
					proof["lateError"] = err.Error()
					writeProof()
				})
				return
			}
			mygo.RunOnMain(func() {
				if closed {
					return
				}
				proof["lateStage"] = "entered-host"
				apply(native.Command{Op: "replace", Start: native.UTF16Len(state.DetectText), End: native.UTF16Len(state.DetectText), Runs: []native.Run{{Kind: "text", Text: " new edit "}, {Kind: "reference", ID: "fresh-reference-after-send", Ref: "@fresh", ClipboardText: "@fresh", Label: "Fresh file", Appearance: "file"}}})
			})
			_, _ = client.Call(ctx, "fixture.releasePrompt", map[string]any{})
			select {
			case <-waiter:
			case <-ctx.Done():
				return
			}
			mygo.RunOnMain(func() {
				if closed {
					return
				}
				proof["lateReceiptPreservesNewDraft"] = strings.Contains(state.CanonicalText, "new edit") && strings.Contains(state.CanonicalText, "@fresh")
				found := false
				for _, r := range state.Runs {
					if r.ID == "fresh-reference-after-send" {
						found = true
					}
				}
				proof["lateReceiptPreservesNewReferenceIdentity"] = found
				epoch = rand.Text()
				apply(native.Command{Op: "scope", Runs: []native.Run{}})
				queryToken = ""
				status = ""
				writeProof()
			})
		}()
		go func() {
			time.Sleep(400 * time.Millisecond)
			mygo.RunOnMain(func() {
				if closed {
					return
				}
				apply(native.Command{Op: "focus"})
				proof["goCGO"] = 0
				proof["scope"] = "actual AppKit component + actual Go->RemoteAdapter mockHost; no network/identity"
				writeProof()
			})
		}()
		go func() { time.Sleep(*timeout); mygo.App.Quit() }()
	})
	if e := mygo.App.Run(); e != nil {
		log.Fatal(e)
	}
}
