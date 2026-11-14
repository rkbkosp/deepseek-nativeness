package main

import (
	"bytes"
	"encoding/json"
	"github.com/egoist/mygo/ui"
	"os"
	"path/filepath"
	"testing"
	"unicode/utf16"
)

func TestDemoPreferencesDoNotReadOrWriteExplicitFixturePaths(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "normal.json")
	fixture := []byte(`{"serverUrl":"https://fixture.invalid","ui":{"fontSize":21},"selections":{"fixture-principal":{"serverUrl":"https://fixture.invalid","hostId":"fixture-host","sessionId":"fixture-session"}}}`)
	if err := os.WriteFile(input, fixture, 0600); err != nil {
		t.Fatal(err)
	}
	demo := newApp(true)
	defer demo.cancel()
	if demo.savedSelections != nil || demo.client != nil || demo.accountScope != "" {
		t.Fatal("demo constructor inherited real selection or identity state")
	}
	defaults := demo.uiPrefs.FontSize
	server := demo.server
	demo.loadPreferencesFrom(input)
	if demo.uiPrefs.FontSize != defaults || demo.server != server || demo.savedSelections != nil {
		t.Fatal("demo adopted a preference fixture")
	}
	output := filepath.Join(dir, "must-not-exist", "preferences.json")
	demo.savePreferencesTo(output)
	if _, err := os.Stat(filepath.Dir(output)); !os.IsNotExist(err) {
		t.Fatal("demo created a preference directory", err)
	}
	if after, _ := os.ReadFile(input); !bytes.Equal(after, fixture) {
		t.Fatal("read-only demo changed its input fixture")
	}
	normal := &app{uiPrefs: defaultViewPreferences()}
	normal.loadPreferencesFrom(input)
	if normal.server != "https://fixture.invalid" || normal.uiPrefs.FontSize != 21 || len(normal.savedSelections) != 1 {
		t.Fatal("normal path decoding changed")
	}
	normal.savePreferencesTo(filepath.Join(dir, "normal-output.json"))
	if _, err := os.Stat(filepath.Join(dir, "normal-output.json")); err != nil {
		t.Fatal("normal path persistence stopped working", err)
	}
}
func TestStructuredReplayRoutingIsDemoOnlyAndPreloadsOneBoundedBitmap(t *testing.T) {
	normal := &app{current: snapshot{SessionID: "fixture-authenticated-selection", Messages: []message{{ID: "keep-me", Text: "fixture-only"}}}}
	if normal.applyDemoDocument("structured") || normal.current.SessionID != "fixture-authenticated-selection" || normal.current.Messages[0].ID != "keep-me" || normal.messageImages != nil {
		t.Fatal("normal --demo-document route changed a real-mode selection")
	}
	a := newApp(true)
	defer a.cancel()
	defer a.resetMessageImages()
	if !a.applyDemoDocument("structured") || len(a.current.Messages) != 3 || !a.current.Messages[2].Interrupted || a.current.Messages[2].Text != "" {
		t.Fatal("structured replay did not install its three explicit local examples")
	}
	cache := a.messageImages
	if cache == nil || len(cache.Entries) != 1 || cache.Used != 320*160*4 || cache.Used > historyThumbnailBudget || cache.Registered || cache.Registering || cache.Active != 0 || cache.Client != nil {
		t.Fatal("synthetic images must share one bounded preloaded bitmap, never a Remote read/owner")
	}
	for _, e := range cache.Entries {
		if e.Bitmap == nil || e.Ref.Width != 320 || e.Ref.Height != 160 {
			t.Fatal("synthetic bitmap or original dimensions missing")
		}
	}
	images := messageImageReferences(a.current.Messages[0])
	if len(images) != 3 || imageReferenceKey(images[0]) != imageReferenceKey(images[1]) || imageReferenceKey(images[1]) != imageReferenceKey(images[2]) {
		t.Fatal("fixture must use adjacent repeat plus text-separated singleton")
	}
	var payload map[string]any
	if json.Unmarshal(a.current.Messages[1].AssistantBlocks[0].Block, &payload) != nil {
		t.Fatal("fixture unknown block has invalid JSON")
	}
	if len(utf16.Encode([]rune(payload["detail"].(string)))) <= 20000 {
		t.Fatal("fixture does not reach the original UTF16 display cap")
	}
	for i := range a.sessions {
		a.sessions[i].Running = false
	}
	tt := ui.NewTester(a.view, 1280, 820)
	tt.Frame()
	if !tt.HasText("本地界面回放") || !tt.HasText("模拟数据") || !tt.HasText("未知内容块") {
		t.Fatal("replay must be visibly local and include the closed unknown-block control")
	}
	if cache.Registered || cache.Registering || cache.Active != 0 || a.client != nil {
		t.Fatal("replay drawing started a Remote activity")
	}
}
