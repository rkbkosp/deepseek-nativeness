package main

import (
	"bytes"
	"encoding/json"
	"github.com/egoist/mygo/ui"
	"image"
	"image/color"
	"image/png"
	"strings"
)

// applyDemoDocument is the sole CLI document dispatcher. Passing a document
// flag during a normal authenticated launch cannot replace the real selection.
func (a *app) applyDemoDocument(kind string) bool {
	if !a.demo || kind == "" {
		return false
	}
	switch kind {
	case "images":
		a.installImageFixture()
	case "structured":
		a.installStructuredMessageFixture()
	default:
		a.current.Messages = []message{{ID: "render-fixture", Role: "assistant", Kind: "assistant", Text: renderFixture(kind)}}
		a.invalidateChatRows()
		a.reindexMessages()
	}
	return true
}

// Explicit local replay only: all content and pixels below are generated here.
// There is no file resource behind the JSON reference and no Remote identity,
// owner registration, attachment request or task is involved.
func (a *app) installStructuredMessageFixture() {
	if !a.demo {
		return
	}
	source := image.NewRGBA(image.Rect(0, 0, 320, 160))
	for y := 0; y < 160; y++ {
		for x := 0; x < 320; x++ {
			source.SetRGBA(x, y, color.RGBA{R: uint8(45 + x*150/320), G: uint8(75 + y*130/160), B: 170, A: 255})
		}
	}
	var encoded bytes.Buffer
	if png.Encode(&encoded, source) != nil {
		a.error = "无法生成本地回放图片"
		return
	}
	ref := imageAttachment{AttachmentID: "synthetic-structured-image", MediaType: "image/png", Bytes: int64(encoded.Len()), Width: 320, Height: 160, Name: "本地合成图片（模拟）"}
	attachment, _ := json.Marshal(ref)
	payload, _ := json.Marshal(struct {
		Type       string         `json:"type"`
		Attachment map[string]any `json:"attachment"`
		Note       string         `json:"note"`
		Detail     string         `json:"detail"`
	}{"file", map[string]any{"attachmentId": "synthetic-json-metadata-only", "name": "回放数据.csv", "bytes": 4}, "这只是本机合成的JSON元数据，没有真实文件或下载内容。", strings.Repeat("本地回放😀 ", 3000)})
	intro := "本地结构化消息回放（模拟数据）\n\n两张相邻图片使用同一个合成引用，下面应显示为同一组64px缩略图。"
	separator := "以下文字隔开图片组；接下来的单图按原版240px长边显示。"
	a.current = snapshot{SessionID: a.sessionID, Messages: []message{
		{ID: "synthetic-gallery", Role: "assistant", Kind: "assistant", Turn: 1, Text: intro + "\n\n" + separator, AssistantBlocks: []assistantBlock{{Kind: "text", Text: intro}, {Kind: "image", Attachment: attachment}, {Kind: "image", Attachment: attachment}, {Kind: "text", Text: separator}, {Kind: "image", Attachment: attachment}}},
		{ID: "synthetic-unknown", Role: "assistant", Kind: "assistant", Turn: 2, AssistantBlocks: []assistantBlock{{Kind: "other", Block: payload}}},
		{ID: "synthetic-empty-stopped", Role: "assistant", Kind: "assistant", Turn: 3, Interrupted: true},
	}}
	a.resetMessageImages()
	cache := a.historyImages()
	size := int64(len(source.Pix))
	cache.evict(size)
	cache.Entries[imageReferenceKey(ref)] = &historyImageEntry{Ref: ref, Bitmap: ui.NewBitmap(source), Bytes: size, Seen: 1}
	cache.Used = size
	cache.Tick = 1
	a.status = "本地结构化消息回放 · 模拟数据"
	a.list = ui.ListState{FollowEnd: false}
	a.invalidateChatRows()
	a.reindexMessages()
}
