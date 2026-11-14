package main

import (
	"context"
	"encoding/json"
	"native-dsh/desktop/internal/bridge"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestContentSendCapturesPayloadAndBlocksUnknownRedispatch(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	node, _ := exec.LookPath("node")
	file, _ := filepath.Abs("internal/fixtures/send-content.mjs")
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
	a.remoteGeneration = 9
	a.sessionID = "fixture-session"
	a.draft = "unknown"
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
	content := []composerContentPart{{Type: "text", Text: "unknown"}, {Type: "image", Data: "AQID", MediaType: "image/png"}}
	ids := []string{"image-1"}
	a.sendComposerPayload("queue", content, ids)
	content[0].Text = "mutated"
	ids[0] = "new-id"
	settle()
	if a.pendingSend == nil || !a.pendingSend.Unknown || a.pendingSend.Content[0].Text != "unknown" || a.pendingSend.AttachmentIDs[0] != "image-1" {
		t.Fatal("payload identity was not captured")
	}
	a.sendComposerPayload("queue", []composerContentPart{{Type: "text", Text: "unknown"}, {Type: "image", Data: "AQID", MediaType: "image/png"}}, []string{"image-1"})
	settle()
	raw, err := client.Call(ctx, "stats", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	var records []map[string]any
	if json.Unmarshal(raw, &records) != nil || len(records) != 1 {
		t.Fatalf("unknown was replayed: %s", raw)
	}
	a.sendComposerPayload("queue", []composerContentPart{{Type: "image", Data: strings.Repeat("A", bridge.MaxRequestBytes), MediaType: "image/png"}}, []string{"large"})
	settle()
	if len(a.sendIntents) != 1 || a.draft != "unknown" {
		t.Fatal("oversize request must release its intent and preserve draft")
	}
	for _, intent := range a.sendIntents {
		if !intent.Unknown || intent.Content[0].Text != "unknown" {
			t.Fatal("known local rejection disturbed previous unknown intent")
		}
	}
	raw, err = client.Call(ctx, "stats", map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	if json.Unmarshal(raw, &records) != nil || len(records) != 1 {
		t.Fatal("oversize payload crossed pipe")
	}
}
