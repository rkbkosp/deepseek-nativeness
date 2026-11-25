package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"math"
	"native-dsh/desktop/internal/bridge"
	"os"
	"path/filepath"
	"time"
)

type imageAttachment struct {
	AttachmentID       string `json:"attachmentId"`
	MediaType          string `json:"mediaType"`
	Bytes              int64  `json:"bytes"`
	Width              int    `json:"width"`
	Height             int    `json:"height"`
	Name               string `json:"name,omitempty"`
	OriginalDimensions *struct {
		Width  int `json:"width"`
		Height int `json:"height"`
	} `json:"originalDimensions,omitempty"`
}
type historyImageEntry struct {
	Ref     imageAttachment
	Bitmap  *ui.Bitmap
	Error   string
	Loading bool
	Seen    uint64
	Bytes   int64
}
type historyImageCache struct {
	Client                  *bridge.Client
	Owner                   string
	Registering, Registered bool
	Host, Session           string
	Generation              uint64
	Entries                 map[string]*historyImageEntry
	Used                    int64
	Tick                    uint64
	Active                  int
	Context                 context.Context
	Cancel                  context.CancelFunc
}

const historyThumbnailBudget = 8 * 1024 * 1024
const historyThumbnailEntries = 16

func (a *app) resetMessageImages() {
	if a.messageImages != nil {
		cache := a.messageImages
		a.messageImages = nil
		cache.Cancel()
		releaseRemoteOwner(cache.Client, cache.Owner)
	}
}
func (a *app) historyImages() *historyImageCache {
	if a.messageImages != nil && (a.messageImages.Client != a.client || a.messageImages.Host != a.hostID || a.messageImages.Session != a.sessionID || a.messageImages.Generation != a.remoteGeneration) {
		a.resetMessageImages()
	}
	if a.messageImages == nil {
		ctx, cancel := context.WithCancel(a.ctx)
		a.messageImages = &historyImageCache{Client: a.client, Owner: newPageOwner(), Host: a.hostID, Session: a.sessionID, Generation: a.remoteGeneration, Entries: map[string]*historyImageEntry{}, Context: ctx, Cancel: cancel}
	}
	return a.messageImages
}
func imageReferenceKey(ref imageAttachment) string {
	data, _ := json.Marshal(ref)
	return fmt.Sprintf("%x", sha256.Sum256(data))
}
func (c *historyImageCache) evict(extra int64) {
	for len(c.Entries) >= historyThumbnailEntries || c.Used+extra > historyThumbnailBudget {
		key := ""
		old := ^uint64(0)
		for id, e := range c.Entries {
			if !e.Loading && e.Seen < old {
				key, old = id, e.Seen
			}
		}
		if key == "" {
			return
		}
		c.Used -= c.Entries[key].Bytes
		delete(c.Entries, key)
	}
}
func validImageReference(ref imageAttachment) bool {
	return ref.AttachmentID != "" && len(ref.AttachmentID) <= 256 && len(ref.Name) <= 1024 && ref.Width > 0 && ref.Height > 0 && ref.Bytes > 0 && (ref.MediaType == "image/png" || ref.MediaType == "image/jpeg" || ref.MediaType == "image/webp" || ref.MediaType == "image/gif")
}
func messageImageReferences(m message) []imageAttachment {
	var refs []imageAttachment
	add := func(raw json.RawMessage) {
		var ref imageAttachment
		if json.Unmarshal(raw, &ref) == nil && validImageReference(ref) {
			refs = append(refs, ref)
		}
	}
	if len(m.AssistantBlocks) > 0 {
		for _, b := range m.AssistantBlocks {
			if b.Kind == "image" {
				add(b.Attachment)
			}
		}
		return refs
	}
	raw := m.Blocks
	if len(raw) == 0 && m.Tool != nil {
		raw = m.Tool.Content
	}
	var blocks []struct {
		Type       string          `json:"type"`
		Attachment json.RawMessage `json:"attachment"`
	}
	if json.Unmarshal(raw, &blocks) == nil {
		for _, b := range blocks {
			if b.Type == "image" {
				add(b.Attachment)
			}
		}
	}
	return refs
}
func singleImageFit(w, h int) (float32, float32, float32, float32) {
	ratio := float64(w) / float64(h)
	clamped := math.Min(4, math.Max(.25, ratio))
	bw, bh := 240.0, 240.0/clamped
	if clamped < 1 {
		bw, bh = 240*clamped, 240
	}
	scale := math.Min(1, math.Min(float64(w)/bw, float64(h)/bh))
	x, y := float32(.5), float32(.5)
	if ratio < .25 {
		y = 0
	}
	if ratio > 4 {
		x = 0
	}
	return float32(math.Max(1, math.Round(bw*scale))), float32(math.Max(1, math.Round(bh*scale))), x, y
}
func thumbnailBitmap(encoded []byte, ref imageAttachment) (*ui.Bitmap, int64, error) {
	thumb, err := decodeHistoryThumbnail(encoded, ref, 480)
	if err != nil {
		return nil, 0, err
	}
	return ui.NewBitmap(thumb), int64(len(thumb.Pix)), nil
}

func (a *app) loadHistoryImage(cache *historyImageCache, key string, entry *historyImageEntry) {
	if a.demo || a.settingsOpen || a.client == nil || !a.connected || entry.Loading || entry.Bitmap != nil || entry.Error != "" || cache.Active >= 2 {
		return
	}
	if entry.Ref.Bytes > 8*1024*1024 {
		entry.Error = "图片较大，当前原生缩略图尚未接入分块读取"
		return
	}
	if !cache.Registered {
		if cache.Registering {
			return
		}
		cache.Registering = true
		go func() {
			// Registration is local and must retain its receipt after this
			// view closes, so a late-created owner can be explicitly released.
			ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
			defer cancel()
			raw, err := cache.Client.Call(ctx, "registerOwner", map[string]any{"ownerId": cache.Owner, "clientScope": map[string]any{"hostId": cache.Host, "generation": cache.Generation, "sessionId": cache.Session}})
			a.update(func() {
				cache.Registering = false
				if a.messageImages != cache || cache.Context.Err() != nil {
					releaseRemoteOwner(cache.Client, cache.Owner)
					return
				}
				var receipt struct {
					Registered bool
					OwnerID    string
				}
				if err != nil || json.Unmarshal(raw, &receipt) != nil || !receipt.Registered || receipt.OwnerID != cache.Owner {
					entry.Error = "图片读取登记失败，点击重试"
					releaseRemoteOwner(cache.Client, cache.Owner)
					return
				}
				cache.Registered = true
			})
		}()
		return
	}
	entry.Loading = true
	cache.Active++
	client := a.client
	ref := entry.Ref
	go func() {
		ctx, cancel := context.WithTimeout(cache.Context, 30*time.Second)
		defer cancel()
		raw, err := client.Call(ctx, "readAttachment", map[string]any{"sessionId": cache.Session, "attachment": ref, "clientScope": map[string]any{"hostId": cache.Host, "generation": cache.Generation, "sessionId": cache.Session, "ownerId": cache.Owner}})
		var bitmap *ui.Bitmap
		var size int64
		if err == nil {
			var reply struct {
				Attachment imageAttachment `json:"attachment"`
				Data       string          `json:"data"`
			}
			if json.Unmarshal(raw, &reply) != nil || imageReferenceKey(reply.Attachment) != key {
				err = errors.New("主机返回的图片引用不匹配")
			} else {
				var encoded []byte
				encoded, err = base64.StdEncoding.DecodeString(reply.Data)
				if err == nil && int64(len(encoded)) != ref.Bytes {
					err = errors.New("图片字节数与引用不匹配")
				}
				if err == nil {
					bitmap, size, err = thumbnailBitmap(encoded, ref)
				}
			}
		}
		a.update(func() {
			cache.Active--
			if a.messageImages != cache || cache.Context.Err() != nil || cache.Entries[key] != entry {
				return
			}
			entry.Loading = false
			if err != nil {
				entry.Error = "图片加载失败，点击重试"
				return
			}
			cache.evict(size)
			cache.Entries[key] = entry
			entry.Bitmap = bitmap
			entry.Bytes = size
			cache.Used += size
		})
	}()
}
func (a *app) messageImageGallery(c *ui.Context, m message) {
	refs := messageImageReferences(m)
	if len(refs) == 0 {
		return
	}
	cache := a.historyImages()
	previewAvailable := a.hasCompatRoute("image-preview")
	background, border := ui.RGBA(38, 49, 72, .06), ui.RGBA(0, 0, 0, .1)
	if a.theme.Dark {
		background, border = ui.RGBA(255, 255, 255, .08), ui.RGBA(255, 255, 255, .06)
	}
	ui.Row(c.Key("images:" + m.ID)).Wrap().Gap(10).MinWidth(0).Children(func() {
		for occurrence, ref := range refs {
			key := imageReferenceKey(ref)
			entry := cache.Entries[key]
			if entry == nil {
				cache.evict(0)
				entry = &historyImageEntry{Ref: ref}
				if ref.Bytes > 8*1024*1024 {
					entry.Error = "图片较大，当前客户端尚未接入分块读取"
				}
				cache.Entries[key] = entry
			}
			w, h, x, y := singleImageFit(ref.Width, ref.Height)
			if len(refs) > 1 {
				w, h, x, y = 64, 64, .5, .5
			}
			label := "打开图片 " + ref.Name
			if ref.Name == "" {
				label = "打开图片 " + ref.AttachmentID
			}
			// The decoded bitmap is shared by reference, while every visible
			// occurrence has its own identity, including repeated attachments.
			button := ui.ButtonBase(c.Key(fmt.Sprintf("%s:occurrence:%d", key, occurrence))).Size(w, h).Padding(0).Shrink(0).Radius(20).Border(.5, border).Background(background).Clip().Label(label)
			ref := ref
			button.ContextMenu(func(m *ui.Menu) {
				if m.Item("保存图片").Chosen() {
					go a.saveAttachment(fileAttachment{AttachmentID: ref.AttachmentID, Name: ref.Name, MediaType: ref.MediaType, Bytes: ref.Bytes})
				}
				if saved := a.savedFiles[ref.AttachmentID]; saved != "" && m.Item("在 Finder 中显示").Chosen() {
					mygo.Shell.ShowItemInFolder(saved)
				}
			})
			if entry.Bitmap != nil && !previewAvailable {
				button.Disabled(true).DimDisabled(false).Tooltip("原图预览页面尚未打包")
			}
			button.Draw(func(_ *ui.Painter, _ ui.Rect) {
				cache.Tick++
				entry.Seen = cache.Tick
				a.loadHistoryImage(cache, key, entry)
			})
			button.Children(func() {
				if entry.Bitmap != nil {
					ui.Image(c, entry.Bitmap).Size(w, h).Fit(ui.Cover).ObjectPosition(x, y)
				} else {
					label := "正在加载图片…"
					if entry.Error != "" {
						label = entry.Error
					}
					ui.Text(c, label).FontSize(12).TextColor(a.theme.TextMuted).Wrap().Padding(8)
				}
			})
			if button.Clicked() {
				if entry.Error != "" {
					entry.Error = ""
					a.loadHistoryImage(cache, key, entry)
				} else if entry.Bitmap != nil {
					if _, err := os.Stat(filepath.Join(compatPath(), "routes/image-preview.js")); err == nil {
						a.openCompatAt("image-preview", "imagePreview")
						a.imagePreviewAttachments = append([]imageAttachment(nil), refs...)
						a.imagePreviewIndex = occurrence
					} else {
						a.error = "原图预览页面尚未打包，缩略图已加载。"
					}
				}
			}
		}
	})
}

func (a *app) hasCompatRoute(page string) bool {
	if a.compatRouteCache == nil {
		a.compatRouteCache = map[string]bool{}
	}
	if ready, known := a.compatRouteCache[page]; known {
		return ready
	}
	_, err := os.Stat(filepath.Join(compatPath(), "routes", page+".js"))
	a.compatRouteCache[page] = err == nil
	return err == nil
}

func (a *app) imagePreviewView(c *ui.Context) {
	open := true
	width, height := c.Size()
	panelWidth, panelHeight := min(float32(1000), width-48), height-80
	contentWidth, contentHeight := panelWidth-24, panelHeight-24-36
	ui.Modal(c, &open, func() {
		ui.Row(c).Width(contentWidth).Height(36).Shrink(0).Justify(ui.End).Children(func() {
			if ui.Button(c, "关闭原图").Clicked() {
				open = false
			}
		})
		if a.compat != nil {
			ui.WebView(c.Key("image-preview-"+a.compatOwner), a.compat).Size(contentWidth, contentHeight).Shrink(0).MinHeight(0).MinWidth(0).Clip()
		}
	}).Width(panelWidth).Height(panelHeight).Padding(12).Gap(0).Clip().Background(a.theme.Background).Label("原图预览")
	if !open {
		a.closeCompat()
	}
}
