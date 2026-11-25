package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

type fileAttachment struct {
	AttachmentID string `json:"attachmentId"`
	Name         string `json:"name"`
	MediaType    string `json:"mediaType"`
	Bytes        int64  `json:"bytes"`
	Path         string `json:"path"`
}

// messageFileReferences returns the non-image attachments on a message. The
// image path already owns its gallery; a file attachment gets a compact card.
func messageFileReferences(m message) []fileAttachment {
	var refs []fileAttachment
	add := func(raw json.RawMessage) {
		var ref fileAttachment
		if json.Unmarshal(raw, &ref) != nil || ref.AttachmentID == "" || ref.Name == "" {
			return
		}
		if len(ref.MediaType) >= 6 && ref.MediaType[:6] == "image/" {
			return
		}
		refs = append(refs, ref)
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
			switch b.Type {
			case "file", "attachment", "document":
				add(b.Attachment)
			}
		}
	}
	for _, b := range m.AssistantBlocks {
		switch b.Kind {
		case "file", "attachment", "document":
			add(b.Attachment)
		}
	}
	return refs
}

func formatFileBytes(bytes int64) string {
	switch {
	case bytes >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(bytes)/(1<<20))
	case bytes >= 1<<10:
		return fmt.Sprintf("%.1f KB", float64(bytes)/(1<<10))
	case bytes > 0:
		return fmt.Sprintf("%d B", bytes)
	}
	return ""
}

// saveAttachment reads the Host's bytes for one file attachment and writes
// them to a path the user picks. The image loader uses the same RPC.
func (a *app) saveAttachment(ref fileAttachment) {
	client := a.client
	if client == nil || a.sessionID == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	raw, err := client.Call(ctx, "readAttachment", map[string]any{
		"sessionId":  a.sessionID,
		"attachment": ref,
		"clientScope": map[string]any{
			"hostId": a.hostID, "generation": a.remoteGeneration, "sessionId": a.sessionID,
		},
	})
	if err != nil {
		a.update(func() { a.error = "附件读取失败：" + err.Error() })
		return
	}
	var reply struct {
		Data string `json:"data"`
	}
	if json.Unmarshal(raw, &reply) != nil || reply.Data == "" {
		a.update(func() { a.error = "主机没有返回附件内容。" })
		return
	}
	data, err := base64.StdEncoding.DecodeString(reply.Data)
	if err != nil {
		a.update(func() { a.error = "附件内容不是有效的 base64。" })
		return
	}
	path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Title: "保存附件", DefaultPath: ref.Name})
	if err != nil || path == "" {
		return
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		a.update(func() { a.error = "保存失败：" + err.Error() })
		return
	}
	a.update(func() {
		if a.savedFiles == nil {
			a.savedFiles = map[string]string{}
		}
		a.savedFiles[ref.AttachmentID] = path
	})
}

func (a *app) messageFileCards(c *ui.Context, m message) {
	refs := messageFileReferences(m)
	if len(refs) == 0 {
		return
	}
	ui.Row(c.Key("files:" + m.ID)).Wrap().Gap(8).Children(func() {
		for _, ref := range refs {
			ref := ref
			button := ui.ButtonBase(c).Width(min(260, a.chatContentWidth(c)*.5)).Gap(4).Padding(10, 12).Radius(12).Background(a.colors.CodeBlock).Border(1, a.theme.Border).Label("保存附件 " + ref.Name)
			button.Children(func() {
				ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
					icon(c, "paperclip-outline", 16).TextColor(a.colors.Caption)
					ui.Text(c, ref.Name).FontSize(12).SingleLine().Ellipsis("…").Grow(1)
				})
				meta := formatFileBytes(ref.Bytes)
				if meta != "" {
					ui.Text(c, meta).FontSize(11).TextColor(a.colors.Caption)
				}
			})
			reveal := ref.Path
			if saved := a.savedFiles[ref.AttachmentID]; reveal == "" {
				reveal = saved
			}
			if reveal != "" {
				button.ContextMenu(func(m *ui.Menu) {
					if m.Item("在 Finder 中显示").Chosen() {
						mygo.Shell.ShowItemInFolder(reveal)
					}
					if m.Item("打开").Chosen() {
						_ = mygo.Shell.OpenPath(reveal)
					}
				})
			}
			if button.Clicked() {
				go a.saveAttachment(ref)
			}
		}
	})
}
