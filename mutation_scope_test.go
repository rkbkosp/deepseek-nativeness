package main

import (
	"context"
	"encoding/json"
	"native-dsh/desktop/internal/bridge"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestMutationUnknownLedgerSeparatesAccountsOnSameHost(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	node, _ := exec.LookPath("node")
	file, _ := filepath.Abs("internal/fixtures/mutations.mjs")
	client, err := bridge.Start(ctx, node, file)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	a := newApp(false)
	defer a.cancel()
	a.ctx = ctx
	a.client = client
	a.connected = true
	a.hostID = "fixture-host"
	a.remoteGeneration = 7
	a.accountScope = "server-a/account-a"
	updates := make(chan func(), 16)
	a.testDispatch = func(fn func()) { updates <- fn }
	settle := func() {
		t.Helper()
		for a.pendingRequests > 0 {
			select {
			case fn := <-updates:
				fn()
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
		}
	}
	a.mutate("pinSession", map[string]any{"sessionId": "unknown"}, nil)
	settle()
	a.accountScope = "server-b/account-b"
	a.mutate("pinSession", map[string]any{"sessionId": "unknown"}, nil)
	settle()
	if len(a.mutations) != 2 {
		t.Fatal("another account inherited an unknown intent gate")
	}
	a.accountScope = "server-a/account-a"
	a.mutate("pinSession", map[string]any{"sessionId": "unknown"}, nil)
	settle()
	raw, err := client.Call(ctx, "stats", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	var counts map[string]int
	_ = json.Unmarshal(raw, &counts)
	if counts["unknown"] != 2 {
		t.Fatal("original account blindly replayed unknown", counts)
	}
}

func TestGenericMutationCapturesNestedJSONWithoutChangingCaller(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	node, _ := exec.LookPath("node")
	file, _ := filepath.Abs("internal/fixtures/mutations.mjs")
	client, err := bridge.Start(ctx, node, file)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	a := newApp(false)
	defer a.cancel()
	a.ctx = ctx
	a.client = client
	a.connected = true
	a.hostID = "fixture-host"
	a.remoteGeneration = 7
	updates := make(chan func(), 16)
	a.testDispatch = func(fn func()) { updates <- fn }
	labels := []string{"captured"}
	params := map[string]any{"sessionId": "unknown", "nested": map[string]any{"labels": labels, "revision": uint64(9007199254740993)}}
	a.mutate("pinSession", params, nil)
	params["sessionId"] = "different"
	labels[0] = "mutated"
	if _, ok := params["requestId"]; ok {
		t.Fatal("mutate changed caller map")
	}
	for a.pendingRequests > 0 {
		select {
		case fn := <-updates:
			fn()
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
	raw, err := client.Call(ctx, "rawRecords", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	var lines []string
	if json.Unmarshal(raw, &lines) != nil || len(lines) != 1 {
		t.Fatal(string(raw))
	}
	var request struct {
		Params struct {
			SessionID string
			Nested    struct {
				Labels   []string
				Revision json.Number
			}
		}
	}
	if json.Unmarshal([]byte(lines[0]), &request) != nil || request.Params.SessionID != "unknown" || request.Params.Nested.Labels[0] != "captured" || request.Params.Nested.Revision.String() != "9007199254740993" {
		t.Fatal("async mutation payload drifted", string(raw))
	}
}
