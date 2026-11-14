package main

import (
	"encoding/json"
	"testing"
)

func TestChatRowsCacheSeesActualTextDeltaWithoutRebuildingHistory(t *testing.T) {
	a := &app{uiPrefs: defaultViewPreferences(), sessionID: "s", current: snapshot{SessionID: "s", Messages: []message{{ID: "context", Kind: "context", Turn: 1}, {ID: "answer", Role: "assistant", Kind: "assistant", Text: "Hello", Turn: 1}}}}
	before := a.chatRows()
	cache := a.chatRowsCache
	raw := json.RawMessage(`{"sessionId":"s","messageId":"answer","textAppend":" world","streaming":true}`)
	if err := a.applyIncremental("messageDelta", raw); err != nil {
		t.Fatal(err)
	}
	after := a.chatRows()
	if a.chatRowsCache != cache || &before[0] != &after[0] || after[1].Messages[0].Text != "Hello world" || !after[1].Messages[0].Streaming {
		t.Fatal("cached rows must retain fresh arena values", after)
	}
	if err := a.applyIncremental("messageUpsert", json.RawMessage(`{"sessionId":"s","message":{"id":"answer","kind":"context","text":"new source","turn":1}}`)); err != nil {
		t.Fatal(err)
	}
	if rows := a.chatRows(); a.chatRowsCache == cache || len(rows) != 1 || len(rows[0].Messages) != 2 {
		t.Fatal("semantic upsert must rebuild groups", rows)
	}
	a.clearMain()
	if a.chatRowsCache != nil {
		t.Fatal("navigation retains old message arena")
	}
}
func TestChatRowsSkippedToolCarrierGroupRefreshAndFutureUserFold(t *testing.T) {
	a := &app{uiPrefs: defaultViewPreferences(), sessionID: "s", current: snapshot{SessionID: "s", Messages: []message{{ID: "a", Kind: "context", Turn: 1}, {ID: "tools", Role: "assistant", AssistantBlocks: []assistantBlock{{Kind: "tool-call"}}}, {ID: "b", Kind: "context", Text: "before", Turn: 1}, {ID: "next", Kind: "user", Role: "user", Turn: 2}}}}
	a.uiPrefs.StepsCollapse = "next-input"
	rows := a.chatRows()
	if len(rows) != 2 || len(rows[0].Messages) != 2 || rows[0].DefaultOpen {
		t.Fatalf("%+v", rows)
	}
	if err := a.applyIncremental("messageDelta", json.RawMessage(`{"sessionId":"s","messageId":"b","textAppend":" after"}`)); err != nil {
		t.Fatal(err)
	}
	if got := a.chatRows()[0].Messages[1].Text; got != "before after" {
		t.Fatal(got)
	}
}
func BenchmarkChatRowsStructuralRebuild(b *testing.B) {
	a := &app{uiPrefs: defaultViewPreferences()}
	a.current.Messages = make([]message, 10000)
	for i := range a.current.Messages {
		a.current.Messages[i] = message{ID: "m", Kind: "context", Turn: i / 4}
	}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		a.invalidateChatRows()
		_ = a.chatRows()
	}
}
