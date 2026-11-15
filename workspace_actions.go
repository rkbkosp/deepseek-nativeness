package main

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"
)

// A Workspace is a directory registered on the Host. This sheet only holds
// client-side form state; the directory and its registry entry stay on the
// Host, and every write goes through the same fenced mutation path as the rest
// of the remote actions.

type workspaceDirectoryEntry struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	Hidden bool   `json:"hidden"`
}

type workspaceDirectoryListing struct {
	Path      string                    `json:"path"`
	Home      string                    `json:"home"`
	Entries   []workspaceDirectoryEntry `json:"entries"`
	Truncated bool                      `json:"truncated"`
}

type workspaceCreateState struct {
	HostID, AccountScope, Path, Error string
	RemoteGeneration                  uint64
	Listing                           workspaceDirectoryListing
	Loading, Creating, Listed         bool
}

// workspaceEditor returns the sheet state for the current Host selection. A
// different Host, account or connection epoch retires the old form so a late
// reply cannot fill another Host's sheet.
func (a *app) workspaceEditor() *workspaceCreateState {
	s := a.workspaceCreate
	if s == nil || s.HostID != a.hostID || s.AccountScope != a.accountScope || s.RemoteGeneration != a.remoteGeneration {
		s = &workspaceCreateState{HostID: a.hostID, AccountScope: a.accountScope, RemoteGeneration: a.remoteGeneration}
		a.workspaceCreate = s
	}
	return s
}

func (a *app) openWorkspaceCreate() {
	if a.demo {
		a.error = "当前是本地界面回放。请以正常模式连接 Remote 后操作。"
		return
	}
	switch a.workspaceCreateIntent() {
	case intentOpenConnection:
		a.connectionOpen = true
		a.fetchDevices()
		return
	case intentHold:
		// A local launch has no login page to send the reader to; the Host is
		// still starting or failed, and the status line already says which.
		a.error = a.localHostPhaseLabel()
		return
	}
	s := a.workspaceEditor()
	s.Path = ""
	s.Error = ""
	s.Listed = false
	s.Listing = workspaceDirectoryListing{}
	a.loadWorkspaceDirectory("")
}

func (a *app) closeWorkspaceCreate() {
	a.workspaceCreate = nil
}

// loadWorkspaceDirectory lists one Host directory. An empty path asks the Host
// for its home directory, which is also where the sheet starts.
func (a *app) loadWorkspaceDirectory(directory string) {
	s := a.workspaceEditor()
	if a.client == nil || !a.connected {
		s.Error = "请先连接远程主机。"
		return
	}
	if s.Loading {
		return
	}
	host, scope, generation, client := a.hostID, a.accountScope, a.remoteGeneration, a.client
	s.Loading = true
	s.Error = ""
	params := map[string]any{
		"path":        directory,
		"clientScope": map[string]any{"hostId": host, "generation": generation},
	}
	go func() {
		ctx, cancel := context.WithTimeout(a.ctx, 20*time.Second)
		defer cancel()
		raw, err := client.Call(ctx, "listDirectories", params)
		a.update(func() {
			if a.workspaceCreate != s || a.hostID != host || a.accountScope != scope || a.remoteGeneration != generation || a.client != client {
				return
			}
			s.Loading = false
			if err != nil {
				s.Error = err.Error()
				return
			}
			var listing workspaceDirectoryListing
			if err := json.Unmarshal(raw, &listing); err != nil {
				s.Error = err.Error()
				return
			}
			s.Listing = listing
			s.Listed = true
			if directory == "" || s.Path == "" {
				s.Path = listing.Home
			}
		})
	}()
}

func (a *app) createWorkspace() {
	s := a.workspaceEditor()
	path := strings.TrimSpace(s.Path)
	if path == "" {
		s.Error = "请填写主机上的工作区目录。"
		return
	}
	if !strings.HasPrefix(path, "/") {
		s.Error = "请填写主机上的绝对路径。"
		return
	}
	if !a.can("createWorkspace") {
		s.Error = "当前连接不允许新建工作区。"
		return
	}
	host, scope, generation := a.hostID, a.accountScope, a.remoteGeneration
	s.Creating = true
	s.Error = ""
	a.mutateWithFailure("createWorkspace", map[string]any{"path": path}, func(raw json.RawMessage) error {
		if a.workspaceCreate != s || a.hostID != host || a.accountScope != scope || a.remoteGeneration != generation {
			return nil
		}
		var result struct {
			Workspace struct {
				WorkspaceID string `json:"workspaceId"`
				Path        string `json:"path"`
				Title       string `json:"title"`
			} `json:"workspace"`
			Created bool `json:"created"`
		}
		if err := json.Unmarshal(raw, &result); err != nil {
			s.Error = err.Error()
			return nil
		}
		if result.Workspace.WorkspaceID == "" {
			s.Error = "主机未返回工作区标识，请刷新工作区目录后核对。"
			return nil
		}
		id := result.Workspace.WorkspaceID
		a.closeWorkspaceCreate()
		// The helper answers selectWorkspace from its own Workspace rows, so the
		// registry is re-read before the new row can be selected.
		a.refreshWorkspaces(func() {
			for _, w := range a.workspaces {
				if w.ID != id {
					continue
				}
				if a.uiPrefs.Expanded == nil {
					a.uiPrefs.Expanded = map[string]bool{}
				}
				a.uiPrefs.Expanded[id] = true
				a.savePreferences()
				a.selectWorkspace(id)
				return
			}
			a.detail = "工作区已创建，但尚未出现在远程目录中，请稍后刷新工作区。"
		})
		return nil
	}, func(error) {
		if a.workspaceCreate != s {
			return
		}
		s.Creating = false
	})
}

func (a *app) workspaceCreateView(c *ui.Context) {
	s := a.workspaceCreate
	if s == nil {
		return
	}
	open := true
	ui.Modal(c, &open, func() {
		ui.Column(c).Width(520).Gap(12).Children(func() {
			ui.Text(c, "新建远端工作区").FontSize(18).FontWeight(500)
			ui.Text(c, "工作区是主机上的一个目录。填写已存在的绝对路径，或从下面的目录中选择。").FontSize(12).TextColor(a.theme.TextMuted).Wrap()
			ui.TextInput(c, &s.Path).Label("主机目录").Placeholder("/Users/you/projects/app").AutoFocus()
			ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
				if s.Listing.Home != "" && s.Listing.Path != s.Listing.Home {
					if ui.ButtonBase(c).Label("主目录").Padding(4, 8).Children(func() { ui.Text(c, "主目录").FontSize(12) }).Clicked() {
						s.Path = s.Listing.Home
						a.loadWorkspaceDirectory(s.Listing.Home)
					}
				}
				if s.Listing.Path != "" {
					ui.Text(c, s.Listing.Path).FontSize(11).TextColor(a.theme.TextMuted).SingleLine().Ellipsis("…").Grow(1)
				}
				if ui.ButtonBase(c).Label("刷新目录").Padding(4, 8).Children(func() { ui.Text(c, "刷新").FontSize(12) }).Clicked() {
					a.loadWorkspaceDirectory(strings.TrimSpace(s.Path))
				}
				if ui.ButtonBase(c).Label("选择上级目录").Padding(4, 8).Children(func() { ui.Text(c, "上一级").FontSize(12) }).Clicked() {
					a.loadWorkspaceDirectory(parentDirectory(s.Listing.Path))
				}
			})
			if s.Loading {
				ui.Text(c, "正在读取主机目录…").FontSize(12).TextColor(a.theme.TextMuted)
			} else if s.Listed {
				entries := make([]workspaceDirectoryEntry, 0, len(s.Listing.Entries))
				for _, e := range s.Listing.Entries {
					if !e.Hidden {
						entries = append(entries, e)
					}
				}
				if len(entries) == 0 {
					ui.Text(c, "这个目录下没有子目录。").FontSize(12).TextColor(a.theme.TextMuted)
				} else {
					ui.Scroll(c).MaxHeight(220).Children(func() {
						ui.Column(c).Gap(2).Children(func() {
							for _, entry := range entries {
								child := entry
								if ui.ButtonBase(c.Key("workspace-dir-"+child.Path)).Height(28).Padding(0, 8).Gap(6).Radius(6).Justify(ui.Start).Label("目录 " + child.Name).Children(func() {
									icon(c, "folder-outline", 15).TextColor(a.theme.TextMuted)
									ui.Text(c, child.Name).FontSize(13).SingleLine().Ellipsis("…")
								}).Clicked() {
									s.Path = child.Path
									a.loadWorkspaceDirectory(child.Path)
								}
							}
						})
					})
				}
				if s.Listing.Truncated {
					ui.Text(c, "目录内容较多，只显示了一部分。").FontSize(11).TextColor(a.theme.TextMuted)
				}
			}
			if s.Error != "" {
				ui.Text(c, s.Error).FontSize(12).TextColor(ui.Hex("#b53a3a")).Wrap()
			}
			ui.Row(c).Justify(ui.End).Gap(8).Children(func() {
				if ui.Button(c, "取消").Clicked() {
					a.closeWorkspaceCreate()
				}
				if ui.PrimaryButton(c, "新建工作区").Disabled(s.Creating || strings.TrimSpace(s.Path) == "" || !a.can("createWorkspace")).Clicked() {
					a.createWorkspace()
				}
			})
		})
	})
	if !open && a.workspaceCreate == s {
		a.closeWorkspaceCreate()
	}
}

// parentDirectory walks one path segment up without assuming POSIX semantics
// beyond the absolute paths the Host already returned.
func parentDirectory(path string) string {
	path = strings.TrimRight(path, "/")
	if path == "" {
		return "/"
	}
	if i := strings.LastIndex(path, "/"); i > 0 {
		return path[:i]
	}
	return "/"
}
