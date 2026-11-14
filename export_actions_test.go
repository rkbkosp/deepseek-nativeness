package main

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/egoist/mygo/ui"
	"native-dsh/desktop/internal/bridge"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type markdownCopyFixture struct {
	a       *app
	ctx     context.Context
	client  *bridge.Client
	updates chan func()
	writes  []string
}

func newMarkdownCopyFixture(t *testing.T) *markdownCopyFixture {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	script, _ := filepath.Abs("internal/fixtures/markdown-copy-proxy.mjs")
	client, err := bridge.Start(ctx, node, script)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	f := &markdownCopyFixture{ctx: ctx, client: client, updates: make(chan func(), 32)}
	var status struct {
		HostID               string
		ConnectionGeneration uint64
	}
	_ = json.Unmarshal(f.call(t, "connect", map[string]any{"hostId": "fixture-host"}), &status)
	f.call(t, "openSession", map[string]any{"sessionId": "fixture-session"})
	a := newApp(false)
	t.Cleanup(a.cancel)
	a.client = client
	a.connected = true
	a.hostID = status.HostID
	a.remoteGeneration = status.ConnectionGeneration
	a.sessionID = "fixture-session"
	a.accountScope = "fixture-account"
	a.operationCaps = map[string]operationCapability{"exportSessionMarkdown": {Supported: true}}
	a.current = snapshot{SessionID: a.sessionID}
	a.testDispatch = func(fn func()) { f.updates <- fn }
	a.testMarkdownClipboard = func(text string) error { f.writes = append(f.writes, text); return nil }
	f.a = a
	t.Cleanup(a.cancelSessionMarkdownCopy)
	return f
}
func (f *markdownCopyFixture) call(t *testing.T, method string, p any) json.RawMessage {
	t.Helper()
	raw, err := f.client.Call(f.ctx, method, p)
	if err != nil {
		t.Fatalf("%s: %v", method, err)
	}
	return raw
}
func (f *markdownCopyFixture) update(t *testing.T) {
	t.Helper()
	select {
	case fn := <-f.updates:
		fn()
	case <-f.ctx.Done():
		t.Fatal(f.ctx.Err())
	}
}
func (f *markdownCopyFixture) wait(t *testing.T, method string, predicate func(map[string]json.RawMessage) bool) {
	t.Helper()
	for {
		var s map[string]json.RawMessage
		if json.Unmarshal(f.call(t, method, map[string]any{}), &s) != nil {
			t.Fatal("invalid fixture stats")
		}
		if predicate(s) {
			return
		}
		select {
		case <-f.ctx.Done():
			t.Fatal(f.ctx.Err())
		case <-time.After(time.Millisecond):
		}
	}
}
func statInt(s map[string]json.RawMessage, key string) int {
	var n int
	_ = json.Unmarshal(s[key], &n)
	return n
}
func proxyCount(s map[string]json.RawMessage, key string) int {
	var counts map[string]int
	_ = json.Unmarshal(s["counts"], &counts)
	return counts[key]
}
func (f *markdownCopyFixture) ownersRetired(t *testing.T) {
	f.wait(t, "fixtureStats", func(s map[string]json.RawMessage) bool {
		return statInt(s, "activeOwners") == 0 && statInt(s, "heldRegistrations") == 0
	})
}

func TestFullMarkdownHeaderMenuCopiesThroughActualHelperAndReleasesOwner(t *testing.T) {
	f := newMarkdownCopyFixture(t)
	tt := ui.NewTester(f.a.view, 1280, 820)
	tt.Frame()
	if err := tt.Click("会话更多操作"); err != nil {
		t.Fatal(err)
	}
	if err := tt.ChooseMenuItem("复制会话为 Markdown"); err != nil {
		t.Fatal(err)
	}
	f.a.copySessionMarkdown() // repeated click joins the captured operation
	f.update(t)
	f.update(t)
	tt.Frame()
	if len(f.writes) != 1 || !strings.HasPrefix(f.writes[0], "# 完整Markdown协议夹具\n") || !strings.Contains(f.writes[0], "> 请保留界面风格和动效。") {
		t.Fatal("complete formatter output did not reach the isolated clipboard once")
	}
	if !tt.HasText("Session 已复制为 Markdown") {
		t.Fatal("copy success notice missing")
	}
	if f.a.markdownCopy != nil {
		t.Fatal("settled copy kept its pending state")
	}
	f.ownersRetired(t)
	f.wait(t, "fixtureProxyStats", func(s map[string]json.RawMessage) bool {
		return proxyCount(s, "exportSessionMarkdown") == 1 && proxyCount(s, "registerOwner") == 1
	})
}
func TestFullMarkdownLateRegistrationAfterCancelCreatesNoReadOrClipboard(t *testing.T) {
	f := newMarkdownCopyFixture(t)
	f.call(t, "fixtureHoldOwnerRegistration", map[string]any{"hold": true})
	f.a.copySessionMarkdown()
	f.wait(t, "fixtureStats", func(s map[string]json.RawMessage) bool { return statInt(s, "heldRegistrations") == 1 })
	f.a.cancelSessionMarkdownCopy()
	f.wait(t, "fixtureProxyStats", func(s map[string]json.RawMessage) bool { return proxyCount(s, "closeOwnerStreams") >= 1 })
	f.call(t, "fixtureHoldOwnerRegistration", map[string]any{"hold": false})
	f.wait(t, "fixtureProxyStats", func(s map[string]json.RawMessage) bool { return proxyCount(s, "closeOwnerStreams") >= 2 })
	f.ownersRetired(t)
	var stats map[string]json.RawMessage
	_ = json.Unmarshal(f.call(t, "fixtureProxyStats", map[string]any{}), &stats)
	if proxyCount(stats, "exportSessionMarkdown") != 0 || len(f.writes) != 0 {
		t.Fatal("late owner registration read data or wrote clipboard")
	}
}
func TestFullMarkdownLateReadAndQueuedUICallbackCannotCopyAcrossCapturedScopes(t *testing.T) {
	for _, change := range []string{"account", "host", "generation", "session", "client", "window"} {
		t.Run(change, func(t *testing.T) {
			f := newMarkdownCopyFixture(t)
			f.call(t, "fixtureProxyControl", map[string]any{"holdExportResults": true})
			f.a.copySessionMarkdown()
			f.update(t)
			f.wait(t, "fixtureProxyStats", func(s map[string]json.RawMessage) bool { return statInt(s, "heldResults") == 1 })
			// Deliver a real helper result into Go, then change UI scope before its queued completion runs.
			f.call(t, "fixtureProxyControl", map[string]any{"holdExportResults": false})
			var completion func()
			select {
			case completion = <-f.updates:
			case <-f.ctx.Done():
				t.Fatal(f.ctx.Err())
			}
			switch change {
			case "account":
				f.a.accountScope = "other"
			case "host":
				f.a.hostID = "other"
			case "generation":
				f.a.remoteGeneration++
			case "session":
				f.a.sessionID = "other"
			case "client":
				f.a.client = nil
			case "window":
				f.a.cancel()
			}
			tt := ui.NewTester(f.a.view, 1280, 820)
			tt.Frame()
			completion()
			if len(f.writes) != 0 || f.a.copyNotice != "" {
				t.Fatal("a retired complete read reached clipboard/notice")
			}
			f.ownersRetired(t)
		})
	}
}
func TestFullMarkdownClipboardFailureDoesNotReportSuccessAndStillReleasesOwner(t *testing.T) {
	f := newMarkdownCopyFixture(t)
	f.a.testMarkdownClipboard = func(string) error { return errors.New("fixture clipboard unavailable") }
	f.a.copySessionMarkdown()
	f.update(t)
	f.update(t)
	if f.a.copyNotice != "无法写入剪贴板，请检查剪贴板权限后重试" {
		t.Fatalf("wrong notice %q", f.a.copyNotice)
	}
	if len(f.writes) != 0 {
		t.Fatal("system clipboard sink should not run")
	}
	f.ownersRetired(t)
}

func TestFullMarkdownCancelWhileReadResponseIsHeldDiscardsLateBody(t *testing.T) {
	f := newMarkdownCopyFixture(t)
	f.call(t, "fixtureProxyControl", map[string]any{"holdExportResults": true})
	f.a.copySessionMarkdown()
	f.update(t)
	f.wait(t, "fixtureProxyStats", func(s map[string]json.RawMessage) bool { return statInt(s, "heldResults") == 1 })
	f.a.cancelSessionMarkdownCopy()
	f.ownersRetired(t)
	f.call(t, "fixtureProxyControl", map[string]any{"holdExportResults": false})
	// The actual helper response is late; a canceled Call/context cannot publish it.
	select {
	case fn := <-f.updates:
		fn()
	case <-time.After(20 * time.Millisecond):
	}
	if len(f.writes) != 0 || f.a.copyNotice != "" || f.a.markdownCopy != nil {
		t.Fatal("canceled read published late text or kept a live intent")
	}
}
func TestFullMarkdownUnavailableCapabilityCannotReachClipboardOrHelper(t *testing.T) {
	f := newMarkdownCopyFixture(t)
	f.a.operationCaps["exportSessionMarkdown"] = operationCapability{Supported: false, Reason: "not granted"}
	tt := ui.NewTester(f.a.view, 1280, 820)
	tt.Frame()
	if err := tt.Click("会话更多操作"); err != nil {
		t.Fatal(err)
	}
	if err := tt.ChooseMenuItem("复制会话为 Markdown"); err == nil {
		t.Fatal("unavailable complete copy action was enabled")
	}
	f.a.copySessionMarkdown()
	var stats map[string]json.RawMessage
	_ = json.Unmarshal(f.call(t, "fixtureProxyStats", map[string]any{}), &stats)
	if proxyCount(stats, "registerOwner") != 0 || proxyCount(stats, "exportSessionMarkdown") != 0 || len(f.writes) != 0 {
		t.Fatal("unavailable action performed a read or clipboard write")
	}
}
