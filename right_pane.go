package main

import (
	"context"
	"encoding/json"
	"fmt"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"
)

type paneFileEntry struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Size *int64 `json:"size,omitempty"`
}
type paneDirectory struct {
	Path      string          `json:"path"`
	Entries   []paneFileEntry `json:"entries"`
	Truncated bool            `json:"truncated"`
}
type paneTextFile struct {
	AbsolutePath string `json:"absolutePath"`
	Version      string `json:"version"`
	Bytes        *int64 `json:"bytes,omitempty"`
	Offset       int    `json:"offset"`
	Text         string `json:"text"`
	Lines        int    `json:"lines"`
	EOF          bool   `json:"eof"`
}
type paneTreeRow struct {
	Path, Name, Kind string
	Depth            int
}
type rightPaneState struct {
	HostID, SessionID, Tab  string
	RemoteGeneration        uint64
	Directories             map[string]paneDirectory
	Expanded                map[string]bool
	Loading                 map[string]bool
	Error, Selected, Filter string
	ShowHidden              bool
	Text                    paneTextFile
	TextReady               bool
	Generation              uint64
	TreeList                ui.ListState
}

func (a *app) currentRightPane() *rightPaneState {
	if a.rightPane == nil || a.rightPane.HostID != a.hostID || a.rightPane.SessionID != a.sessionID || a.rightPane.RemoteGeneration != a.remoteGeneration {
		a.rightPane = &rightPaneState{HostID: a.hostID, SessionID: a.sessionID, RemoteGeneration: a.remoteGeneration, Tab: "start", Directories: map[string]paneDirectory{}, Expanded: map[string]bool{"": true}, Loading: map[string]bool{}}
	}
	return a.rightPane
}

// paneRead owns read-only requests and checks the captured Host/Session before
// applying a reply. A late read cannot populate another Session's file panel.
func (a *app) paneRead(s *rightPaneState, method, key string, params map[string]any, accept func(json.RawMessage) error) {
	if a.demo || a.client == nil || !a.connected || s.SessionID == "" {
		s.Error = "请先连接主机并打开会话。"
		return
	}
	if s.Loading[key] {
		return
	}
	s.Loading[key] = true
	s.Error = ""
	params["sessionId"] = s.SessionID
	params["clientScope"] = map[string]any{"hostId": s.HostID, "generation": s.RemoteGeneration, "sessionId": s.SessionID}
	generation := s.Generation
	client := a.client
	go func() {
		ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
		defer cancel()
		raw, err := client.Call(ctx, method, params)
		a.update(func() {
			if a.rightPane != s || a.hostID != s.HostID || a.sessionID != s.SessionID || a.remoteGeneration != s.RemoteGeneration || a.client != client {
				return
			}
			delete(s.Loading, key)
			if strings.HasPrefix(key, "text:") && generation != s.Generation {
				return
			}
			if err != nil {
				s.Error = err.Error()
				return
			}
			if err := accept(raw); err != nil {
				s.Error = err.Error()
			}
		})
	}()
}

func (a *app) loadPaneDirectory(s *rightPaneState, directory string) {
	a.paneRead(s, "listFiles", "dir:"+directory, map[string]any{"path": directory}, func(raw json.RawMessage) error {
		var listing paneDirectory
		if err := json.Unmarshal(raw, &listing); err != nil {
			return err
		}
		if listing.Path != directory {
			return fmt.Errorf("目录响应与请求路径不一致，请刷新。")
		}
		sort.SliceStable(listing.Entries, func(i, j int) bool {
			x, y := listing.Entries[i], listing.Entries[j]
			if (x.Type == "directory") != (y.Type == "directory") {
				return x.Type == "directory"
			}
			return strings.ToLower(x.Name) < strings.ToLower(y.Name)
		})
		s.Directories[directory] = listing
		return nil
	})
}

func (a *app) loadPaneText(s *rightPaneState, filename string, offset int) {
	if offset < 1 {
		offset = 1
	}
	s.Selected = filename
	s.Tab = "document"
	s.Generation++
	generation := s.Generation
	a.paneRead(s, "readFile", fmt.Sprintf("text:%d", generation), map[string]any{"path": filename, "range": map[string]any{"offset": offset, "limit": 500}}, func(raw json.RawMessage) error {
		if generation != s.Generation || s.Selected != filename {
			return nil
		}
		var file paneTextFile
		if err := json.Unmarshal(raw, &file); err != nil {
			return err
		}
		if file.Offset != offset {
			return fmt.Errorf("文件页码与请求不一致，请刷新。")
		}
		if offset > 1 && s.TextReady && s.Text.Version != "" && file.Version != s.Text.Version {
			return fmt.Errorf("文件已变化，请从第一页重新载入。")
		}
		s.Text = file
		s.TextReady = true
		return nil
	})
}

func paneRows(s *rightPaneState, directory string, depth int) []paneTreeRow {
	if depth > 64 {
		return nil
	}
	var rows []paneTreeRow
	for _, entry := range s.Directories[directory].Entries {
		if entry.Name == "" || entry.Name == "." || entry.Name == ".." || strings.ContainsAny(entry.Name, "/\\") {
			continue
		}
		if !s.ShowHidden && strings.HasPrefix(entry.Name, ".") {
			continue
		}
		filename := path.Join(directory, entry.Name)
		if s.Filter != "" && !strings.Contains(strings.ToLower(filename), strings.ToLower(s.Filter)) && entry.Type != "directory" {
			continue
		}
		rows = append(rows, paneTreeRow{Path: filename, Name: entry.Name, Kind: entry.Type, Depth: depth})
		if entry.Type == "directory" && s.Expanded[filename] {
			rows = append(rows, paneRows(s, filename, depth+1)...)
		}
	}
	return rows
}

func (a *app) rightPaneView(c *ui.Context) {
	s := a.currentRightPane()
	ui.Column(c).Grow(1).MinHeight(0).MinWidth(0).Children(func() {
		ui.Row(c).Height(48).Shrink(0).Padding(10, 16).Gap(8).AlignItems(ui.Center).Children(func() {
			if ui.ButtonBase(c).Label("右侧栏开始页").Children(func() { icon(c, "browse-outline", 16); ui.Text(c, "开始").FontSize(14) }).Clicked() {
				s.Tab = "start"
			}
			if s.Tab != "start" {
				ui.Text(c, "/ "+map[string]string{"files": "工作区文件", "document": path.Base(s.Selected)}[s.Tab]).FontSize(13).Ellipsis("…")
			}
			ui.Spacer(c)
			if ui.ButtonBase(c).Size(24, 24).Label("收起右侧边栏").Children(func() { icon(c, "panel-left-outline", 16) }).Clicked() {
				a.rightPaneOpen = false
			}
		})
		if s.Error != "" {
			ui.Text(c, s.Error).Wrap().FontSize(12).TextColor(a.theme.Danger).Padding(8, 16)
		}
		switch s.Tab {
		case "files":
			a.paneFiles(c, s)
		case "document":
			a.paneDocument(c, s)
		default:
			a.paneStart(c, s)
		}
	})
}

func (a *app) paneStart(c *ui.Context, s *rightPaneState) {
	ui.Column(c).Grow(1).Justify(ui.Center).Padding(28, 32).Gap(14).Children(func() {
		ui.Row(c).Justify(ui.Center).Padding(0, 0, 20).Children(func() { icon(c, "browse-outline", 44).TextColor(a.theme.TextMuted) })
		card := func(title, description, glyph, shortcut string, enabled bool, run func()) {
			b := ui.ButtonBase(c.Key(title)).Height(68).Padding(14, 24).Radius(16).Border(1, a.theme.Border).Background(a.theme.Surface).Gap(18).Justify(ui.Start).Label(title).Disabled(!enabled)
			b.Children(func() {
				icon(c, glyph, 20).TextColor(a.theme.Accent)
				ui.Column(c).Grow(1).Gap(4).Children(func() {
					ui.Text(c, title).FontSize(14)
					if description != "" {
						ui.Text(c, description).FontSize(12).TextColor(a.theme.TextMuted).Wrap()
					}
				})
				if shortcut != "" {
					ui.Text(c, shortcut).FontSize(12).TextColor(a.theme.TextMuted)
				}
			})
			if b.Clicked() && run != nil {
				run()
			}
		}
		card("工作区文件", "浏览会话工作区的文件", "folder-open-outline", "", a.can("listFiles"), func() { s.Tab = "files"; a.loadPaneDirectory(s, "") })
		card("新建终端", "终端界面尚未接入", "code-outline", "", false, nil)
		card("浏览器", "浏览网页", "globe-outline", "", true, func() { a.openWeb() })
		card("更多工具", "更多工具尚未接入", "apps-add-outline", "", false, nil)
	})
}

func (a *app) paneFiles(c *ui.Context, s *rightPaneState) {
	ui.Row(c).Shrink(0).Padding(8, 16).Gap(8).Children(func() {
		ui.Text(c, "工作区文件").FontSize(14).Grow(1)
		if ui.ButtonBase(c).Size(24, 24).Label("刷新文件树").Disabled(!a.can("listFiles")).Children(func() { icon(c, "refresh-outline", 14) }).Clicked() {
			for directory := range s.Directories {
				if s.Expanded[directory] {
					a.loadPaneDirectory(s, directory)
				}
			}
			if len(s.Directories) == 0 {
				a.loadPaneDirectory(s, "")
			}
		}
	})
	ui.TextInput(c, &s.Filter).Shrink(0).Label("筛选已加载的文件名").Placeholder("筛选已加载的文件名").Margin(0, 16, 8)
	ui.Checkbox(c, &s.ShowHidden, "显示隐藏文件").Shrink(0).Margin(0, 16, 8)
	ui.Text(c, "仅筛选已加载目录；不包含主机的完整搜索与 Git 忽略规则。").Shrink(0).FontSize(11).TextColor(a.theme.TextMuted).Wrap().Padding(0, 16, 8)
	rows := paneRows(s, "", 0)
	s.TreeList.Key = func(i int) any { return rows[i].Path }
	ui.List(c, &s.TreeList, len(rows), func(i int) {
		row := rows[i]
		b := ui.ButtonBase(c.Key(row.Path)).Height(30).Padding(4, 12+float32(row.Depth)*16).Gap(6).Justify(ui.Start).Label(row.Name).Disabled(!a.connected)
		if b.Hovered() {
			b.Background(a.colors.RowHover)
		}
		b.Children(func() {
			if row.Kind == "directory" {
				glyph := "chevron-right-outline"
				if s.Expanded[row.Path] {
					glyph = "chevron-down-outline"
				}
				icon(c, glyph, 12)
				icon(c, "folder-open-outline", 15).TextColor(a.theme.Accent)
			} else {
				ui.Box(c).Width(12)
				icon(c, "code-outline", 14).TextColor(a.theme.TextMuted)
			}
			ui.Text(c, row.Name).FontSize(13).Ellipsis("…")
			if s.Loading["dir:"+row.Path] {
				ui.Text(c, "…").FontSize(12)
			}
		})
		if b.Clicked() {
			if row.Kind == "directory" {
				s.Expanded[row.Path] = !s.Expanded[row.Path]
				if s.Expanded[row.Path] {
					if _, loaded := s.Directories[row.Path]; !loaded {
						a.loadPaneDirectory(s, row.Path)
					}
				}
			} else if row.Kind == "file" {
				s.TextReady = false
				a.loadPaneText(s, row.Path, 1)
			}
		}
	}).Grow(1).Shrink(1).MinHeight(0)
	if s.Loading["dir:"] {
		ui.Text(c, "正在加载目录…").FontSize(12).Padding(12, 16)
	} else if len(rows) == 0 {
		ui.Text(c, "此目录没有可见文件。").FontSize(12).TextColor(a.theme.TextMuted).Padding(12, 16)
	}
	for _, listing := range s.Directories {
		if listing.Truncated {
			ui.Text(c, "部分目录超过主机条目上限，当前列表不完整。").FontSize(11).TextColor(a.theme.TextMuted).Wrap().Padding(8, 16)
			break
		}
	}
}

func (a *app) paneDocument(c *ui.Context, s *rightPaneState) {
	ui.Row(c).Shrink(0).Padding(8, 16).Gap(8).Children(func() {
		if ui.Button(c, "文件").Clicked() {
			s.Tab = "files"
		}
		ui.Text(c, path.Base(s.Selected)).FontSize(13).Grow(1).Ellipsis("…")
		if ui.ButtonBase(c).Size(24, 24).Label("刷新文件").Disabled(!a.can("readFile")).Children(func() { icon(c, "refresh-outline", 14) }).Clicked() {
			s.TextReady = false
			a.loadPaneText(s, s.Selected, 1)
		}
	})
	if !s.TextReady {
		label := "正在读取文件…"
		if s.Error != "" {
			label = "无法预览此文件，可刷新后重试。"
		}
		ui.Text(c, label).FontSize(12).TextColor(a.theme.TextMuted).Padding(16)
		ui.Spacer(c).Grow(1)
		return
	}
	ui.Text(c, s.Text.AbsolutePath).Shrink(0).FontSize(11).TextColor(a.theme.TextMuted).Wrap().Selectable().Padding(0, 16, 8)
	ui.Scroll(c.Key(fmt.Sprintf("file:%s:%d", s.Selected, s.Text.Offset))).Grow(1).Shrink(1).MinHeight(0).Clip().Children(func() {
		font := "SF Mono, Menlo, monospace"
		if a.uiPrefs.CodeFontFamily != "" {
			font = a.uiPrefs.CodeFontFamily + ", " + font
		}
		weight := 300
		if a.uiPrefs.CodeFontFamily != "" {
			weight = 400
		}
		ui.Text(c, s.Text.Text).Font(font).FontWeight(weight).FontSize(a.uiPrefs.CodeFontSize).Wrap().Selectable().Padding(12, 16)
	})
	ui.Row(c).Shrink(0).Padding(10, 16).Gap(8).AlignItems(ui.Center).Children(func() {
		if ui.Button(c, "上一页").Disabled(s.Text.Offset <= 1 || !a.connected).Clicked() {
			a.loadPaneText(s, s.Selected, max(1, s.Text.Offset-500))
		}
		ui.Text(c, fmt.Sprintf("第 %d–%d 行", s.Text.Offset, max(s.Text.Offset, s.Text.Offset+s.Text.Lines-1))).FontSize(11).TextColor(a.theme.TextMuted).Grow(1)
		if ui.Button(c, "下一页").Disabled(s.Text.EOF || !a.connected).Clicked() {
			a.loadPaneText(s, s.Selected, s.Text.Offset+max(s.Text.Lines, 1))
		}
	})
}
