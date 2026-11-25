package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
)

// turnDeliverablePaths lists the files a Turn's successful write/edit calls
// produced. The reference derives its closing deliverables row the same way:
// from recorded mutation arguments, not from the closing prose.
func (a *app) turnDeliverablePaths(turn int) []string {
	seen := map[string]bool{}
	var paths []string
	for i := range a.current.Messages {
		m := &a.current.Messages[i]
		if m.Turn != turn || m.Tool == nil {
			continue
		}
		switch m.Tool.Name {
		case "write", "edit", "apply_patch":
		default:
			continue
		}
		if m.Tool.IsError {
			continue
		}
		path := stringArg(parseToolArgs(m.Tool.ArgsRaw), "path", "file_path", "filePath")
		if path == "" || seen[path] {
			continue
		}
		seen[path] = true
		paths = append(paths, path)
	}
	return paths
}

// turnDeliverablesView draws the closing Turn's produced files, with the same
// reveal/open gestures the reference offers on a delivered file.
func containsString(list []string, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}

func (a *app) turnDeliverablesView(c *ui.Context, turn int) {
	paths := a.turnDeliverablePaths(turn)
	notes := map[string]string{}
	for _, file := range a.presentedFiles[turn] {
		if !containsString(paths, file.Path) {
			paths = append(paths, file.Path)
		}
		if file.Description != "" {
			notes[file.Path] = file.Description
		}
	}
	if len(paths) == 0 {
		return
	}
	open := a.foldState(fmt.Sprintf("deliverables:%d", turn), false)
	shown := paths
	if len(shown) > 4 && !*open {
		shown = shown[:4]
	}
	ui.Row(c).Wrap().Gap(8).Padding(4, 0).Children(func() {
		for _, path := range shown {
			path := path
			name := filepath.Base(path)
			note := notes[path]
			if note == "" {
				note = "已生成"
			}
			button := ui.ButtonBase(c).Height(48).Padding(8, 12).Radius(10).Border(1, a.theme.Border).Background(a.theme.Surface).Gap(8).AlignItems(ui.Center).Label("交付文件 " + path)
			button.Children(func() {
				icon(c, "deliver-doc", 18).TextColor(a.colors.Caption)
				ui.Column(c).Gap(1).Children(func() {
					ui.Text(c, name).FontSize(12).TextColor(a.colors.Secondary).SingleLine().Ellipsis("…")
					ui.Text(c, note).FontSize(11).TextColor(a.colors.Caption)
				})
			})
			resolved := path
			if !filepath.IsAbs(resolved) {
				for _, s := range a.sessions {
					if s.ID == a.sessionID && s.Cwd != "" {
						resolved = filepath.Join(s.Cwd, resolved)
						break
					}
				}
			}
			if filepath.IsAbs(resolved) {
				if _, err := os.Stat(resolved); err == nil {
					button.ContextMenu(func(m *ui.Menu) {
						if m.Item("打开").Chosen() {
							_ = mygo.Shell.OpenPath(resolved)
						}
						if m.Item("在 Finder 中显示").Chosen() {
							mygo.Shell.ShowItemInFolder(resolved)
						}
					})
				}
			}
		}
		if len(paths) > 4 {
			label := fmt.Sprintf("展开其余 %d 个交付文件", len(paths)-4)
			if *open {
				label = "收起交付文件"
			}
			if ui.ButtonBase(c).Height(48).Padding(8, 12).Radius(10).Label(label).Children(func() {
				ui.Text(c, label).FontSize(12).TextColor(a.colors.Caption)
			}).Clicked() {
				*open = !*open
			}
		}
	})
}
