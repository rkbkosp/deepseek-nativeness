package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

func composerUploadParams(sessionID, localPath, name, requestID string) map[string]any {
	return map[string]any{"sessionId": sessionID, "localPath": localPath, "name": name, "requestId": requestID}
}

var composerPickFiles = func(win *mygo.Window) ([]string, error) {
	return mygo.Dialog.Open(mygo.OpenDialogOptions{Parent: win, Title: "添加附件", Multiple: true})
}

func (a *app) composerChooseFiles() {
	s := a.composer
	if !a.composerCurrent(s) || !a.connected || a.busy {
		return
	}
	state := a.composerArtifacts()
	if state.FileLoading {
		return
	}
	state.FileLoading = true
	state.FileError = ""
	go func() {
		paths, err := composerPickFiles(a.win)
		a.update(func() {
			if !a.composerCurrent(s) {
				state.FileLoading = false
				return
			}
			state.FileLoading = false
			if err != nil {
				state.FileError = err.Error()
				return
			}
			if len(paths) > 0 {
				a.composerUploadFiles(paths)
			}
		})
	}()
}

func (a *app) composerUploadFiles(paths []string) {
	state := a.composerArtifacts()
	client := a.client
	sessionID := a.sessionID
	if client == nil || sessionID == "" {
		state.FileError = "请先打开会话"
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(a.ctx, 90*time.Second)
		defer cancel()
		for _, path := range paths {
			info, err := os.Stat(path)
			if err != nil || !info.Mode().IsRegular() {
				continue
			}
			if info.Size() > 50<<20 {
				a.update(func() { state.FileError = "附件超过 50 MB" })
				continue
			}
			requestID := fmt.Sprintf("upload-%d-%d", time.Now().UnixNano(), info.Size())
			reply, err := client.Call(ctx, "uploadWorkspaceFile", composerUploadParams(sessionID, path, filepath.Base(path), requestID))
			a.update(func() {
				if err != nil {
					state.FileError = "附件上传失败：" + err.Error()
					return
				}
				var result struct {
					ReceiptID string `json:"receiptId"`
					Semantics string `json:"semantics"`
				}
				if err := json.Unmarshal(reply, &result); err != nil || (result.ReceiptID == "" && result.Semantics != "workspace-file-path-reference") {
					state.FileError = "附件上传回执无效"
					return
				}
				id := result.ReceiptID
				if id == "" {
					id = path
				}
				file := composerDraftFile{ID: id, Name: filepath.Base(path), ReceiptID: result.ReceiptID, Bytes: info.Size()}
				if result.Semantics == "workspace-file-path-reference" {
					file.Path = path
				}
				state.Files = append(state.Files, file)
			})
		}
	}()
}

func (a *app) composerFileRail(c *ui.Context) {
	state := a.composerArtifacts()
	if len(state.Files) == 0 && state.FileError == "" && !state.FileLoading {
		return
	}
	ui.Column(c).FillWidth().Padding(2, 10, 0).Gap(4).Children(func() {
		for _, file := range state.Files {
			file := file
			row := ui.Row(c).Height(28).Padding(2, 8).Radius(8).Gap(6).AlignItems(ui.Center).Background(a.colors.CodeBlock)
			row.Children(func() {
				icon(c, "paperclip-outline", 13).TextColor(a.colors.Caption)
				ui.Text(c, file.Name).FontSize(11).TextColor(a.colors.Secondary).SingleLine().Ellipsis("…").Grow(1)
				ui.Text(c, humanBytes(file.Bytes)).FontSize(10).TextColor(a.colors.Caption)
				if ui.ButtonBase(c).Size(18, 18).Label("移除附件 " + file.Name).Children(func() { icon(c, "close-fill", 10) }).Clicked() {
					for i := range state.Files {
						if state.Files[i].ID == file.ID {
							state.Files = append(state.Files[:i], state.Files[i+1:]...)
							break
						}
					}
				}
			})
		}
		if state.FileLoading {
			ui.Text(c, "正在上传附件…").FontSize(11).TextColor(a.colors.Caption)
		}
		if state.FileError != "" {
			ui.Text(c, state.FileError).FontSize(11).TextColor(a.theme.Danger).Wrap()
		}
	})
}

// composerHandleDrop routes dragged files: images go through the existing
// image pipeline, other regular files upload as attachments, directories are
// refused with a specific message.
func (a *app) composerHandleDrop(paths []string) {
	images, files, err := composerSplitDroppedPaths(paths)
	if err != nil {
		a.composerArtifacts().FileError = err.Error()
		return
	}
	if len(images) > 0 {
		a.composerAddImageFiles(images)
	}
	if len(files) > 0 {
		a.composerUploadFiles(files)
	}
}

func composerSplitDroppedPaths(paths []string) (images, files []string, err error) {
	const maxDropped = 50
	classify := func(path string) {
		switch strings.ToLower(filepath.Ext(path)) {
		case ".png", ".jpg", ".jpeg", ".webp", ".gif":
			images = append(images, path)
		default:
			files = append(files, path)
		}
	}
	collect := func(path string) error {
		info, statErr := os.Stat(path)
		if statErr != nil {
			return fmt.Errorf("无法读取拖入的文件。")
		}
		if info.IsDir() {
			count := 0
			return filepath.WalkDir(path, func(child string, entry os.DirEntry, walkErr error) error {
				if walkErr != nil || entry.IsDir() {
					return nil
				}
				if !entry.Type().IsRegular() {
					return nil
				}
				if count >= maxDropped {
					return fmt.Errorf("一次最多拖入 %d 个文件。", maxDropped)
				}
				count++
				classify(child)
				return nil
			})
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("请选择普通文件。")
		}
		classify(path)
		return nil
	}
	for _, path := range paths {
		if err := collect(path); err != nil {
			return nil, nil, err
		}
	}
	if len(images) == 0 && len(files) == 0 {
		return nil, nil, fmt.Errorf("文件夹里没有可添加的文件。")
	}
	return images, files, nil
}
