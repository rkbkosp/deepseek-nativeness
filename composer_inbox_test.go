package main

import (
	"encoding/json"
	"testing"

	"github.com/egoist/mygo/ui"
)

func TestHumanInboxInputFiltersNonUserSources(t *testing.T) {
	cases := []struct {
		name   string
		source string
		want   bool
	}{
		{"human", `{"kind":"user","rpcId":"r-1"}`, true},
		{"approval notice", `{"kind":"user-approval"}`, false},
		{"runtime context", `{"kind":"runtime-context","form":"snapshot"}`, false},
		{"cross-session relay", `{"kind":"dsh-agent-message","form":"relay"}`, false},
		{"skill catalog", `{"kind":"skill-catalog"}`, false},
		{"missing", ``, false},
		{"malformed", `not json`, false},
	}
	for _, c := range cases {
		item := composerQueueItem{ID: c.name, Source: json.RawMessage(c.source)}
		if got := humanInboxInput(item); got != c.want {
			t.Errorf("%s: humanInboxInput = %v, want %v", c.name, got, c.want)
		}
	}
}

// An Inbox message that is not human input must not be echoed as a user bubble
// at the tail of the conversation, which is where the original Chat shows only
// pending steering the human just sent.
func TestNonUserNextStepInboxIsNotRenderedAsUserBubble(t *testing.T) {
	a := newApp(true)
	t.Cleanup(a.cancel)
	a.sessionID = "s"
	a.current = snapshot{SessionID: "s", Messages: []message{
		{ID: "u", Role: "user", Kind: "user", Turn: 1, Text: "跑一下测试"},
	}}
	nextStep := []composerQueueItem{
		inboxItem(t, `{"id":"notice","source":{"kind":"user-approval"},"content":[{"type":"text","text":"审批策略已更新"}]}`),
		inboxItem(t, `{"id":"context","source":{"kind":"runtime-context","form":"snapshot"},"content":[{"type":"text","text":"会话上下文快照"}]}`),
		inboxItem(t, `{"id":"relay","source":{"kind":"dsh-agent-message","form":"relay"},"content":[{"type":"text","text":"来自其他会话的注入"}]}`),
		inboxItem(t, `{"id":"steer","source":{"kind":"user","rpcId":"r-1"},"content":[{"type":"text","text":"真正的插话"}]}`),
	}
	a.composer = &composerState{sessionID: "s", values: composerProjectionValues{
		Inbox: map[string][]composerQueueItem{"next-step": nextStep},
	}}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("真正的插话") {
		t.Fatalf("human steering echo missing: %v", tt.Texts())
	}
	for _, unwanted := range []string{"审批策略已更新", "会话上下文快照", "来自其他会话的注入"} {
		if tt.HasText(unwanted) {
			t.Errorf("non-human Inbox item %q leaked into the conversation", unwanted)
		}
	}
}

func inboxItem(t *testing.T, raw string) composerQueueItem {
	t.Helper()
	var item composerQueueItem
	if err := json.Unmarshal([]byte(raw), &item); err != nil {
		t.Fatalf("decode Inbox item %s: %v", raw, err)
	}
	return item
}
