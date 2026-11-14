package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/transfer"
	"github.com/egoist/mygo/ui"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func composerFixturePNG(t *testing.T) []byte {
	t.Helper()
	im := image.NewNRGBA(image.Rect(0, 0, 2, 3))
	im.SetNRGBA(0, 0, color.NRGBA{R: 180, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, im); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
func composerFixtureLimits() *composerImageLimits {
	return &composerImageLimits{MaxImageBytes: 262144, MaxImagesPerMessage: 4, MaxMessageImageBytes: 524288, MaxImagePixels: 1048576, MaxImageDimension: 1024, MediaTypes: []string{"image/png", "image/jpeg", "image/webp", "image/gif"}}
}
func TestComposerImageAdmissionUsesAllSixHostLimits(t *testing.T) {
	raw := composerFixturePNG(t)
	base := composerFixtureLimits()
	img, err := composerDecodeDraftImage(raw, "/private/fixture/photo.png", base)
	if err != nil || img.Name != "photo.png" || img.Width != 2 || img.Height != 3 || img.MediaType != "image/png" {
		t.Fatalf("valid admission %+v %v", img, err)
	}
	if data, err := base64.StdEncoding.DecodeString(img.Data); err != nil || !bytes.Equal(data, raw) {
		t.Fatal("image content changed")
	}
	for _, tc := range []struct {
		name   string
		change func(*composerImageLimits)
	}{{"bytes", func(l *composerImageLimits) { l.MaxImageBytes = int64(len(raw) - 1) }}, {"pixels", func(l *composerImageLimits) { l.MaxImagePixels = 5 }}, {"dimension", func(l *composerImageLimits) { l.MaxImageDimension = 2 }}, {"media", func(l *composerImageLimits) { l.MediaTypes = []string{"image/jpeg"} }}, {"missing", func(l *composerImageLimits) { l.MaxImagePixels = 0 }}} {
		t.Run(tc.name, func(t *testing.T) {
			l := *base
			tc.change(&l)
			if _, err := composerDecodeDraftImage(raw, "photo.png", &l); err == nil {
				t.Fatal("limit bypass")
			}
		})
	}
	f := newComposerTestPeer(t)
	a := f.a
	a.composer.values.ImageLimits = base
	state := a.composerArtifacts()
	state.Images = []composerDraftImage{img, img}
	a.composer.values.ImageLimits.MaxImagesPerMessage = 1
	if _, _, err := a.composerImagePayload(); err == nil {
		t.Fatal("count limit bypass")
	}
	a.composer.values.ImageLimits.MaxImagesPerMessage = 4
	a.composer.values.ImageLimits.MaxMessageImageBytes = img.Bytes*2 - 1
	if _, _, err := a.composerImagePayload(); err == nil {
		t.Fatal("aggregate byte limit bypass")
	}
}
func TestComposerPickerImportPreviewRemovalAndCapturedAttachmentSettlement(t *testing.T) {
	f := newComposerTestPeer(t)
	a := f.a
	a.composer.values.ImageLimits = composerFixtureLimits()
	path := filepath.Join(t.TempDir(), "photo.png")
	if err := os.WriteFile(path, composerFixturePNG(t), 0600); err != nil {
		t.Fatal(err)
	}
	picker := composerPickImages
	composerPickImages = func(*mygo.Window) ([]string, error) { return []string{path}, nil }
	defer func() { composerPickImages = picker }()
	a.composerChooseImages()
	state := a.composerArtifacts()
	f.until(t, func() bool { return !state.Loading })
	if len(state.Images) != 1 {
		t.Fatalf("picker import: %s", state.Error)
	}
	tt := ui.NewTester(a.composerView, 900, 600)
	if _, ok := tt.Find("预览图片 photo.png"); !ok {
		t.Fatal("no actual image rail button")
	}
	if err := tt.Click("预览图片 photo.png"); err != nil {
		t.Fatal(err)
	}
	f.until(t, func() bool { return state.Preview != nil })
	tt.Frame()
	if _, ok := tt.Find("关闭图片预览"); !ok {
		t.Fatal("preview didn't open")
	}
	if err := tt.Click("关闭图片预览"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if state.PreviewID != "" || state.Preview != nil {
		t.Fatal("preview retained decoded full image")
	}
	sent := state.Images[0]
	added := sent
	added.ID = "newer-image"
	state.Images = append(state.Images, added)
	key := a.viewKey(a.sessionID)
	a.acceptComposerAttachments(&sendIntent{StoreKey: key, AttachmentIDs: []string{sent.ID}})
	if len(state.Images) != 1 || state.Images[0].ID != "newer-image" {
		t.Fatal("receipt removed newly added attachment")
	}
	a.composerRemoveImage(state, added.ID)
	if len(state.Images) != 0 {
		t.Fatal("remove control didn't remove image")
	}
}
func TestComposerClipboardAndFileDropUseRealFrameworkPaths(t *testing.T) {
	f := newComposerTestPeer(t)
	a := f.a
	a.composer.values.ImageLimits = composerFixtureLimits()
	raw := composerFixturePNG(t)
	tt := ui.NewTester(a.composerView, 900, 600)
	if err := tt.Click("消息输入框"); err != nil {
		t.Fatal(err)
	}
	tt.SetClipboardData(transfer.New(transfer.NewItem(transfer.Bytes(transfer.PNG, raw))))
	tt.Key(ui.Cmd, ui.KeyV)
	state := a.composerArtifacts()
	f.until(t, func() bool { return !state.Loading && len(state.Images) == 1 })
	tt.Frame()
	path := filepath.Join(t.TempDir(), "dropped.png")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	r, _ := tt.Find("消息输入框")
	if !tt.DropFiles(r.X+5, r.Y+5, path) {
		t.Fatal("real file-drop event not accepted")
	}
	f.until(t, func() bool { return !state.Loading && len(state.Images) == 2 })
	if a.pendingRequests != 0 {
		t.Fatal("intake sent a prompt")
	}
}
func TestComposerSessionReferencesUseHostMentionAndDoNotQueryInsideQuotedPath(t *testing.T) {
	f := newComposerTestPeer(t)
	a := f.a
	a.operationCaps["listSessionReferences"] = operationCapability{Supported: true}
	a.draft = "参考 @oth 尾部"
	s := a.composer
	a.updateComposerCompletions(s, 7)
	f.until(t, func() bool { return len(s.completions) == 3 })
	found := -1
	for i, item := range s.completions {
		if item.Kind == "session" {
			found = i
			break
		}
	}
	if found < 0 {
		t.Fatal("Host session mention missing")
	}
	s.highlight = found
	expected := s.completions[found].Replacement
	text, _, ok := composerComplete(s, a.draft)
	if !ok || text != "参考 "+expected+" 尾部" {
		t.Fatalf("canonical mention not preserved: %q", text)
	}
	ref := composerSessionReference{SessionID: "wrong", Mention: strings.TrimSpace(expected)}
	if composerValidSessionMention(ref) {
		t.Fatal("mismatched Host candidate id accepted")
	}
	_, before := f.calls(t)
	count := 0
	for _, r := range before {
		if r.Method == "listSessionReferences" {
			count++
		}
	}
	a.draft = "@\"中文 path"
	a.updateComposerCompletions(s, len([]rune(a.draft)))
	f.until(t, func() bool { return len(s.completions) == 2 })
	_, after := f.calls(t)
	next := 0
	for _, r := range after {
		if r.Method == "listSessionReferences" {
			next++
		}
	}
	if next != count {
		t.Fatal("quoted file path queried session mentions")
	}
}
func TestComposerPermissionParameterPickerExecutesAndConsumesOnlyAcceptedDraft(t *testing.T) {
	f := newComposerTestPeer(t)
	a := f.a
	a.reloadComposer()
	f.until(t, func() bool { return len(a.composer.permissions) == 4 && a.composer.values.Permissions != nil })
	tt := ui.NewTester(a.composerView, 900, 600)
	if err := tt.Click("消息输入框"); err != nil {
		t.Fatal(err)
	}
	tt.Type("/permission read")
	tt.Frame()
	if len(a.composer.completions) != 1 || a.composer.completions[0].Kind != "permission" {
		t.Fatal("no parameter picker")
	}
	tt.Key(0, ui.KeyEnter)
	f.settle(t)
	f.until(t, func() bool { return a.composerPermissionLabel() == "仅可查看" })
	tt.Frame()
	if a.draft != "" {
		t.Fatal("accepted parameter command retained draft")
	}
	calls, _ := f.calls(t)
	found := false
	for _, call := range calls {
		if call.Endpoint == "commands/execute" {
			var line string
			_ = json.Unmarshal(call.Args["line"], &line)
			if line == "/permission read-only" {
				found = true
			}
		}
	}
	if !found {
		t.Fatal("picker did not use exact command writer")
	}
}
func TestComposerQueueButtonsEditRemoveAndSteerThroughActualBridge(t *testing.T) {
	f := newComposerTestPeer(t)
	a := f.a
	a.current.Running = true
	a.reloadComposer()
	f.until(t, func() bool { return len(a.composer.values.Inbox["next-turn"]) == 2 })
	a.composer.queueExpanded = true
	tt := ui.NewTester(a.composerView, 900, 700)
	if err := tt.Click("编辑待发送消息"); err != nil {
		t.Fatal(err)
	}
	tt.Frame()
	if err := tt.Click("编辑待发送消息"); err != nil {
		t.Fatal(err)
	}
	tt.Key(ui.Cmd, ui.KeyA)
	tt.Type("Edited through actual native control")
	if err := tt.Click("保存"); err != nil {
		t.Fatal(err)
	}
	f.settle(t)
	f.until(t, func() bool { return a.composer.editingID == "" })
	tt.Frame()
	if err := tt.Click("移除待发送消息"); err != nil {
		t.Fatal(err)
	}
	f.settle(t)
	f.until(t, func() bool { return len(a.composer.values.Inbox["next-turn"]) == 1 })
	tt.Frame()
	if err := tt.Click("立即发送此消息"); err != nil {
		t.Fatal(err)
	}
	f.settle(t)
	f.until(t, func() bool { return len(a.composer.values.Inbox["next-turn"]) == 0 })
	calls, _ := f.calls(t)
	kinds := map[string]int{}
	for _, call := range calls {
		if call.Endpoint != "session/updateQueue" {
			continue
		}
		var req struct{ Action struct{ Kind string } }
		_ = json.Unmarshal(call.Args["request"], &req)
		kinds[req.Action.Kind]++
	}
	if kinds["edit"] != 1 || kinds["remove"] != 1 || kinds["steer"] != 1 {
		t.Fatalf("actual control actions %+v", kinds)
	}
}

func TestComposerInlineImagesCrossActualRemoteAdapterAndRetainUnknownDraft(t *testing.T) {
	for _, text := range []string{"", "image with text", "fixture image unknown"} {
		t.Run(text, func(t *testing.T) {
			f := newComposerTestPeer(t)
			a := f.a
			a.composer.values.ImageLimits = composerFixtureLimits()
			img, err := composerDecodeDraftImage(composerFixturePNG(t), "fixture.png", composerFixtureLimits())
			if err != nil {
				t.Fatal(err)
			}
			state := a.composerArtifacts()
			state.Images = []composerDraftImage{img}
			a.draft = text
			a.composerSubmit(false)
			f.settle(t)
			calls, requests := f.calls(t)
			n := 0
			for _, call := range calls {
				if call.Endpoint == "session/prompt" {
					n++
					var req struct {
						Content []composerContentPart `json:"content"`
						Text    *string               `json:"text"`
					}
					if err := json.Unmarshal(call.Args["request"], &req); err != nil {
						t.Fatal(err)
					}
					if req.Text != nil || len(req.Content) == 0 || req.Content[len(req.Content)-1].Type != "image" {
						t.Fatalf("bad actual Host request: %+v", req)
					}
					if text != "" && req.Content[0].Text != text {
						t.Fatal("text/image mismatch")
					}
				}
			}
			if n != 1 {
				t.Fatalf("actual Host dispatch %d, error=%s requests=%+v", n, a.error, requests)
			}
			if text == "fixture image unknown" {
				if len(state.Images) != 1 || a.draft != text {
					t.Fatal("unknown discarded content")
				}
				a.composerSubmit(false)
				f.settle(t)
				calls, _ = f.calls(t)
				n = 0
				for _, call := range calls {
					if call.Endpoint == "session/prompt" {
						n++
					}
				}
				if n != 1 {
					t.Fatal("unknown replayed actual Host mutation")
				}
			} else if len(state.Images) != 0 || a.draft != "" {
				t.Fatalf("accepted content not settled: %d %q %s", len(state.Images), a.draft, a.error)
			}
		})
	}
}
func TestComposerThumbnailBudgetExitAndLateDecodeEpoch(t *testing.T) {
	raw := composerFixturePNG(t)
	source, err := composerThumbnail(raw, 160)
	if err != nil {
		t.Fatal(err)
	}
	state := &composerDraftState{}
	for i := 0; i < 100; i++ {
		state.Images = append(state.Images, composerDraftImage{ID: fmt.Sprint(i), Data: base64.StdEncoding.EncodeToString(raw), Preview: source, ThumbnailUsed: uint64(i)})
	}
	state.evictThumbnails("99")
	count := 0
	for _, img := range state.Images {
		if img.Preview != nil {
			count++
		}
	}
	if count*composerThumbnailReservation > composerThumbnailBudget || state.Images[99].Preview == nil {
		t.Fatal("thumbnail budget/active entry violated")
	}
	state.Preview = source
	state.PreviewID = "99"
	epoch := state.ThumbnailEpoch
	state.releaseDecodedImages()
	if state.ThumbnailEpoch == epoch || state.Preview != nil || state.PreviewID != "" {
		t.Fatal("exit did not retire decoded preview")
	}
	for _, img := range state.Images {
		if img.Preview != nil || img.Data == "" {
			t.Fatal("exit must release decoded memory and retain original compressed draft")
		}
	}
	f := newComposerTestPeer(t)
	a := f.a
	state = a.composerArtifacts()
	state.Images = []composerDraftImage{{ID: "late", Data: base64.StdEncoding.EncodeToString(raw)}}
	a.composerLoadThumbnail(state, "late")
	state.releaseDecodedImages()
	f.until(t, func() bool { return state.ThumbnailWorkers == 0 })
	if state.Images[0].Preview != nil {
		t.Fatal("late worker repopulated retired session cache")
	}
}

func TestComposerLateImageReceiptKeepsNewTextAndFreshAttachmentThroughActualHelper(t *testing.T) {
	f := newComposerTestPeer(t)
	a := f.a
	a.composer.values.ImageLimits = composerFixtureLimits()
	state := a.composerArtifacts()
	img, err := composerDecodeDraftImage(composerFixturePNG(t), "fixture.png", composerFixtureLimits())
	if err != nil {
		t.Fatal(err)
	}
	state.Images = []composerDraftImage{img}
	a.draft = "fixture delayed image"
	a.composerSubmit(false)
	if _, err := a.client.Call(f.ctx, "fixture.waitPrompt", map[string]any{}); err != nil {
		t.Fatal(err)
	}
	fresh := img
	fresh.ID = "fresh-after-send"
	state.Images = append(state.Images, fresh)
	a.draft = "new edit after image send"
	if _, err := a.client.Call(f.ctx, "fixture.releasePrompt", map[string]any{}); err != nil {
		t.Fatal(err)
	}
	f.settle(t)
	if len(state.Images) != 1 || state.Images[0].ID != fresh.ID || a.draft != "new edit after image send" {
		t.Fatalf("late receipt consumed newer draft: %+v %q", state.Images, a.draft)
	}
}
