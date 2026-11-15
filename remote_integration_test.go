package main

import (
	"context"
	"encoding/json"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"native-dsh/desktop/internal/bridge"
)

// This is a real Go-to-Node pipe, with an explicitly simulated Remote peer.
// It is not a network, authentication, or live Host acceptance test.
func TestGoNodeRemoteFixtureContract(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal("Node 24+ is required for client integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	helper, _ := filepath.Abs("remote/bridge.mjs")
	c, err := bridge.Start(ctx, node, helper, "--fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	call := func(method string, p any) json.RawMessage {
		t.Helper()
		raw, err := c.Call(ctx, method, p)
		if err != nil {
			t.Fatalf("%s: %v", method, err)
		}
		return raw
	}
	call("configure", map[string]any{"serverUrl": "fixture://local"})
	devices, err := decodeRows[device](call("devices", map[string]any{}), "devices")
	if err != nil || len(devices) != 1 {
		t.Fatalf("devices: %v %v", devices, err)
	}
	call("connect", map[string]any{"hostId": devices[0].ID})
	workspaces, err := decodeRows[workspace](call("workspaces", map[string]any{}), "workspaces")
	if err != nil || len(workspaces) != 1 {
		t.Fatalf("workspaces: %v %v", workspaces, err)
	}
	call("selectWorkspace", map[string]any{"workspaceId": workspaces[0].ID})
	sessions, err := decodeRows[session](call("sessions", map[string]any{}), "sessions")
	if err != nil || len(sessions) != 1 {
		t.Fatalf("sessions: %v %v", sessions, err)
	}
	var state snapshot
	if err = json.Unmarshal(call("openSession", map[string]any{"sessionId": sessions[0].ID}), &state); err != nil {
		t.Fatal(err)
	}
	if state.SessionID != sessions[0].ID || len(state.Messages) == 0 || len(state.Pending) != 2 {
		t.Fatalf("snapshot %+v", state)
	}
	var questionPending, approval interaction
	for _, p := range state.Pending {
		if p.Kind == "questions" {
			questionPending = p
		}
		if p.Kind == "approval" {
			approval = p
		}
	}
	q := questionPending.Questions[0]
	answers, err := collectAnswers(questionPending.Questions, map[string]*questionDraft{q.ID: {Single: q.Options[0].Label}})
	if err != nil {
		t.Fatal(err)
	}
	call("answerQuestions", map[string]any{"requestId": questionPending.ID, "answers": answers})
	call("answerApproval", map[string]any{"requestId": approval.ID, "outcome": "rejected"})
	intent := &sendIntent{ID: "fixture-user-intent-0001", SessionID: state.SessionID, Text: "Fixture only"}
	a := newApp(false)
	defer a.cancel()
	a.sessionID = state.SessionID
	a.draft = intent.Text
	a.pendingSend = intent
	if err = a.acceptSend(call("sendMessage", map[string]any{"sessionId": intent.SessionID, "text": intent.Text, "requestId": intent.ID}), intent); err != nil {
		t.Fatal(err)
	}
	if a.draft != "" {
		t.Fatal("accepted send did not settle draft")
	}
	call("cancel", map[string]any{"sessionId": state.SessionID, "requestId": "fixture-cancel-intent-0001"})
	if _, err = c.Call(ctx, "sendMessage", map[string]any{"sessionId": state.SessionID, "text": "missing operation identity"}); err == nil {
		t.Fatal("missing requestId accepted")
	}
	if err = json.Unmarshal(call("history", map[string]any{}), &state); err != nil {
		t.Fatal(err)
	}
	if len(state.Pending) != 0 {
		t.Fatal("settled interactions remained pending")
	}
}

func TestPublisherWireToNativeIncrementalState(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal("Node is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	fixture, _ := filepath.Abs("qa/publisher-wire-fixture.mjs")
	c, err := bridge.Start(ctx, node, fixture)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	callDone := make(chan error, 1)
	go func() { _, err := c.Call(ctx, "fixture.run", map[string]any{}); callDone <- err }()
	a := newApp(false)
	defer a.cancel()
	methods := map[string]int{}
loop:
	for {
		select {
		case ev, ok := <-c.Events:
			if !ok {
				t.Fatal("fixture closed before completion")
			}
			if ev.Method == "fixtureComplete" {
				break loop
			}
			methods[ev.Method]++
			if ev.Method == "chatPresentationPatch" {
				var p chatPresentationPatch
				if json.Unmarshal(ev.Params, &p) == nil {
					methods["messageUpsert"] += len(p.PayloadChanges.Upserts)
					methods["messageRemove"] += len(p.PayloadChanges.Removes)
					methods["messageDelta"] += len(p.PayloadChanges.Deltas)
				}
			}
			a.notification(ev)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
	if err := <-callDone; err != nil {
		t.Fatal(err)
	}
	if a.error != "" {
		t.Fatal(a.error)
	}
	if len(a.current.Messages) != 3 {
		t.Fatalf("messages=%+v", a.current.Messages)
	}
	if a.current.Messages[0].Text != "Keep historical content" || a.current.Messages[1].Text != "Historical answer" || a.current.Messages[2].Text != "Hello world!" || a.current.Messages[2].ID != "event:3" {
		t.Fatalf("native projection=%+v", a.current.Messages)
	}
	if len(a.current.Pending) != 1 || a.current.Pending[0].SessionID != "fixture-child" || a.current.Pending[0].Questions[0].Options[0].Label != "Client only" {
		t.Fatalf("pending=%+v", a.current.Pending)
	}
	for _, method := range []string{"snapshot", "messageUpsert", "messageDelta", "messageRemove", "pending"} {
		if methods[method] == 0 {
			t.Fatalf("fixture did not exercise %s", method)
		}
	}
}
