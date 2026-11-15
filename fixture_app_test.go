package main

import (
	"context"
	"encoding/json"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"native-dsh/desktop/internal/bridge"
)

// fixtureApp drives the real Go entry points over the explicit protocol
// fixture. It is a simulated Remote peer, not a live Host: the helper, the
// request fencing and the native state machines are real, the peer is not.
type fixtureApp struct {
	a       *app
	ctx     context.Context
	client  *bridge.Client
	mu      sync.Mutex
	updates chan func()
	done    chan struct{}
}

func startFixtureApp(t *testing.T) *fixtureApp {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node 24+ is required for the client integration fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	helper, _ := filepath.Abs("remote/bridge.mjs")
	client, err := bridge.Start(ctx, node, helper, "--fixture")
	if err != nil {
		t.Fatal(err)
	}
	f := &fixtureApp{a: newApp(false), ctx: ctx, client: client, updates: make(chan func(), 256), done: make(chan struct{})}
	f.a.ctx = ctx
	f.a.client = client
	f.a.testDispatch = func(fn func()) { f.updates <- fn }
	go func() {
		defer close(f.done)
		for fn := range f.updates {
			f.mu.Lock()
			fn()
			f.mu.Unlock()
		}
	}()
	t.Cleanup(func() {
		_ = client.Close()
		close(f.updates)
		<-f.done
		f.a.cancel()
	})

	f.do(func() {
		f.a.configure(func() { f.a.fetchDevices() })
	})
	f.wait(t, "device catalog", func() bool { return len(f.a.devices) == 1 })
	f.do(func() { f.a.connect(f.a.devices[0].ID) })
	f.wait(t, "connected host catalog", func() bool {
		return f.a.connected && len(f.a.workspaces) >= 1 && len(f.a.sessions) >= 1 && !f.a.busy
	})
	return f
}

// do runs one app entry point with the same single-threaded discipline the
// window uses for its own updates.
func (f *fixtureApp) do(fn func()) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fn()
}

func (f *fixtureApp) read(read func() any) any {
	f.mu.Lock()
	defer f.mu.Unlock()
	return read()
}

// hostReads reports the Host calls the client made through the fixture gateway.
func (f *fixtureApp) hostReads(t *testing.T) map[string]int {
	t.Helper()
	raw, err := f.client.Call(f.ctx, "fixtureStats", map[string]any{})
	if err != nil {
		t.Fatalf("fixtureStats: %v", err)
	}
	var stats struct {
		FixtureReads map[string]int `json:"fixtureReads"`
	}
	if err := json.Unmarshal(raw, &stats); err != nil {
		t.Fatalf("fixtureStats: %v", err)
	}
	return stats.FixtureReads
}

// waitReads waits for one Host counter to reach an exact value.
func (f *fixtureApp) waitReads(t *testing.T, key string, want int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if f.hostReads(t)[key] == want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for %s = %d (reads %v)", key, want, f.hostReads(t))
}

func (f *fixtureApp) wait(t *testing.T, label string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		f.mu.Lock()
		done := ok()
		f.mu.Unlock()
		if done {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for %s (error %q)", label, f.read(func() any { return f.a.error }))
}
