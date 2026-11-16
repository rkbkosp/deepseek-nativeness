package main

import (
	"context"
	"encoding/json"
	"github.com/egoist/mygo/ui"
	"native-dsh/desktop/internal/bridge"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type composerTestPeer struct {
	a       *app
	updates chan func()
	ctx     context.Context
}

func newComposerTestPeer(t *testing.T) *composerTestPeer {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	file, _ := filepath.Abs("qa/composer-wire-fixture.mjs")
	client, err := bridge.Start(ctx, node, file)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	a := newApp(false)
	t.Cleanup(a.cancel)
	a.ctx = ctx
	a.client = client
	a.connected = true
	a.hostID = "composer-host"
	a.sessionID = "composer-session"
	a.remoteGeneration = 7
	a.current.SessionID = a.sessionID
	a.operationCaps = map[string]operationCapability{}
	for _, name := range []string{"executeCommand", "updateQueue", "listFileReferences", "modelCatalog"} {
		a.operationCaps[name] = operationCapability{Supported: true}
	}
	updates := make(chan func(), 64)
	a.testDispatch = func(fn func()) { updates <- fn }
	a.composer = &composerState{hostID: a.hostID, sessionID: a.sessionID, generation: a.remoteGeneration}
	return &composerTestPeer{a, updates, ctx}
}
func (f *composerTestPeer) settle(t *testing.T) {
	t.Helper()
	for f.a.pendingRequests > 0 {
		select {
		case fn := <-f.updates:
			fn()
		case <-f.ctx.Done():
			t.Fatal(f.ctx.Err())
		}
	}
}
func (f *composerTestPeer) until(t *testing.T, condition func() bool) {
	t.Helper()
	for !condition() {
		select {
		case fn := <-f.updates:
			fn()
		case <-f.ctx.Done():
			t.Fatal(f.ctx.Err())
		}
	}
}
func (f *composerTestPeer) calls(t *testing.T) ([]struct {
	Kind, Endpoint string
	Args           map[string]json.RawMessage
}, []struct {
	Method string
	Params map[string]json.RawMessage
}) {
	t.Helper()
	raw, err := f.a.client.Call(f.ctx, "fixture.calls", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Calls []struct {
			Kind, Endpoint string
			Args           map[string]json.RawMessage
		}
		Requests []struct {
			Method string
			Params map[string]json.RawMessage
		}
	}
	if err = json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	return result.Calls, result.Requests
}
func TestComposerMarkedTextEnterCannotSendOrLeakShortcut(t *testing.T) {
	f := newComposerTestPeer(t)
	a := f.a
	global := 0
	tt := ui.NewTester(func(c *ui.Context) {
		a.composerView(c)
		if c.Shortcut(ui.Cmd, ui.KeyEnter) {
			global++
		}
	}, 900, 600)
	if err := tt.Click("消息输入框"); err != nil {
		t.Fatal(err)
	}
	tt.Compose("中文", 2)
	tt.Key(0, ui.KeyEnter)
	tt.Key(ui.Cmd, ui.KeyEnter)
	tt.Frame()
	if !a.composer.composing || a.pendingRequests != 0 || global != 0 {
		t.Fatalf("marked text escaped: composing=%v pending=%d global=%d", a.composer.composing, a.pendingRequests, global)
	}
	calls, _ := f.calls(t)
	if len(calls) != 0 {
		t.Fatal("composition sent a request")
	}
	// Type commits the actual framework marked-text path; it is not clipboard paste.
	tt.Type("中文")
	tt.Key(ui.Shift, ui.KeyEnter)
	tt.Frame()
	if !strings.Contains(a.draft, "\n") || a.pendingRequests != 0 {
		t.Fatalf("ShiftEnter did not keep newline: %q", a.draft)
	}
	tt.Key(0, ui.KeyEnter)
	f.settle(t)
	tt.Frame()
	calls, _ = f.calls(t)
	if len(calls) != 1 || calls[0].Endpoint != "session/prompt" {
		t.Fatalf("commit Enter dispatches %+v", calls)
	}
	var req struct {
		Mode    string
		Content []struct{ Text string }
	}
	if err := json.Unmarshal(calls[0].Args["request"], &req); err != nil {
		t.Fatal(err)
	}
	if req.Mode != "queue" || len(req.Content) != 1 || req.Content[0].Text != "中文" {
		t.Fatalf("wrong committed prompt %+v", req)
	}
	tt.Type("New draft")
	tt.KeyRepeat(0, ui.KeyEnter)
	tt.Frame()
	if a.pendingRequests != 0 {
		t.Fatal("held Enter repeated a submission")
	}
}
func TestComposerQueueAndSteerKeyboardFollowOriginalBusyPolicy(t *testing.T) {
	for _, tc := range []struct {
		name, pref           string
		running, accelerated bool
		want                 string
	}{{"idle-cmd", "steer", false, true, "queue"}, {"running-enter", "queue", true, false, "queue"}, {"running-cmd", "queue", true, true, "steer"}, {"running-steer-enter", "steer", true, false, "steer"}, {"running-steer-cmd", "steer", true, true, "queue"}} {
		t.Run(tc.name, func(t *testing.T) {
			f := newComposerTestPeer(t)
			a := f.a
			a.uiPrefs.SendMode = tc.pref
			a.current.Running = tc.running
			tt := ui.NewTester(a.composerView, 900, 600)
			if err := tt.Click("消息输入框"); err != nil {
				t.Fatal(err)
			}
			tt.Type("Fixture only")
			mods := ui.Modifiers(0)
			if tc.accelerated {
				mods = ui.Cmd
			}
			tt.Key(mods, ui.KeyEnter)
			f.settle(t)
			calls, requests := f.calls(t)
			if len(calls) != 1 {
				t.Fatalf("dispatch count %d", len(calls))
			}
			var req struct{ Mode string }
			_ = json.Unmarshal(calls[0].Args["request"], &req)
			if req.Mode != tc.want {
				t.Fatalf("mode=%s want %s", req.Mode, tc.want)
			}
			var scope struct {
				HostID, SessionID string
				Generation        uint64
			}
			_ = json.Unmarshal(requests[0].Params["clientScope"], &scope)
			if scope.HostID != a.hostID || scope.SessionID != a.sessionID || scope.Generation != 7 {
				t.Fatalf("intent missing captured scope %+v", scope)
			}
		})
	}
}
func TestComposerProjectionBaselineLabelsAndOutOfOrderProtection(t *testing.T) {
	f := newComposerTestPeer(t)
	a := f.a
	a.reloadComposer()
	f.until(t, func() bool {
		return len(a.composer.commands) == 2 && len(a.composer.permissions) == 4 && a.composer.values.Permissions != nil && strings.Contains(a.composerModelLabel(), "Fixture Model")
	})
	if a.composerPermissionLabel() != "工作区内修改" || a.composerModelLabel() != "Fixture Model Default" {
		t.Fatalf("labels %q / %q", a.composerPermissionLabel(), a.composerModelLabel())
	}
	_ = a.acceptComposerProjections(json.RawMessage(`{"kind":"sequenced","asOfSeq":12,"values":{"permissions":{"currentValue":"read-only"},"inbox":{"next-turn":[]},"modelSelection":{}}}`))
	_ = a.acceptComposerProjections(json.RawMessage(`{"kind":"sequenced","asOfSeq":11,"values":{"permissions":{"currentValue":"danger-full-access"}}}`))
	if a.composerPermissionLabel() != "仅可查看" || len(a.composer.values.Inbox["next-turn"]) != 0 || a.composer.values.ModelSelection.Next != nil {
		t.Fatal("stale baseline or missing fields retained old selection/queue")
	}
	prior := a.composer
	a.hostID = "another-host"
	if a.composerCurrent(prior) {
		t.Fatal("cross-Host state remains current")
	}
}
func TestComposerFileMentionGrammarAndSelectionPreserveTail(t *testing.T) {
	for _, tc := range []struct {
		text, kind, token string
		caret, start      int
	}{{"请看 @\"中文 file", "file", "@\"中文 file", 12, 3}, {"email@example.com", "", "", 17, 17}, {"x @docs", "file", "@docs", 7, 2}, {"/per", "command", "/per", 4, 0}} {
		kind, token, start := composerActiveToken(tc.text, tc.caret)
		if kind != tc.kind || token != tc.token || start != tc.start {
			t.Fatalf("%q: %q %q %d", tc.text, kind, token, start)
		}
	}
	if mention, ok := composerFileMention("with space", "directory", false); !ok || mention != "@\"with space/" {
		t.Fatalf("directory quote %q", mention)
	}
	if _, ok := composerFileMention("unsafe\"name", "file", false); ok {
		t.Fatal("unrepresentable quote was accepted")
	}
	s := &composerState{completionStart: 2, completionEnd: 6, completionToken: "@doc", completions: []composerCompletion{{Replacement: "@docs/readme.md "}}}
	text, caret, ok := composerComplete(s, "看 @doc 后文")
	if !ok || text != "看 @docs/readme.md  后文" || caret != 18 {
		t.Fatalf("replacement %q %d %v", text, caret, ok)
	}
	if _, _, ok = composerComplete(s, "New edit"); ok {
		t.Fatal("stale replacement overwrote another draft")
	}
}
func TestComposerCommandUnknownPreservesDraftAndDoesNotRedispatch(t *testing.T) {
	f := newComposerTestPeer(t)
	a := f.a
	a.draft = "/unknown"
	a.composerSubmit(false)
	f.settle(t)
	if a.draft != "/unknown" || len(a.mutations) != 1 {
		t.Fatal("unknown command discarded draft/intent")
	}
	a.composerSubmit(false)
	f.settle(t)
	calls, _ := f.calls(t)
	if len(calls) != 1 {
		t.Fatal("unknown command replayed under another key")
	}
}
func TestComposerPermissionRequiresAcknowledgementAndUsesCommandWriter(t *testing.T) {
	f := newComposerTestPeer(t)
	a := f.a
	a.reloadComposer()
	f.until(t, func() bool { return len(a.composer.permissions) == 4 && a.composer.values.Permissions != nil })
	s := a.composer
	a.chooseComposerPermission(s, "danger-full-access")
	if s.confirmPermission != "danger-full-access" || s.permissionAcknowledged {
		t.Fatal("risk gate missing")
	}
	calls, _ := f.calls(t)
	for _, call := range calls {
		if call.Kind == "write" {
			t.Fatal("risk choice wrote before confirmation")
		}
	}
	a.chooseComposerPermission(s, "read-only")
	f.settle(t)
	calls, _ = f.calls(t)
	last := calls[len(calls)-1]
	if last.Endpoint != "commands/execute" || string(last.Args["line"]) != `"/permission read-only"` {
		t.Fatalf("permission dispatch %+v", last)
	}
}

// The frozen Host answers `commands/execute` with the settled execution, not the
// Web client's `{matched}` shorthand: a settled command consumes the draft, and
// only an answer without a value reports an unknown command.
func TestComposerCommandAdmissionReadsTheHostExecutionValue(t *testing.T) {
	f := newComposerTestPeer(t)
	a := f.a
	a.reloadComposer()
	f.until(t, func() bool { return a.composer.values.Permissions != nil })
	a.draft = "/unresolved"
	a.composerSubmit(false)
	f.settle(t)
	if a.draft != "/unresolved" {
		t.Fatal("unresolved command discarded its draft")
	}
	if !strings.Contains(a.error, "主机未识别此指令：/unresolved") {
		t.Fatalf("unresolved command reported %q", a.error)
	}
	a.error = ""
	a.draft = "/permission read-only"
	a.composerSubmit(false)
	f.settle(t)
	f.until(t, func() bool { return a.composerPermissionLabel() == "仅可查看" })
	if a.draft != "" || a.error != "" {
		t.Fatalf("settled command kept draft %q and error %q", a.draft, a.error)
	}
}
func TestComposerPendingQueueActionsAndAcceleratedEmptyDraft(t *testing.T) {
	f := newComposerTestPeer(t)
	a := f.a
	a.current.Running = true
	a.reloadComposer()
	f.until(t, func() bool { return len(a.composer.values.Inbox["next-turn"]) == 2 })
	a.composerQueueAction("q1", map[string]any{"kind": "edit", "content": []any{map[string]any{"type": "text", "text": "Edited locally in fixture"}}})
	f.settle(t)
	a.composerSubmit(true)
	f.settle(t)
	calls, _ := f.calls(t)
	writes := 0
	for _, call := range calls {
		if call.Kind != "write" {
			continue
		}
		writes++
		if call.Endpoint != "session/updateQueue" {
			t.Fatalf("queue gesture used %s", call.Endpoint)
		}
	}
	if writes != 3 {
		t.Fatalf("wanted edit+2 sequential steer, got %d", writes)
	}
}

func TestComposerKeyboardCompletionCaretAndUndoRedo(t *testing.T) {
	for _, tc := range []struct {
		name, text, expected string
		caret                int
		file                 bool
	}{{"command-end", "/per", "/permission ", 4, false}, {"command-middle", "/per tail", "/permission  tail", 4, false}, {"unicode-file-middle", "看 @doc 尾巴", "看 @\"docs/中文 file.md\"  尾巴", 6, true}} {
		t.Run(tc.name, func(t *testing.T) {
			f := newComposerTestPeer(t)
			a := f.a
			a.composer.commands = []composerCommand{{Name: "permission"}}
			tt := ui.NewTester(a.composerView, 900, 600)
			if err := tt.Click("消息输入框"); err != nil {
				t.Fatal(err)
			}
			tt.Type(tc.text)
			tt.Key(ui.Cmd, ui.KeyLeft)
			for i := 0; i < tc.caret; i++ {
				tt.Key(0, ui.KeyRight)
			}
			if tc.file {
				f.until(t, func() bool { return len(a.composer.completions) > 0 })
				tt.Frame()
			}
			tt.Key(0, ui.KeyTab)
			tt.Frame()
			if a.draft != tc.expected {
				t.Fatalf("completion text %q want %q", a.draft, tc.expected)
			}
			completedCaret := a.composer.caret
			if completedCaret != len([]rune(tc.expected))-len([]rune(string([]rune(tc.text)[tc.caret:]))) {
				t.Fatalf("completion caret %d", completedCaret)
			}
			tt.Key(ui.Cmd, ui.KeyZ)
			tt.Frame()
			if a.draft != tc.text {
				t.Fatalf("Undo removed typed draft: %q want %q", a.draft, tc.text)
			}
			tt.Key(ui.Cmd|ui.Shift, ui.KeyZ)
			tt.Frame()
			if a.draft != tc.expected || a.composer.caret != completedCaret {
				t.Fatalf("Redo text/caret %q @%d want @%d", a.draft, a.composer.caret, completedCaret)
			}
			tt.Type("X")
			want := string([]rune(tc.expected)[:completedCaret]) + "X" + string([]rune(tc.expected)[completedCaret:])
			if a.draft != want {
				t.Fatalf("typed inside completion: %q want %q", a.draft, want)
			}
		})
	}
}

func TestComposerAcceptedCommandSettlesOriginalDraftAcrossHostAndAccountSwitch(t *testing.T) {
	f := newComposerTestPeer(t)
	a := f.a
	a.accountScope = "account-a"
	a.composer.accountScope = a.accountScope
	a.draft = "/help"
	key := a.viewKey(a.sessionID)
	a.drafts = map[string]string{key: a.draft}
	a.composerSubmit(false)
	a.hostID = "another-host"
	a.accountScope = "account-b"
	a.draft = "/help"
	otherKey := a.viewKey(a.sessionID)
	a.drafts[otherKey] = a.draft
	f.settle(t)
	if a.drafts[key] != "" || a.drafts[otherKey] != "/help" || a.draft != "/help" {
		t.Fatal("accepted command cleared new scope or retained already executed original draft")
	}
}

func TestComposerClientEffectsDoNotMasqueradeAsHostCommandSuccess(t *testing.T) {
	f := newComposerTestPeer(t)
	a := f.a
	for _, line := range []string{"/export", "/model", "/model anything", "/file", "/feedback", "/permission"} {
		a.draft = line
		a.composerSubmit(false)
		if a.draft != line || a.pendingRequests != 0 || a.composer.error == "" {
			t.Fatalf("client-only effect dispatched/consumed %q", line)
		}
	}
	calls, _ := f.calls(t)
	if len(calls) != 0 {
		t.Fatal("unfulfilled client effect reached Host")
	}
	for _, line := range []string{"/permission read-only", "/plan off", "/goal inspect only", "/feedback fixture remark"} {
		if reason := composerCommandBoundary(line); reason != "" {
			t.Fatalf("genuine Host command incorrectly blocked %q: %s", line, reason)
		}
	}
}

func TestComposerRenderingNewNavigationTargetDoesNotReadBeforePeerOpen(t *testing.T) {
	f := newComposerTestPeer(t)
	a := f.a
	a.sessionID = "target-not-opened-yet"
	a.composer = nil
	tt := ui.NewTester(a.composerView, 900, 600)
	tt.Frame()
	_, requests := f.calls(t)
	if len(requests) != 0 {
		t.Fatalf("render raced helper selection: %+v", requests)
	}
	if a.composer == nil || a.composer.error != "" {
		t.Fatal("render did not prepare a clean readless scope")
	}
}
func TestComposerFreshReloadRejectsLateStaleReadError(t *testing.T) {
	f := newComposerTestPeer(t)
	a := f.a
	a.sessionID = "target-not-opened-yet"
	s := &composerState{hostID: a.hostID, sessionID: a.sessionID, generation: a.remoteGeneration}
	a.composer = s
	// Force the real adapter to reject an early scoped read against its prior
	// selected session, then retain that callback until after the successful open.
	a.composerRead(s, "sessionProjections", nil, a.acceptComposerProjections)
	var staleCallback func()
	select {
	case staleCallback = <-f.updates:
	case <-f.ctx.Done():
		t.Fatal(f.ctx.Err())
	}
	if _, err := a.client.Call(f.ctx, "fixture.select", map[string]any{"sessionId": a.sessionID}); err != nil {
		t.Fatal(err)
	}
	s.error = "Previous read error"
	a.reloadComposer()
	staleCallback()
	f.until(t, func() bool {
		return len(s.commands) == 2 && len(s.permissions) == 4 && s.values.Permissions != nil && strings.Contains(a.composerModelLabel(), "Fixture Model")
	})
	if s.error != "" {
		t.Fatalf("old rejected read polluted fresh same-target baseline: %s", s.error)
	}
}
func TestComposerModelTriggerDoesNotAppendProviderAndKeepsDefaultEffort(t *testing.T) {
	for _, tc := range []struct{ name, reasoning, selectedEffort, want string }{{"provider-default", `,"reasoning":{"efforts":[]}`, "", "DeepSeek-Flash · Qoder CN Default"}, {"named-effort", `,"reasoning":{"defaultEffort":"high","efforts":[{"id":"high","name":"High"}]}`, "", "DeepSeek-Flash · Qoder CN High"}, {"retained-effort", "", "Retained", "DeepSeek-Flash · Qoder CN Retained"}} {
		t.Run(tc.name, func(t *testing.T) {
			s := &composerState{}
			raw := `{"default":{"provider":"provider-alias","model":"flash","reasoningEffort":"` + tc.selectedEffort + `"},"groups":[{"id":"provider-alias","name":"Magpie","models":[{"id":"flash","name":"DeepSeek-Flash · Qoder CN"` + tc.reasoning + `}]}]}`
			if err := json.Unmarshal([]byte(raw), &s.catalog); err != nil {
				t.Fatal(err)
			}
			s.refreshLabels()
			if s.modelLabel != tc.want {
				t.Fatalf("trigger %q want %q", s.modelLabel, tc.want)
			}
		})
	}
}
