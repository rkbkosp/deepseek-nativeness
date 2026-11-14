package main

import (
	"context"
	"encoding/json"
	"fmt"
	"native-dsh/desktop/internal/bridge"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

// Compares every emitted field, including structured metadata, instead of
// decoding the expected value into the same lossy Go schema under test.
func assertPresentationFields(t *testing.T, path string, want, got any) {
	t.Helper()
	switch x := want.(type) {
	case map[string]any:
		y, ok := got.(map[string]any)
		if !ok {
			t.Fatalf("%s expected object, got %T", path, got)
		}
		for k, v := range x {
			w, ok := y[k]
			if !ok {
				t.Fatalf("%s missing field %s", path, k)
			}
			assertPresentationFields(t, path+"."+k, v, w)
		}
	case []any:
		y, ok := got.([]any)
		if !ok || len(x) != len(y) {
			t.Fatalf("%s arrays differ: expected %d got %v", path, len(x), got)
		}
		for i := range x {
			assertPresentationFields(t, fmt.Sprintf("%s[%d]", path, i), x[i], y[i])
		}
	default:
		if !reflect.DeepEqual(want, got) {
			t.Fatalf("%s: expected %v, got %v", path, want, got)
		}
	}
}
func TestRealPublisherStructuredMetadataSurvivesGoNodeGo(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	node, _ := exec.LookPath("node")
	file, _ := filepath.Abs("remote/bridge.mjs")
	client, err := bridge.Start(ctx, node, file, "--fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	type result struct {
		raw json.RawMessage
		err error
	}
	done := make(chan result, 1)
	go func() {
		raw, e := client.Call(ctx, "fixtureStructuredStream", map[string]any{})
		done <- result{raw, e}
	}()
	a := newApp(true)
	defer a.cancel()
	a.sessionID = ""
	a.current = snapshot{}
	textDeltas, reasoningDeltas, upserts := 0, 0, 0
loop:
	for {
		select {
		case ev, ok := <-client.Events:
			if !ok {
				t.Fatal("fixture ended before marker")
			}
			if ev.Method == "fixtureComplete" {
				var marker struct{ Marker string }
				_ = json.Unmarshal(ev.Params, &marker)
				if marker.Marker == "structured-v1" {
					break loop
				}
			}
			a.notification(ev)
			if ev.Method == "messageUpsert" {
				var p struct{ Message json.RawMessage }
				if json.Unmarshal(ev.Params, &p) != nil {
					t.Fatal("invalid upsert")
				}
				var expected map[string]any
				_ = json.Unmarshal(p.Message, &expected)
				id, _ := expected["id"].(string)
				index, ok := a.messageIndex[id]
				if !ok {
					t.Fatal("upsert missing native identity")
				}
				native, _ := json.Marshal(a.current.Messages[index])
				var actual any
				_ = json.Unmarshal(native, &actual)
				assertPresentationFields(t, "upsert", expected, actual)
				upserts++
			}
			if ev.Method == "messageDelta" {
				var p struct {
					MessageID           string
					TextBlockIndex      *int
					ReasoningBlockIndex *int
				}
				_ = json.Unmarshal(ev.Params, &p)
				m := a.current.Messages[a.messageIndex[p.MessageID]]
				if p.TextBlockIndex != nil {
					if m.AssistantBlocks[*p.TextBlockIndex].Text != m.Text {
						t.Fatal("wire text block suffix diverged")
					}
					textDeltas++
				}
				if p.ReasoningBlockIndex != nil {
					if m.AssistantBlocks[*p.ReasoningBlockIndex].Text != m.Reasoning {
						t.Fatal("wire reasoning block suffix diverged")
					}
					reasoningDeltas++
				}
			}
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
	r := <-done
	if r.err != nil {
		t.Fatal(r.err)
	}
	if a.error != "" {
		t.Fatal(a.error)
	}
	var envelope struct{ Expected any }
	if json.Unmarshal(r.raw, &envelope) != nil {
		t.Fatal("invalid expected snapshot")
	}
	actual, _ := json.Marshal(a.current)
	var got any
	if json.Unmarshal(actual, &got) != nil {
		t.Fatal("invalid actual snapshot")
	}
	assertPresentationFields(t, "snapshot", envelope.Expected, got)
	if textDeltas == 0 || reasoningDeltas == 0 || upserts == 0 {
		t.Fatalf("missing actual publisher branches text=%d reasoning=%d upserts=%d", textDeltas, reasoningDeltas, upserts)
	}
}
