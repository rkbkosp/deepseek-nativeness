package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/egoist/mygo/ui"
	"native-dsh/desktop/internal/bridge"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

type historyImageFixture struct {
	a       *app
	ctx     context.Context
	client  *bridge.Client
	updates chan func()
}

func newHistoryImageFixture(t *testing.T) *historyImageFixture {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	node, _ := exec.LookPath("node")
	file, _ := filepath.Abs("remote/bridge.mjs")
	client, err := bridge.Start(ctx, node, file, "--fixture")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close() })
	f := &historyImageFixture{ctx: ctx, client: client, updates: make(chan func(), 32)}
	f.call(t, "configure", map[string]any{"serverUrl": "fixture://local"})
	devices, _ := decodeRows[device](f.call(t, "devices", map[string]any{}), "devices")
	var status struct {
		HostID               string
		ConnectionGeneration uint64
	}
	_ = json.Unmarshal(f.call(t, "connect", map[string]any{"hostId": devices[0].ID}), &status)
	workspaces, _ := decodeRows[workspace](f.call(t, "workspaces", map[string]any{}), "workspaces")
	f.call(t, "selectWorkspace", map[string]any{"workspaceId": workspaces[0].ID})
	sessions, _ := decodeRows[session](f.call(t, "sessions", map[string]any{}), "sessions")
	f.call(t, "openSession", map[string]any{"sessionId": sessions[0].ID})
	a := newApp(false)
	t.Cleanup(a.cancel)
	a.ctx = ctx
	a.client = client
	a.connected = true
	a.hostID = status.HostID
	a.remoteGeneration = status.ConnectionGeneration
	a.sessionID = sessions[0].ID
	a.testDispatch = func(fn func()) { f.updates <- fn }
	f.a = a
	t.Cleanup(a.resetMessageImages)
	return f
}
func (f *historyImageFixture) call(t *testing.T, method string, p any) json.RawMessage {
	t.Helper()
	raw, err := f.client.Call(f.ctx, method, p)
	if err != nil {
		t.Fatalf("%s: %v", method, err)
	}
	return raw
}
func (f *historyImageFixture) update(t *testing.T) {
	t.Helper()
	select {
	case fn := <-f.updates:
		fn()
	case <-f.ctx.Done():
		t.Fatal(f.ctx.Err())
	}
}
func (f *historyImageFixture) wait(t *testing.T, method string, predicate func(map[string]int) bool) {
	t.Helper()
	for {
		var stats map[string]json.RawMessage
		if json.Unmarshal(f.call(t, method, map[string]any{}), &stats) != nil {
			t.Fatal("stats invalid")
		}
		ints := map[string]int{}
		for k, v := range stats {
			var n int
			if json.Unmarshal(v, &n) == nil {
				ints[k] = n
			}
		}
		if predicate(ints) {
			return
		}
		select {
		case <-time.After(time.Millisecond):
		case <-f.ctx.Done():
			t.Fatal("timeout", ints)
		}
	}
}
func fixtureImageRef() imageAttachment {
	data, _ := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBzQAAAAASUVORK5CYII=")
	return imageAttachment{AttachmentID: "fixture-image", MediaType: "image/png", Bytes: int64(len(data)), Width: 1, Height: 1, Name: "fixture pixel"}
}
func TestHistoryImageCloseRetiresPendingRegistrationAndActiveUnary(t *testing.T) {
	f := newHistoryImageFixture(t)
	a := f.a
	ref := fixtureImageRef()
	key := imageReferenceKey(ref)
	cache := a.historyImages()
	entry := &historyImageEntry{Ref: ref}
	cache.Entries[key] = entry
	a.loadHistoryImage(cache, key, entry)
	f.wait(t, "runtimeStats", func(s map[string]int) bool { return s["owners"] == 1 })
	a.resetMessageImages()
	f.update(t)
	f.wait(t, "runtimeStats", func(s map[string]int) bool { return s["owners"] == 0 })
	if cache.Registered || a.messageImages != nil {
		t.Fatal("late registration receipt retained image owner")
	}
	f.call(t, "fixtureHoldAttachments", map[string]any{"hold": true})
	cache = a.historyImages()
	entry = &historyImageEntry{Ref: ref}
	cache.Entries[key] = entry
	a.loadHistoryImage(cache, key, entry)
	f.update(t)
	if !cache.Registered {
		t.Fatal("owner not registered")
	}
	a.loadHistoryImage(cache, key, entry)
	f.wait(t, "fixtureStats", func(s map[string]int) bool { return s["activeAttachments"] == 1 })
	a.resetMessageImages()
	f.wait(t, "fixtureStats", func(s map[string]int) bool { return s["activeAttachments"] == 0 && s["abortedAttachments"] == 1 })
	f.wait(t, "runtimeStats", func(s map[string]int) bool { return s["owners"] == 0 })
	f.update(t)
	if entry.Bitmap != nil || a.messageImages != nil {
		t.Fatal("canceled read populated a detached cache")
	}
}
func TestHistoryImageOnlyVisiblePaintStartsOwnerAndRead(t *testing.T) {
	f := newHistoryImageFixture(t)
	ref := fixtureImageRef()
	raw, _ := json.Marshal(ref)
	m := message{ID: "fixture-image-message", AssistantBlocks: []assistantBlock{{Kind: "image", Attachment: raw}}}
	visible := false
	tt := ui.NewTester(func(c *ui.Context) {
		ui.Scroll(c).Fill().Children(func() {
			ui.Column(c).Children(func() {
				if !visible {
					ui.Box(c).Height(2000).Shrink(0)
				}
				f.a.messageImageGallery(c, m)
			})
		})
	}, 640, 480)
	tt.Frame()
	f.wait(t, "runtimeStats", func(s map[string]int) bool { return s["owners"] == 0 })
	var stats struct{ StartedAttachments int }
	_ = json.Unmarshal(f.call(t, "fixtureStats", map[string]any{}), &stats)
	if stats.StartedAttachments != 0 {
		t.Fatal("offscreen image read during measurement")
	}
	visible = true
	tt.Frame()
	f.update(t)
	tt.Frame()
	f.update(t)
	tt.Frame()
	entry := f.a.messageImages.Entries[imageReferenceKey(ref)]
	if entry.Bitmap == nil {
		t.Fatal("visible image missing", entry.Error)
	}
	for i := 0; i < 10; i++ {
		tt.Frame()
	}
	_ = json.Unmarshal(f.call(t, "fixtureStats", map[string]any{}), &stats)
	if stats.StartedAttachments != 1 {
		t.Fatal("cached visible image re-read", stats)
	}
}
func TestHistoryImageCacheEvictsWithinCountAndDecodedBudget(t *testing.T) {
	cache := &historyImageCache{Entries: map[string]*historyImageEntry{}}
	for i := 0; i < 40; i++ {
		cache.evict(1024 * 1024)
		cache.Entries[fmt.Sprint(i)] = &historyImageEntry{Bytes: 1024 * 1024, Seen: uint64(i)}
		cache.Used += 1024 * 1024
		if cache.Used > historyThumbnailBudget || len(cache.Entries) > historyThumbnailEntries {
			t.Fatal("cache exceeded budget")
		}
	}
	if _, ok := cache.Entries["0"]; ok {
		t.Fatal("oldest image retained")
	}
}
func TestSingleImageFitMatchesOriginalLongEdgeAndCrop(t *testing.T) {
	for _, tt := range []struct {
		w, h               int
		wantW, wantH, x, y float32
	}{{800, 400, 240, 120, .5, .5}, {100, 100, 100, 100, .5, .5}, {100, 1000, 60, 240, .5, 0}, {1000, 100, 240, 60, 0, .5}} {
		w, h, x, y := singleImageFit(tt.w, tt.h)
		if w != tt.wantW || h != tt.wantH || x != tt.x || y != tt.y {
			t.Fatal(tt, w, h, x, y)
		}
	}
}

func TestHistoryImageLateNodeRegistrationAfterCloseIsReleased(t *testing.T) {
	f := newHistoryImageFixture(t)
	f.call(t, "fixtureHoldOwnerRegistration", map[string]any{"hold": true})
	cache := f.a.historyImages()
	ref := fixtureImageRef()
	key := imageReferenceKey(ref)
	entry := &historyImageEntry{Ref: ref}
	cache.Entries[key] = entry
	f.a.loadHistoryImage(cache, key, entry)
	f.wait(t, "fixtureStats", func(s map[string]int) bool { return s["heldRegistrations"] == 1 })
	f.a.resetMessageImages()
	f.call(t, "fixtureHoldOwnerRegistration", map[string]any{"hold": false})
	f.update(t)
	f.wait(t, "runtimeStats", func(s map[string]int) bool { return s["owners"] == 0 })
	if cache.Registered || f.a.messageImages != nil {
		t.Fatal("closed image cache accepted late owner")
	}
	var stats struct{ StartedAttachments int }
	_ = json.Unmarshal(f.call(t, "fixtureStats", map[string]any{}), &stats)
	if stats.StartedAttachments != 0 {
		t.Fatal("closed owner started attachment read")
	}
}
