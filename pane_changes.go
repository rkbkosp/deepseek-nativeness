package main

import (
	"context"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"
)

type paneChange struct {
	Status string
	Path   string
}

// paneWorkspacePath is the directory git runs in: the selected workspace's
// path, or the current Session's cwd when the workspace has none.
func (a *app) paneWorkspacePath() string {
	for _, w := range a.workspaces {
		if w.ID == a.workspaceID && w.Path != "" {
			return w.Path
		}
	}
	for _, s := range a.sessions {
		if s.ID == a.sessionID && s.Cwd != "" {
			return s.Cwd
		}
	}
	return ""
}

func parsePaneChanges(out string) []paneChange {
	var changes []paneChange
	for _, line := range strings.Split(out, "\n") {
		if len(line) < 4 {
			continue
		}
		status := strings.TrimSpace(line[:2])
		path := strings.TrimSpace(line[3:])
		if path == "" {
			continue
		}
		if status == "" {
			status = "?"
		}
		changes = append(changes, paneChange{Status: status[:1], Path: path})
	}
	sort.Slice(changes, func(i, j int) bool { return changes[i].Path < changes[j].Path })
	return changes
}

func (a *app) loadPaneChanges(s *rightPaneState) {
	if s.ChangesLoading {
		return
	}
	dir := a.paneWorkspacePath()
	if dir == "" {
		s.ChangesError = "请先选择工作区"
		return
	}
	s.ChangesLoading = true
	s.ChangesError = ""
	generation := s.Generation
	go func() {
		ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "git", "-C", dir, "status", "--porcelain")
		out, err := cmd.Output()
		a.update(func() {
			if s.Generation != generation {
				return
			}
			s.ChangesLoading = false
			if err != nil {
				s.ChangesError = "无法读取 git 变更（工作区可能不是 git 仓库）"
				return
			}
			s.Changes = parsePaneChanges(string(out))
			s.ChangesAt = time.Now()
		})
	}()
}

func (a *app) loadPaneChangeDiff(s *rightPaneState, change paneChange) {
	dir := a.paneWorkspacePath()
	if dir == "" {
		s.ChangesDiffError = "请先选择工作区"
		return
	}
	s.ChangesDiffPath = change.Path
	s.ChangesDiff = ""
	s.ChangesDiffError = ""
	s.ChangesDiffLoading = true
	go func() {
		ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
		defer cancel()
		var cmd *exec.Cmd
		if change.Status == "?" {
			cmd = exec.CommandContext(ctx, "git", "-C", dir, "diff", "--no-index", "--", "/dev/null", change.Path)
		} else {
			cmd = exec.CommandContext(ctx, "git", "-C", dir, "diff", "--", change.Path)
		}
		out, _ := cmd.Output()
		a.update(func() {
			s.ChangesDiffLoading = false
			if len(out) == 0 {
				s.ChangesDiffError = "没有可显示的 diff"
				return
			}
			s.ChangesDiff = string(out)
		})
	}()
}

func (a *app) paneChangeDiff(c *ui.Context, s *rightPaneState) {
	ui.Row(c).Height(40).Shrink(0).Padding(6, 16).Gap(8).AlignItems(ui.Center).Children(func() {
		if ui.ButtonBase(c).Padding(4).Label("返回变更列表").Children(func() { icon(c, "chevron-left-outline", 14) }).Clicked() {
			s.ChangesDiffPath = ""
		}
		ui.Text(c, filepath.Base(s.ChangesDiffPath)).FontSize(13).FontWeight(500).Ellipsis("…")
		ui.Spacer(c)
	})
	if s.ChangesDiffLoading {
		ui.Text(c, "正在读取 diff…").FontSize(12).TextColor(a.colors.Caption).Padding(8, 16)
		return
	}
	if s.ChangesDiffError != "" {
		ui.Text(c, s.ChangesDiffError).FontSize(12).TextColor(a.colors.Caption).Padding(8, 16)
		return
	}
	ui.Scroll(c.Key("pane-change-diff:" + s.ChangesDiffPath)).Grow(1).MinHeight(0).Clip().Children(func() {
		ui.Column(c).FillWidth().Padding(4, 12).Children(func() {
			for _, line := range strings.Split(s.ChangesDiff, "\n") {
				color := a.colors.Secondary
				if strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++") {
					color = ui.Hex("#6bbf59")
				} else if strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---") {
					color = ui.Hex("#e06c75")
				} else if strings.HasPrefix(line, "@@") {
					color = ui.Hex("#6fa8ff")
				}
				ui.Text(c, line).Font(monoFont(a)).FontSize(11).FixedLineHeight(17).TextColor(color).NoWrap()
			}
		})
	})
}

func (a *app) paneChanges(c *ui.Context, s *rightPaneState) {
	if s.ChangesDiffPath != "" {
		a.paneChangeDiff(c, s)
		return
	}
	ui.Row(c).Height(40).Shrink(0).Padding(6, 16).Gap(8).AlignItems(ui.Center).Children(func() {
		ui.Text(c, "变更").FontSize(13).FontWeight(500)
		ui.Text(c, itoa(len(s.Changes))).FontSize(11).TextColor(a.colors.Caption)
		ui.Spacer(c)
		if ui.ButtonBase(c).Size(24, 24).Label("刷新变更").Children(func() { icon(c, "refresh-outline", 14) }).Clicked() {
			a.loadPaneChanges(s)
		}
	})
	if s.ChangesLoading {
		ui.Text(c, "正在读取变更…").FontSize(12).TextColor(a.colors.Caption).Padding(8, 16)
		return
	}
	if s.ChangesError != "" {
		ui.Text(c, s.ChangesError).FontSize(12).TextColor(a.theme.Danger).Wrap().Padding(8, 16)
		return
	}
	if len(s.Changes) == 0 {
		ui.Text(c, "工作区没有未提交的变更").FontSize(12).TextColor(a.colors.Caption).Padding(8, 16)
		return
	}
	ui.Scroll(c.Key("pane-changes")).Grow(1).MinHeight(0).Clip().Children(func() {
		ui.Column(c).FillWidth().Padding(4, 12).Gap(2).Children(func() {
			for _, change := range s.Changes {
				change := change
				row := ui.ButtonBase(c.Key("change:"+change.Path)).FillWidth().Height(28).Padding(0, 6).Radius(6).Justify(ui.Start).Gap(8).Label(change.Path)
				row.Children(func() {
					ui.Text(c, change.Status).Font(monoFont(a)).FontSize(11).Width(14).TextColor(changeColor(a, change.Status))
					ui.Text(c, change.Path).Font(monoFont(a)).FontSize(12).TextColor(a.colors.Secondary).SingleLine().Ellipsis("…")
					ui.Spacer(c)
					ui.Text(c, filepath.Base(filepath.Dir(change.Path))).FontSize(10).TextColor(a.colors.Caption)
				})
				if row.Clicked() {
					a.loadPaneChangeDiff(s, change)
				}
			}
		})
	})
}

func changeColor(a *app, status string) ui.Color {
	switch status {
	case "A":
		return ui.Hex("#6bbf59")
	case "D":
		return ui.Hex("#e06c75")
	case "M", "R":
		return ui.Hex("#d19a66")
	}
	return a.colors.Caption
}
