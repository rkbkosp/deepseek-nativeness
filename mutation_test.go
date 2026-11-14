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

func TestMutationRejectedCanRetryButUnknownCannotRedispatch(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	node, _ := exec.LookPath("node")
	file, _ := filepath.Abs("internal/fixtures/mutations.mjs")
	c, err := bridge.Start(ctx, node, file)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	a := newApp(false)
	defer a.cancel()
	a.ctx = ctx
	a.client = c
	a.connected = true
	a.hostID = "fixture-host"
	a.remoteGeneration = 7
	updates := make(chan func(), 32)
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
	a.mutate("pinSession", map[string]any{"sessionId": "rejected"}, nil)
	settle()
	if len(a.mutations) != 0 {
		t.Fatal("definitively rejected intent remained locked")
	}
	a.mutate("pinSession", map[string]any{"sessionId": "rejected"}, nil)
	settle()
	if len(a.mutations) != 0 {
		t.Fatal("accepted retry did not settle")
	}
	a.mutate("pinSession", map[string]any{"sessionId": "unknown"}, nil)
	settle()
	if len(a.mutations) != 1 {
		t.Fatal("unknown receipt lost its stable intent")
	}
	a.mutate("pinSession", map[string]any{"sessionId": "unknown"}, nil)
	settle()
	raw, err := c.Call(ctx, "stats", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	var counts map[string]int
	if err = json.Unmarshal(raw, &counts); err != nil {
		t.Fatal(err)
	}
	if counts["rejected"] != 2 || counts["unknown"] != 1 {
		t.Fatalf("wire dispatch counts %+v", counts)
	}
}
