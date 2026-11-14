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

func TestQueuedHelperNotificationsCannotCrossAccountOrGeneration(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	node, _ := exec.LookPath("node")
	file, _ := filepath.Abs("remote/bridge.mjs")
	client, err := bridge.Start(ctx, node, file, "--fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	old := map[string]any{"hostId": "fixture-host", "generation": 1, "accountScope": "old-account"}
	fresh := map[string]any{"hostId": "fixture-host", "generation": 2, "accountScope": "new-account"}
	events := []any{map[string]any{"method": "sessions", "scope": old, "params": []any{map[string]any{"id": "stale"}}}, map[string]any{"method": "workspaces", "scope": old, "params": []any{map[string]any{"id": "stale"}}}, map[string]any{"method": "snapshot", "scope": old, "params": map[string]any{"sessionId": "s", "messages": []any{map[string]any{"id": "stale"}}}}, map[string]any{"method": "sessions", "scope": fresh, "params": []any{map[string]any{"id": "fresh"}}}, map[string]any{"method": "workspaces", "scope": fresh, "params": []any{map[string]any{"id": "fresh"}}}, map[string]any{"method": "snapshot", "scope": fresh, "params": map[string]any{"sessionId": "s", "messages": []any{map[string]any{"id": "fresh", "text": "new account"}}}}}
	// The helper has emitted every frame into Go's queue before the UI switches.
	if _, err = client.Call(ctx, "fixtureEmitNotifications", map[string]any{"events": events, "marker": "scope-boundary"}); err != nil {
		t.Fatal(err)
	}
	a := newApp(false)
	defer a.cancel()
	a.client = client
	a.hostID = "fixture-host"
	a.remoteGeneration = 2
	a.accountScope = "new-account"
	a.sessionID = "s"
	a.sessions = []session{{ID: "kept"}}
	a.workspaces = []workspace{{ID: "kept"}}
	a.current = snapshot{SessionID: "s", Messages: []message{{ID: "kept"}}}
	seenOld := 0
loop:
	for {
		select {
		case ev := <-client.Events:
			if ev.Method == "fixtureComplete" {
				var m struct{ Marker string }
				_ = json.Unmarshal(ev.Params, &m)
				if m.Marker == "scope-boundary" {
					break loop
				}
			}
			a.notification(ev)
			if ev.Scope != nil && ev.Scope.AccountScope == "old-account" {
				seenOld++
				if a.sessions[0].ID != "kept" || a.workspaces[0].ID != "kept" || a.current.Messages[0].ID != "kept" {
					t.Fatal("queued old frame populated new account")
				}
			}
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
	if seenOld != 3 || a.sessions[0].ID != "fresh" || a.workspaces[0].ID != "fresh" || a.current.Messages[0].ID != "fresh" {
		t.Fatal("new marker state missing or old frame accepted", seenOld, a.sessions, a.workspaces, a.current.Messages)
	}
}
func TestQueuedStatusCannotUndoIntendedHostOrRollGenerationBack(t *testing.T) {
	a := &app{hostID: "new-host", remoteGeneration: 3, accountScope: "account"}
	for _, scope := range []bridge.NotificationScope{{HostID: "new-host", Generation: 2}, {HostID: "old-host", Generation: 3}, {HostID: "old-host", Generation: 4}} {
		if a.notificationScopeCurrent(bridge.Notification{Method: "status", Scope: &scope}) {
			t.Fatal("stale status accepted", scope)
		}
	}
}
