package main

import (
	"encoding/json"
	"testing"
)

func TestMessageUpsertMovesExistingIdentityToAuthoritativeIndex(t *testing.T) {
	a := &app{sessionID: "s", current: snapshot{Messages: []message{{ID: "history"}, {ID: "attempt"}, {ID: "tool"}}}}
	if err := a.applyIncremental("messageUpsert", json.RawMessage(`{"sessionId":"s","index":1,"message":{"id":"tool","kind":"tool","text":"settled"}}`)); err != nil {
		t.Fatal(err)
	}
	if a.current.Messages[0].ID != "history" || a.current.Messages[1].ID != "tool" || a.current.Messages[2].ID != "attempt" || a.messageIndex["attempt"] != 2 {
		t.Fatalf("%+v", a.current.Messages)
	}
}
func TestAssistantBlockDeltaRetainsStructuredFieldsAndRejectsWrongBaseline(t *testing.T) {
	a := &app{sessionID: "s", current: snapshot{Messages: []message{{ID: "a", Role: "assistant", Text: "Hi", Reasoning: "why", AssistantBlocks: []assistantBlock{{Kind: "text", Text: "Hi"}, {Kind: "reasoning", Text: "why"}, {Kind: "image", Attachment: json.RawMessage(`{"id":"image","mediaType":"image/png"}`)}}}}}}
	if err := a.applyIncremental("messageDelta", json.RawMessage(`{"sessionId":"s","messageId":"a","textAppend":"!","reasoningAppend":"?","textBlockIndex":0,"reasoningBlockIndex":1}`)); err != nil {
		t.Fatal(err)
	}
	m := a.current.Messages[0]
	if m.Text != "Hi!" || m.AssistantBlocks[0].Text != "Hi!" || m.AssistantBlocks[1].Text != "why?" || len(m.AssistantBlocks[2].Attachment) == 0 {
		t.Fatal(m)
	}
	if err := a.applyIncremental("messageDelta", json.RawMessage(`{"sessionId":"s","messageId":"a","textAppend":"bad","textBlockIndex":2}`)); err == nil {
		t.Fatal("bad baseline accepted")
	}
	if a.current.Messages[0].Text != "Hi!" {
		t.Fatal("invalid delta partially applied")
	}
}
