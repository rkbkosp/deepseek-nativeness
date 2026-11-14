package main

import (
	"encoding/json"
	"testing"
)

func TestIncrementalMessagesKeepHistoryAndIdentity(t *testing.T) {
	a := newApp(false)
	defer a.cancel()
	a.replaceSnapshot(snapshot{SessionID: "s", Messages: []message{{ID: "history", Role: "assistant", Text: "Historical content"}, {ID: "live", Role: "assistant", Text: "Hello", Streaming: true}}})
	if err := a.applyIncremental("messageDelta", json.RawMessage(`{"sessionId":"s","messageId":"live","textAppend":" world","reasoningAppend":"Reason","streaming":true}`)); err != nil {
		t.Fatal(err)
	}
	if a.current.Messages[0].Text != "Historical content" || a.current.Messages[1].ID != "live" || a.current.Messages[1].Text != "Hello world" || a.current.Messages[1].Reasoning != "Reason" {
		t.Fatal("delta altered unrelated history or identity")
	}
	if err := a.applyIncremental("messageUpsert", json.RawMessage(`{"sessionId":"s","index":1,"message":{"id":"settled","role":"assistant","text":"Final","streaming":false}}`)); err != nil {
		t.Fatal(err)
	}
	if err := a.applyIncremental("messageRemove", json.RawMessage(`{"sessionId":"s","ids":["live"]}`)); err != nil {
		t.Fatal(err)
	}
	if len(a.current.Messages) != 2 || a.current.Messages[1].ID != "settled" {
		t.Fatal("settlement did not replace transient message")
	}
	if err := a.applyIncremental("messageDelta", json.RawMessage(`{"sessionId":"other","messageId":"missing","textAppend":"wrong"}`)); err != nil {
		t.Fatal(err)
	}
	if err := a.applyIncremental("messageDelta", json.RawMessage(`{"sessionId":"s","messageId":"missing","textAppend":"wrong"}`)); err == nil {
		t.Fatal("missing baseline accepted")
	}
}
