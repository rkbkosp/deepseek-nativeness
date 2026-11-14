package main

import (
	"encoding/json"
	"testing"
)

func TestQuestionsDecodeAndPreserveWireLabels(t *testing.T) {
	var s snapshot
	if err := json.Unmarshal([]byte(`{"sessionId":"root","pending":[{"id":"evt-q","kind":"questions","sessionId":"child","questions":[{"id":"original-id","question":"Choose a scope","options":[{"label":"Client only","description":"Keep backend frozen"},{"label":"Cancel"}],"multiSelect":false}]}]}`), &s); err != nil {
		t.Fatal(err)
	}
	p := s.Pending[0]
	if p.SessionID != "child" || p.Questions[0].Question != "Choose a scope" {
		t.Fatal("lost question provenance")
	}
	answers, err := collectAnswers(p.Questions, map[string]*questionDraft{"original-id": {Single: "Client only"}})
	if err != nil {
		t.Fatal(err)
	}
	if answers[0].ID != "original-id" || answers[0].Selected[0] != "Client only" {
		t.Fatal("wire labels were not preserved")
	}
}

func TestMultiSelectAndCustomAnswer(t *testing.T) {
	qs := []question{{ID: "multi", Question: "Choose", MultiSelect: true, Options: []questionOption{{Label: "One"}, {Label: "Two"}}}}
	answers, err := collectAnswers(qs, map[string]*questionDraft{"multi": {Selected: map[string]bool{"One": true, "Two": true, "forged": true}, Custom: "Extra"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(answers[0].Selected) != 2 || answers[0].Custom != "Extra" {
		t.Fatal("lost selections or custom answer")
	}
}

func TestUnknownSendKeepsDraftAndAcceptedClearsOnlySameDraft(t *testing.T) {
	a := newApp(false)
	defer a.cancel()
	a.sessionID = "s"
	a.draft = "hello"
	intent := &sendIntent{ID: "operation-123456789", SessionID: "s", Text: "hello", Unknown: true}
	a.pendingSend = intent
	if err := a.acceptSend([]byte(`{"status":"unknown","requestId":"operation-123456789"}`), intent); err == nil {
		t.Fatal("unknown result accepted")
	}
	if a.draft != "hello" || !intent.Unknown {
		t.Fatal("unknown result changed draft")
	}
	if err := a.acceptSend([]byte(`{"status":"accepted","requestId":"operation-123456789"}`), intent); err != nil {
		t.Fatal(err)
	}
	if a.draft != "" || a.pendingSend != nil {
		t.Fatal("accepted result did not settle same draft")
	}
}
