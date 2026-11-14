package main

import (
	"context"
	"native-dsh/desktop/internal/bridge"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestSemanticPublisherWire(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	fixture, _ := filepath.Abs("internal/fixtures/semantic.mjs")
	c, err := bridge.Start(ctx, node, fixture)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	done := make(chan error, 1)
	go func() { _, err := c.Call(ctx, "run", map[string]any{}); done <- err }()
	a := newApp(true)
	defer a.cancel()
	a.sessionID = ""
	a.current = snapshot{}
loop:
	for {
		select {
		case ev := <-c.Events:
			if ev.Method == "fixtureComplete" {
				break loop
			}
			a.notification(ev)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if a.error != "" {
		t.Fatal(a.error)
	}
	if len(a.current.Messages) != 4 {
		t.Fatalf("message count %d", len(a.current.Messages))
	}
	m := a.current.Messages
	if m[0].Kind != "user" || m[1].Kind != "context" || m[1].Context == nil {
		t.Fatalf("source semantics %s %s", m[0].Kind, m[1].Kind)
	}
	if m[2].ID != "tool:fixture-call" || m[2].Tool == nil || m[2].Tool.Phase != "settled" || m[2].Text != "Fixture tool content" {
		t.Fatalf("tool merge failed: %+v", m[2])
	}
	if len(m[3].AssistantBlocks) != 2 || m[3].Reasoning != "Fixture thinking" {
		t.Fatal("assistant classification lost")
	}
	if len(a.current.Trajectory) != 9 {
		t.Fatalf("trajectory snapshot+delta count %d", len(a.current.Trajectory))
	}
	seen := map[string]bool{}
	for _, r := range a.chatRows() {
		if seen[r.ID] {
			t.Fatalf("duplicate row %s", r.ID)
		}
		seen[r.ID] = true
	}
}
