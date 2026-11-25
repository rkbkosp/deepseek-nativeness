package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"image"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/egoist/mygo/ui"
)

func quicklookPreviewPath(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".rtf", ".pages", ".numbers", ".key":
		return true
	}
	return false
}

// loadPaneQuicklook previews document formats the text reader cannot render.
// The bytes come through the same Host readFileBytes call as images, then
// macOS Quick Look rasterizes them locally.
func (a *app) loadPaneQuicklook(s *rightPaneState, name string) {
	s.Selected = name
	s.Tab = "document"
	s.Generation++
	generation := s.Generation
	s.TextReady = false
	s.Image = nil
	s.ImageError = ""
	a.paneRead(s, "readFileBytes", "quicklook:"+name, map[string]any{"path": name, "options": map[string]any{}}, func(raw json.RawMessage) error {
		if generation != s.Generation || s.Selected != name {
			return nil
		}
		var reply struct {
			Data string `json:"data"`
		}
		if json.Unmarshal(raw, &reply) != nil || reply.Data == "" {
			s.ImageError = "无法读取文档"
			return nil
		}
		encoded, err := base64.StdEncoding.DecodeString(reply.Data)
		if err != nil {
			s.ImageError = "文档编码无效"
			return nil
		}
		dir, err := os.MkdirTemp("", "dsh-quicklook-")
		if err != nil {
			s.ImageError = "无法创建预览临时目录"
			return nil
		}
		defer os.RemoveAll(dir)
		source := filepath.Join(dir, "source"+strings.ToLower(filepath.Ext(name)))
		if err := os.WriteFile(source, encoded, 0o600); err != nil {
			s.ImageError = "无法写入预览临时文件"
			return nil
		}
		cmd := exec.Command("qlmanage", "-t", "-s", "1400", "-o", dir, source)
		if err := cmd.Run(); err != nil {
			s.ImageError = "系统无法生成预览"
			return nil
		}
		entries, _ := os.ReadDir(dir)
		var preview []byte
		for _, entry := range entries {
			if strings.HasSuffix(strings.ToLower(entry.Name()), ".png") {
				preview, _ = os.ReadFile(filepath.Join(dir, entry.Name()))
				break
			}
		}
		if len(preview) == 0 {
			s.ImageError = "系统没有生成预览图"
			return nil
		}
		img, _, err := image.Decode(bytes.NewReader(preview))
		if err != nil {
			s.ImageError = "无法解码预览图"
			return nil
		}
		s.Image = ui.NewBitmap(img)
		s.ImageError = ""
		return nil
	})
}
