package main

import (
	"bytes"
	"encoding/json"
	"github.com/egoist/mygo/ui"
	"image"
	"image/color"
	"image/png"
)

// Only --demo --demo-document images calls this. No identity, Host or network.
func (a *app) installImageFixture() {
	source := image.NewRGBA(image.Rect(0, 0, 720, 360))
	for y := 0; y < 360; y++ {
		for x := 0; x < 720; x++ {
			source.SetRGBA(x, y, color.RGBA{uint8(40 + x*140/720), uint8(70 + y*140/360), 160, 255})
		}
	}
	var encoded bytes.Buffer
	if png.Encode(&encoded, source) != nil {
		return
	}
	ref := imageAttachment{AttachmentID: "synthetic-history-image", MediaType: "image/png", Bytes: int64(encoded.Len()), Width: 720, Height: 360, Name: "图片示意（模拟）"}
	bitmap, size, err := thumbnailBitmap(encoded.Bytes(), ref)
	if err != nil {
		return
	}
	cache := a.historyImages()
	cache.Entries[imageReferenceKey(ref)] = &historyImageEntry{Ref: ref, Bitmap: bitmap, Bytes: size}
	cache.Used = size
	attachment, _ := json.Marshal(ref)
	userBlocks, _ := json.Marshal([]any{map[string]any{"type": "text", "text": "这是一张用于本机验证的合成示意图。"}, map[string]any{"type": "image", "attachment": ref}})
	a.current.Messages = []message{{ID: "synthetic-user", Kind: "user", Role: "user", Text: "这是一张用于本机验证的合成示意图。", Blocks: userBlocks}, {ID: "synthetic-assistant", Kind: "assistant", Role: "assistant", Text: "原生图片缩略图验证。\n\n```go\nfmt.Println(\"Synthetic image fixture, no Remote connection\")\n```", AssistantBlocks: []assistantBlock{{Kind: "text", Text: "原生缩略图按原版 240px 长边显示，以下内容全部为模拟数据。"}, {Kind: "image", Attachment: attachment}, {Kind: "text", Text: "```go\nfmt.Println(\"Synthetic image fixture, no Remote connection\")\n```"}}}}
	a.current.Running = false
	a.list = ui.ListState{FollowEnd: false}
	a.invalidateChatRows()
}
