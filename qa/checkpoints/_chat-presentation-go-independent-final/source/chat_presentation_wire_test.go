package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/egoist/mygo/ui"
	"native-dsh/desktop/internal/bridge"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestPresentationRealPublisherQueueAndLateRPCBaselineCopies(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	node, _ := exec.LookPath("node")
	fixture, _ := filepath.Abs("internal/fixtures/chat-process-wire.mjs")
	client, err := bridge.Start(ctx, node, fixture)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	// Read the RPC result first, deliberately leaving actual helper events in
	// the Go queue. Then replay both causal orders through production dispatch.
	raw, err := client.Call(ctx, "fixture.chat", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		OldBaseline snapshot
		NewBaseline snapshot
		Expected    any
	}
	if err = json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	var events []bridge.Notification
	for {
		select {
		case ev := <-client.Events:
			if ev.Method == "fixtureComplete" {
				goto received
			}
			events = append(events, ev)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
received:
	for _, insertion := range []int{0, 1, len(events) / 2, len(events)} {
		t.Run(fmt.Sprint(insertion), func(t *testing.T) {
			a := newApp(true)
			defer a.cancel()
			a.sessionID = "chat-wire-session"
			a.current = snapshot{SessionID: a.sessionID}
			a.hostID = "chat-fixture-host"
			a.remoteGeneration = 1
			a.accountScope = "chat-fixture-account"
			insert := func() { a.replaceSnapshot(result.OldBaseline); a.replaceSnapshot(result.NewBaseline) }
			for i, event := range events {
				if i == insertion {
					insert()
				}
				a.notification(event)
				if a.error != "" {
					t.Fatalf("actual receiver rejected valid event %s: %s", event.Method, a.error)
				}
			}
			if insertion == len(events) {
				insert()
			}
			actualRaw, _ := json.Marshal(a.current)
			var actual any
			_ = json.Unmarshal(actualRaw, &actual)
			assertPresentationFields(t, "causal.snapshot", result.Expected, actual)
			if a.current.Messages[len(a.current.Messages)-1].Text != "Live suffix" {
				t.Fatal("late RPC baseline copy lost streamed suffix")
			}
		})
	}
}

func TestPresentationRealHelperStreamCheckpointsAndNativeParts(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	node, _ := exec.LookPath("node")
	file, _ := filepath.Abs("remote/bridge.mjs")
	client, err := bridge.Start(ctx, node, file, "--fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	raw, err := client.Call(ctx, "fixtureChatPresentationStream", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Expected    any
		Checkpoints []struct {
			Marker   string
			Expected any
		}
	}
	if json.Unmarshal(raw, &result) != nil {
		t.Fatal("invalid helper checkpoint result")
	}
	want := map[string]any{}
	for _, cp := range result.Checkpoints {
		want[cp.Marker] = cp.Expected
	}
	a := newApp(true)
	defer a.cancel()
	a.sessionID = ""
	a.current = snapshot{}
	a.uiPrefs.FoldedReplies = "final"
	steps := map[string]chatStep{}
	seen := 0
	for {
		select {
		case ev, ok := <-client.Events:
			if !ok {
				t.Fatal("helper closed before marker")
			}
			if ev.Method == "fixtureComplete" {
				goto finished
			}
			if ev.Method == "fixtureCheckpoint" {
				var cp struct{ Marker string }
				_ = json.Unmarshal(ev.Params, &cp)
				actualRaw, _ := json.Marshal(a.current)
				var actual any
				_ = json.Unmarshal(actualRaw, &actual)
				assertPresentationFields(t, "checkpoint."+cp.Marker, want[cp.Marker], actual)
				for _, step := range a.current.ChatPresentation.Steps {
					if step.Turn == 1 && step.Step == 1 {
						steps[cp.Marker] = step
					}
				}
				seen++
				continue
			}
			a.notification(ev)
			if a.error != "" {
				t.Fatalf("valid actual stream rejected at %s: %s", ev.Method, a.error)
			}
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
finished:
	if seen != 5 {
		t.Fatal("missing actual helper settlement checkpoints", seen)
	}
	if steps["live"].NodeKey == "" || steps["live"].NodeKey != steps["staged"].NodeKey || steps["live"].NodeKey != steps["retained"].NodeKey || steps["live"].PayloadID != steps["staged"].PayloadID || steps["live"].AnchorSeq != steps["retained"].AnchorSeq {
		t.Fatal("successful durable-before-end settlement remounted the keyed live node", steps)
	}
	if steps["latest-empty"].AnchorSeq == steps["retained"].AnchorSeq || steps["latest-empty"].FinalEventSeq == nil {
		t.Fatal("owning step end did not settle retained rows to durable identity")
	}
	actualRaw, _ := json.Marshal(a.current)
	var actual any
	_ = json.Unmarshal(actualRaw, &actual)
	assertPresentationFields(t, "final", result.Expected, actual)
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("Response A") || !tt.HasText("Response B") || !tt.HasText("未知内容块") {
		t.Fatal("actual native renderer lost the closing structured response")
	}
	if tt.HasText("Reasoning middle") || tt.HasText("Earlier committed reply") {
		t.Fatal("closed final-only policy left process content visible")
	}
}

func TestPresentationRetainedFractionalAnchorCrossesInputOnlyUntilStepEnd(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	node, _ := exec.LookPath("node")
	file, _ := filepath.Abs("internal/fixtures/chat-retained-wire.mjs")
	client, err := bridge.Start(ctx, node, file)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	raw, err := client.Call(ctx, "fixture.retained", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	var result struct {
		Checkpoints []struct {
			Marker   string
			Expected any
		}
	}
	if json.Unmarshal(raw, &result) != nil {
		t.Fatal("invalid retained oracle")
	}
	want := map[string]any{}
	for _, cp := range result.Checkpoints {
		want[cp.Marker] = cp.Expected
	}
	a := newApp(true)
	defer a.cancel()
	a.hostID = "retained-fixture"
	a.accountScope = "retained-account"
	a.remoteGeneration = 1
	a.sessionID = ""
	a.current = snapshot{}
	a.uiPrefs.FoldedReplies = "final"
	tt := ui.NewTester(a.view, 1280, 820)
	stableKey := ""
	seen := 0
	for {
		select {
		case ev, ok := <-client.Events:
			if !ok {
				t.Fatal("retained fixture closed")
			}
			if ev.Method == "fixtureComplete" {
				if seen != 2 {
					t.Fatal("missing retained phases")
				}
				return
			}
			if ev.Method == "fixtureCheckpoint" {
				var cp struct{ Marker string }
				_ = json.Unmarshal(ev.Params, &cp)
				actualRaw, _ := json.Marshal(a.current)
				var actual any
				_ = json.Unmarshal(actualRaw, &actual)
				assertPresentationFields(t, "retained."+cp.Marker, want[cp.Marker], actual)
				var ids []string
				var response chatPartRef
				for _, row := range a.chatRows() {
					if row.Control {
						continue
					}
					for _, part := range row.Parts {
						ids = append(ids, part.PayloadID)
						if part.NodeKey == "14:assistant-step1:1" && part.Part == "response" {
							response = part
						}
					}
				}
				expected := []string{"event:2", "event:4", "event:3"}
				if cp.Marker == "settled" {
					expected = []string{"event:2", "event:3", "event:4"}
				}
				if !reflect.DeepEqual(ids, expected) {
					t.Fatalf("%s layout used durable arena position instead of source anchor: %v", cp.Marker, ids)
				}
				if stableKey != "" && stableKey != response.key() {
					t.Fatal("settlement changed node+part key")
				}
				stableKey = response.key()
				if a.chatPartMessage(response).Seq != 4 || string(a.chatPartMessage(response).SourceMessageID) != `"retained-committed"` {
					t.Fatal("layout migration changed source action identity")
				}
				tt.Frame()
				tt.Frame()
				assistant, okA := tt.Find("Retained fixture response")
				input, okI := tt.Find("Later fixture input")
				if !okA || !okI || cp.Marker == "retained" && assistant.Y >= input.Y || cp.Marker == "settled" && assistant.Y <= input.Y {
					t.Fatalf("actual view order disagrees at %s: assistant=%+v input=%+v", cp.Marker, assistant, input)
				}
				seen++
				continue
			}
			a.notification(ev)
			if a.error != "" {
				t.Fatal(a.error)
			}
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
}
