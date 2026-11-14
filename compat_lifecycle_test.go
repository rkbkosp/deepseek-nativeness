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

func TestPendingCompatOwnerReleaseUsesSameHelperAndDoesNotAccumulate(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	node, _ := exec.LookPath("node")
	file, _ := filepath.Abs("remote/bridge.mjs")
	client, err := bridge.Start(ctx, node, file, "--fixture")
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	call := func(method string, p any) json.RawMessage {
		t.Helper()
		raw, err := client.Call(ctx, method, p)
		if err != nil {
			t.Fatalf("%s: %v", method, err)
		}
		return raw
	}
	call("configure", map[string]any{"serverUrl": "fixture://local"})
	devices, err := decodeRows[device](call("devices", map[string]any{}), "devices")
	if err != nil || len(devices) == 0 {
		t.Fatal("missing fixture host")
	}
	var status struct {
		HostID     string `json:"hostId"`
		Generation uint64 `json:"connectionGeneration"`
	}
	if err = json.Unmarshal(call("connect", map[string]any{"hostId": devices[0].ID}), &status); err != nil {
		t.Fatal(err)
	}
	a := newApp(true)
	defer a.cancel()
	a.client = client
	scope := map[string]any{"hostId": status.HostID, "generation": status.Generation}
	for i := 0; i < 20; i++ {
		owner := newPageOwner()
		call("registerOwner", map[string]any{"ownerId": owner, "clientScope": scope})
		a.compatPendingOwner = owner
		a.closeCompat()
		for {
			var stats struct{ Owners, Streams int }
			if err = json.Unmarshal(call("runtimeStats", map[string]any{}), &stats); err != nil {
				t.Fatal(err)
			}
			if stats.Owners == 0 && stats.Streams == 0 {
				break
			}
			select {
			case <-time.After(time.Millisecond):
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
		}
		stale := map[string]any{"hostId": status.HostID, "generation": status.Generation, "ownerId": owner}
		if _, err = client.Call(ctx, "modelCatalog", map[string]any{"clientScope": stale}); err == nil {
			t.Fatal("closed page retained Host access")
		}
	}
}
