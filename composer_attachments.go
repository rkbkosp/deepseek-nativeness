package main

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	_ "golang.org/x/image/webp"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// Inline images are a Host prompt capability. Generic files need a staged
// same-session receipt, which the current Remote carrier does not expose.
type composerContentPart struct {
	Type      string `json:"type"`
	ReceiptID string `json:"receiptId,omitempty"`
	Text      string `json:"text,omitempty"`
	MediaType string `json:"mediaType,omitempty"`
	Data      string `json:"data,omitempty"`
	Name      string `json:"name,omitempty"`
}
type composerImageLimits struct {
	MaxImageBytes        int64    `json:"maxImageBytes"`
	MaxImagesPerMessage  int      `json:"maxImagesPerMessage"`
	MaxMessageImageBytes int64    `json:"maxMessageImageBytes"`
	MaxImagePixels       int64    `json:"maxImagePixels"`
	MaxImageDimension    int      `json:"maxImageDimension"`
	MediaTypes           []string `json:"mediaTypes"`
}
type composerDraftImage struct {
	ID, Name, MediaType, Data string
	Bytes                     int64
	Width, Height             int
	Preview                   ui.ImageSource
	ThumbnailLoading          bool
	ThumbnailFailed           bool
	ThumbnailUsed             uint64
}
type composerDraftState struct {
	Images           []composerDraftImage
	Loading          bool
	Error            string
	PreviewID        string
	Preview          ui.ImageSource
	PreviewLoading   bool
	RailScroll       ui.ScrollState
	ThumbnailWorkers int
	ThumbnailClock   uint64
	ThumbnailEpoch   uint64
	Files            []composerDraftFile
	FileLoading      bool
	FileError        string
}

type composerDraftFile struct {
	ID, Name, ReceiptID, Path string
	Bytes                     int64
}

func (a *app) composerArtifacts() *composerDraftState {
	if a.composerDrafts == nil {
		a.composerDrafts = map[string]*composerDraftState{}
	}
	key := a.viewKey(a.sessionID)
	state := a.composerDrafts[key]
	if state == nil {
		state = &composerDraftState{}
		a.composerDrafts[key] = state
	}
	if a.composerCurrent(a.composer) {
		a.composer.artifacts = state
	}
	return state
}
func (a *app) acceptComposerAttachments(intent *sendIntent) {
	if len(intent.AttachmentIDs) == 0 {
		return
	}
	state := a.composerDrafts[intent.StoreKey]
	if state == nil {
		return
	}
	sent := map[string]bool{}
	for _, id := range intent.AttachmentIDs {
		sent[id] = true
	}
	remaining := state.Images[:0]
	for _, img := range state.Images {
		if !sent[img.ID] {
			remaining = append(remaining, img)
		}
	}
	clear(state.Images[len(remaining):])
	state.Images = remaining
	if sent[state.PreviewID] {
		state.PreviewID = ""
		state.Preview = nil
	}
	state.Files = nil
}
func (l *composerImageLimits) available() bool {
	return l != nil && l.MaxImageBytes > 0 && l.MaxImagesPerMessage > 0 && l.MaxMessageImageBytes > 0 && l.MaxImagePixels > 0 && l.MaxImageDimension > 0 && len(l.MediaTypes) > 0
}
func composerImageError(code string) error { return fmt.Errorf("%s", code) }
func composerDecodeDraftImage(raw []byte, name string, limits *composerImageLimits) (composerDraftImage, error) {
	if !limits.available() {
		return composerDraftImage{}, composerImageError("图片限制尚未加载，请重新打开会话。")
	}
	if int64(len(raw)) > limits.MaxImageBytes {
		return composerDraftImage{}, composerImageError("图片超过单张大小限制。")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return composerDraftImage{}, composerImageError("无法读取此图片，请使用 PNG、JPEG、WebP 或 GIF。")
	}
	media := map[string]string{"png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp", "gif": "image/gif"}[format]
	if media == "" || !slices.Contains(limits.MediaTypes, media) {
		return composerDraftImage{}, composerImageError("此会话不支持这种图片格式。")
	}
	if config.Width <= 0 || config.Height <= 0 {
		return composerDraftImage{}, composerImageError("图片尺寸无效。")
	}
	if config.Width > limits.MaxImageDimension || config.Height > limits.MaxImageDimension {
		return composerDraftImage{}, composerImageError("图片长宽超过当前会话限制。")
	}
	if int64(config.Width) > limits.MaxImagePixels/int64(config.Height) {
		return composerDraftImage{}, composerImageError("图片像素过多，请缩小后再添加。")
	}
	// ImageIO validates and downsamples directly; never allocate source-sized RGBA.
	if _, err := composerThumbnail(raw, 160); err != nil {
		return composerDraftImage{}, composerImageError("图片内容损坏，请重新导出后添加。")
	}
	return composerDraftImage{ID: rand.Text(), Name: filepath.Base(name), MediaType: media, Data: base64.StdEncoding.EncodeToString(raw), Bytes: int64(len(raw)), Width: config.Width, Height: config.Height}, nil
}

var composerPickImages = func(win *mygo.Window) ([]string, error) {
	return mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: win, Title: "添加图片", Multiple: true, Filters: []mygo.FileFilter{{Name: "图片", Extensions: []string{"png", "jpg", "jpeg", "webp", "gif"}}}})
}

func (a *app) composerChooseImages() {
	s := a.composer
	if !a.composerCurrent(s) || !a.connected || a.busy || !s.values.ImageLimits.available() {
		return
	}
	state := a.composerArtifacts()
	if state.Loading {
		return
	}
	state.Loading = true
	state.Error = ""
	go func() {
		paths, err := composerPickImages(a.win)
		a.update(func() {
			if !a.composerCurrent(s) {
				state.Loading = false
				return
			}
			state.Loading = false
			if err != nil {
				state.Error = err.Error()
				return
			}
			if len(paths) > 0 {
				a.composerAddImageFiles(paths)
			}
		})
	}()
}
func validateDroppedImagePaths(paths []string) error {
	for _, path := range paths {
		info, err := os.Stat(path)
		if err != nil {
			return fmt.Errorf("无法读取拖入的文件。")
		}
		if info.IsDir() {
			return fmt.Errorf("暂不支持拖入文件夹，请选择图片文件。")
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("请选择图片文件。")
		}
	}
	return nil
}

func (a *app) composerAddImageFiles(paths []string) {
	s := a.composer
	if !a.composerCurrent(s) || !a.connected || a.busy {
		return
	}
	state := a.composerArtifacts()
	if state.Loading {
		return
	}
	limits := s.values.ImageLimits
	if !limits.available() {
		state.Error = "图片限制尚未加载，请重新打开会话。"
		return
	}
	if err := validateDroppedImagePaths(paths); err != nil {
		state.Error = err.Error()
		return
	}
	if len(state.Images)+len(paths) > limits.MaxImagesPerMessage {
		state.Error = "添加后图片数量超过当前会话限制。"
		return
	}
	captured := *limits
	captured.MediaTypes = append([]string(nil), limits.MediaTypes...)
	state.Loading = true
	state.Error = ""
	existingBytes := int64(0)
	for _, img := range state.Images {
		existingBytes += img.Bytes
	}
	go func() {
		images := []composerDraftImage{}
		total := existingBytes
		var failure error
		for _, path := range paths {
			file, err := os.Open(path)
			if err != nil {
				failure = fmt.Errorf("无法读取所选图片。")
				break
			}
			info, err := file.Stat()
			if err != nil || !info.Mode().IsRegular() {
				_ = file.Close()
				failure = fmt.Errorf("请选择图片文件。")
				break
			}
			if info.Size() > captured.MaxImageBytes {
				_ = file.Close()
				failure = fmt.Errorf("图片超过单张大小限制。")
				break
			}
			raw, err := io.ReadAll(io.LimitReader(file, captured.MaxImageBytes+1))
			_ = file.Close()
			if err != nil {
				failure = fmt.Errorf("无法读取所选图片。")
				break
			}
			img, err := composerDecodeDraftImage(raw, filepath.Base(path), &captured)
			if err != nil {
				failure = err
				break
			}
			total += img.Bytes
			if total > captured.MaxMessageImageBytes {
				failure = fmt.Errorf("图片总大小超过当前会话限制。")
				break
			}
			images = append(images, img)
		}
		a.update(func() {
			state.Loading = false
			if !a.composerCurrent(s) {
				return
			}
			if failure != nil {
				state.Error = failure.Error()
				return
			}
			if len(state.Images)+len(images) > captured.MaxImagesPerMessage {
				state.Error = "图片数量已改变，请重新添加。"
				return
			}
			state.Images = append(state.Images, images...)
		})
	}()
}
func (a *app) composerImagePayload() (parts []composerContentPart, ids []string, err error) {
	state := a.composerArtifacts()
	if state.Loading {
		return nil, nil, fmt.Errorf("图片仍在读取，请稍候。")
	}
	if len(state.Images) == 0 && len(state.Files) == 0 {
		return nil, nil, nil
	}
	if len(state.Images) == 0 {
		if text := strings.TrimSpace(a.draft); text != "" {
			parts = append(parts, composerContentPart{Type: "text", Text: text})
		}
		mentions := ""
		for _, file := range state.Files {
			if file.Path != "" {
				mentions += " @" + file.Path
			} else {
				parts = append(parts, composerContentPart{Type: "file", ReceiptID: file.ReceiptID, Name: file.Name})
			}
		}
		if mentions != "" {
			if len(parts) > 0 && parts[0].Type == "text" {
				parts[0].Text += mentions
			} else {
				parts = append([]composerContentPart{{Type: "text", Text: strings.TrimSpace(mentions)}}, parts...)
			}
		}
		return parts, nil, nil
	}
	s := a.composer
	if !a.composerCurrent(s) || !s.values.ImageLimits.available() {
		return nil, nil, fmt.Errorf("图片限制尚未加载，请重新打开会话。")
	}
	limits := s.values.ImageLimits
	if len(state.Images) > limits.MaxImagesPerMessage {
		return nil, nil, fmt.Errorf("图片数量超过当前会话限制。")
	}
	total := int64(0)
	if text := strings.TrimSpace(a.draft); text != "" {
		parts = append(parts, composerContentPart{Type: "text", Text: text})
	}
	for _, img := range state.Images {
		total += img.Bytes
		if img.Width <= 0 || img.Height <= 0 || img.Bytes > limits.MaxImageBytes || img.Width > limits.MaxImageDimension || img.Height > limits.MaxImageDimension || int64(img.Width) > limits.MaxImagePixels/int64(img.Height) || !slices.Contains(limits.MediaTypes, img.MediaType) {
			return nil, nil, fmt.Errorf("图片不符合当前会话限制，请移除后重新添加。")
		}
		parts = append(parts, composerContentPart{Type: "image", MediaType: img.MediaType, Data: img.Data, Name: img.Name})
		ids = append(ids, img.ID)
	}
	if total > limits.MaxMessageImageBytes {
		return nil, nil, fmt.Errorf("图片总大小超过当前会话限制。")
	}
	mentions := ""
	for _, file := range state.Files {
		if file.Path != "" {
			mentions += " @" + file.Path
		} else {
			parts = append(parts, composerContentPart{Type: "file", ReceiptID: file.ReceiptID, Name: file.Name})
		}
	}
	if mentions != "" {
		if len(parts) > 0 && parts[0].Type == "text" {
			parts[0].Text += mentions
		} else {
			parts = append([]composerContentPart{{Type: "text", Text: strings.TrimSpace(mentions)}}, parts...)
		}
	}
	return parts, ids, nil
}
