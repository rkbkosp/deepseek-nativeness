package main

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/egoist/mygo/ui"
)

var toolTitles = map[string]string{
	"bash": "运行命令", "pwsh": "运行命令",
	"read": "读取", "read_image": "读取图片",
	"write": "写入", "edit": "编辑", "apply_patch": "编辑",
	"grep": "搜索文件内容", "glob": "查找文件",
	"web_search": "网页搜索", "web_fetch": "网页获取",
	"todo_write": "更新任务清单", "ask_user_question": "提问",
	"run_code": "代码", "cua_run_code": "代码",
	"terminal_send": "终端输入", "terminal_open": "打开终端",
	"terminal_read": "读取终端", "terminal_list": "终端列表",
	"terminal_signal": "终止终端",
	"create_goal":     "创建目标", "get_goal": "读取目标", "update_goal": "更新目标",
	"schedule_create": "创建定时任务", "schedule_list": "定时任务",
	"schedule_view": "查看定时任务", "schedule_edit": "编辑定时任务",
	"schedule_delete": "删除定时任务", "schedule_update": "更新定时任务",
	"subagent": "子智能体", "subagent_fork": "分叉子智能体",
	"list_agents": "列出智能体", "send_message": "发送消息",
	"interrupt_agent": "中断智能体",
}

var toolIcons = map[string]string{
	"bash": "api-outline", "pwsh": "api-outline",
	"read": "browse-outline", "read_image": "browse-outline",
	"write": "edit-outline", "edit": "edit-outline", "apply_patch": "edit-outline",
	"grep": "search-outline", "glob": "search-outline",
	"web_search": "search-outline", "web_fetch": "globe-outline",
	"todo_write": "checklist-outline", "ask_user_question": "question-outline",
	"run_code": "code-outline", "cua_run_code": "code-outline",
	"terminal_send": "code-outline", "terminal_open": "code-outline",
	"terminal_read": "code-outline", "terminal_list": "code-outline",
	"terminal_signal": "code-outline",
	"create_goal":     "goal-outline", "get_goal": "goal-outline", "update_goal": "goal-outline",
	"schedule_create": "clock-outline", "schedule_list": "clock-outline",
	"schedule_view": "clock-outline", "schedule_edit": "clock-outline",
	"schedule_delete": "clock-outline", "schedule_update": "clock-outline",
	"subagent": "agent-preset-outline", "subagent_fork": "agent-preset-outline",
	"list_agents": "agent-preset-outline", "send_message": "paper-plane-outline",
	"interrupt_agent": "close-circle-fill",
}

func toolTitle(name string) string {
	if title := toolTitles[name]; title != "" {
		return title
	}
	return "工具调用"
}

func toolIcon(name string) string {
	if iconName := toolIcons[name]; iconName != "" {
		return iconName
	}
	return "sparkle"
}

func parseToolArgs(raw string) map[string]any {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var args map[string]any
	if json.Unmarshal([]byte(raw), &args) != nil {
		return nil
	}
	return args
}

func stringArg(args map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := args[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func toolSummary(t *toolNode) string {
	if t == nil {
		return ""
	}
	args := parseToolArgs(t.ArgsRaw)
	name := t.Name
	switch name {
	case "bash", "pwsh":
		if description := stringArg(args, "description"); description != "" {
			return description
		}
		return stringArg(args, "command")
	case "read", "read_image":
		return stringArg(args, "path", "file_path", "filePath")
	case "write", "edit", "apply_patch":
		path := stringArg(args, "path", "file_path", "filePath")
		added, removed := toolDiffCounts(name, args)
		if added+removed > 0 {
			if path != "" {
				return fmt.Sprintf("%s · +%d -%d", path, added, removed)
			}
			return fmt.Sprintf("+%d -%d", added, removed)
		}
		return path
	case "grep", "glob":
		pattern := stringArg(args, "pattern", "query", "glob")
		path := stringArg(args, "path", "glob_path", "cwd")
		if pattern != "" && path != "" {
			return pattern + " · " + path
		}
		if pattern != "" {
			return pattern
		}
		return path
	case "web_search":
		return stringArg(args, "query")
	case "web_fetch":
		return stringArg(args, "url")
	case "todo_write":
		if todos, ok := args["todos"].([]any); ok {
			return fmt.Sprintf("%d 项任务", len(todos))
		}
		return stringArg(args, "description")
	case "ask_user_question":
		if question := stringArg(args, "question"); question != "" {
			return question
		}
		return stringArg(args, "header")
	case "run_code", "cua_run_code":
		return stringArg(args, "description", "title")
	case "terminal_send":
		return stringArg(args, "text")
	case "subagent", "subagent_fork":
		return stringArg(args, "description", "prompt")
	case "send_message":
		return stringArg(args, "message")
	case "schedule_create", "schedule_edit", "schedule_update":
		return stringArg(args, "name", "title", "cron")
	}
	for _, key := range []string{"description", "title", "name", "path", "query", "url"} {
		if value := stringArg(args, key); value != "" {
			return value
		}
	}
	return ""
}

func (a *app) toolView(c *ui.Context, m *message, key string) {
	t := m.Tool
	if t == nil {
		return
	}
	open := a.foldState("tool:"+key, false)
	running := t.Phase == "preparing" || t.Phase == "start"
	summary := toolSummary(t)
	if running && summary == "" {
		summary = "运行中…"
	}
	if t.IsError && summary == "" {
		summary = "失败"
	}
	var body func()
	if toolHasBody(m) {
		body = func() { a.toolBody(c, m, key) }
	}
	a.disclosureRow(c, key, toolIcon(t.Name), toolTitle(t.Name), summary, open, false, t.IsError, 4, body)
}

func toolHasBody(m *message) bool {
	t := m.Tool
	if t == nil {
		return false
	}
	if t.IsError || m.Text != "" {
		return true
	}
	if args := parseToolArgs(t.ArgsRaw); toolInputText(t.Name, args) != "" {
		return true
	}
	if len(t.SubCalls) > 0 && string(t.SubCalls) != "null" && string(t.SubCalls) != "[]" {
		return true
	}
	return false
}

func (a *app) toolBody(c *ui.Context, m *message, key string) {
	t := m.Tool
	if t.Name == "bash" || t.Name == "pwsh" {
		if a.terminalToolBody(c, m) {
			return
		}
	}
	args := parseToolArgs(t.ArgsRaw)
	if t.Name == "write" || t.Name == "edit" || t.Name == "apply_patch" {
		if a.toolDiffBody(c, t.Name, args, m.Text) {
			a.toolSubCalls(c, t, key)
			return
		}
	}
	if len(args) > 0 && t.ArgsRaw != "" && !t.IsError {
		if formatted := toolInputText(t.Name, args); formatted != "" {
			a.toolIOCard(c, "输入", formatted, false)
		}
	}
	if m.Text != "" {
		a.toolIOCard(c, "输出", m.Text, t.IsError)
	}
	a.messageImageGallery(c, *m)
	a.toolSubCalls(c, t, key)
}

func (a *app) toolIOCard(c *ui.Context, label, text string, stateError bool) {
	color := a.colors.Secondary
	if stateError {
		color = a.theme.Danger
	}
	ui.Column(c).FillWidth().MinWidth(0).Radius(16).Background(a.colors.CodeBlock).Padding(12, 16).Children(func() {
		ui.Row(c).AlignItems(ui.Start).Gap(14).Children(func() {
			ui.Text(c, label).Font(monoFont(a)).FontSize(11).FixedLineHeight(16).TextColor(a.colors.Caption).Shrink(0)
			ui.Scroll(c).MaxHeight(150).Children(func() {
				ui.Text(c, text).Font(monoFont(a)).FontSize(11).FixedLineHeight(16).TextColor(color).Wrap().Selectable()
			})
		})
	})
}

func toolDiffCounts(name string, args map[string]any) (added, removed int) {
	switch name {
	case "write":
		content := stringArg(args, "content")
		if content != "" {
			added = len(strings.Split(content, "\n"))
		}
	case "edit":
		if old := stringArg(args, "old_string", "oldText"); old != "" {
			removed = len(strings.Split(old, "\n"))
		}
		if replacement := stringArg(args, "new_string", "newText"); replacement != "" {
			added = len(strings.Split(replacement, "\n"))
		}
	case "apply_patch":
		if patch := stringArg(args, "patch", "diff"); patch != "" {
			for _, line := range strings.Split(patch, "\n") {
				switch {
				case strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++"):
					added++
				case strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---"):
					removed++
				}
			}
		}
	}
	return added, removed
}

func (a *app) toolDiffBody(c *ui.Context, name string, args map[string]any, result string) bool {
	var lines []struct {
		text  string
		color ui.Color
	}
	add := func(text string, color ui.Color) {
		lines = append(lines, struct {
			text  string
			color ui.Color
		}{text, color})
	}
	switch name {
	case "write":
		content := stringArg(args, "content")
		if content == "" {
			return false
		}
		for _, line := range strings.Split(content, "\n") {
			add("+ "+line, a.theme.Success)
		}
	case "edit":
		old := stringArg(args, "old_string", "oldText")
		replacement := stringArg(args, "new_string", "newText")
		if old == "" && replacement == "" {
			return false
		}
		if old != "" {
			for _, line := range strings.Split(old, "\n") {
				add("- "+line, a.theme.Danger)
			}
		}
		if replacement != "" {
			for _, line := range strings.Split(replacement, "\n") {
				add("+ "+line, a.theme.Success)
			}
		}
	case "apply_patch":
		patch := stringArg(args, "patch", "diff")
		if patch == "" {
			patch = result
		}
		if patch == "" {
			return false
		}
		for _, line := range strings.Split(patch, "\n") {
			color := a.colors.Secondary
			switch {
			case strings.HasPrefix(line, "+") && !strings.HasPrefix(line, "+++"):
				color = a.theme.Success
			case strings.HasPrefix(line, "-") && !strings.HasPrefix(line, "---"):
				color = a.theme.Danger
			}
			add(line, color)
		}
	}
	if len(lines) == 0 {
		return false
	}
	ui.Column(c).FillWidth().MinWidth(0).Radius(16).Background(a.colors.CodeBlock).Padding(12, 16).Children(func() {
		ui.Scroll(c).MaxHeight(224).Children(func() {
			ui.Column(c).Gap(0).Children(func() {
				for _, line := range lines {
					ui.Text(c, line.text).Font(monoFont(a)).FontSize(11).FixedLineHeight(16).TextColor(line.color).NoWrap().Selectable()
				}
			})
		})
	})
	return true
}

func monoFont(a *app) string {
	if a.uiPrefs.CodeFontFamily != "" {
		return a.uiPrefs.CodeFontFamily
	}
	return "SF Mono, Menlo"
}

func toolInputText(name string, args map[string]any) string {
	switch name {
	case "bash", "pwsh":
		return stringArg(args, "command")
	case "read", "write", "edit", "apply_patch", "read_image":
		return stringArg(args, "path", "file_path")
	case "grep", "glob":
		return stringArg(args, "pattern", "query", "glob")
	case "web_search":
		return stringArg(args, "query")
	case "web_fetch":
		return stringArg(args, "url")
	case "run_code", "cua_run_code":
		return stringArg(args, "code", "description")
	}
	return ""
}

func (a *app) sessionCwd() string {
	for _, s := range a.sessions {
		if s.ID == a.sessionID {
			if s.Cwd != "" {
				return s.Cwd
			}
			for _, w := range a.workspaces {
				if w.ID == s.WorkspaceID {
					return w.Path
				}
			}
		}
	}
	for _, w := range a.workspaces {
		if w.ID == a.workspaceID {
			return w.Path
		}
	}
	return ""
}

var (
	exitCodeMarker = regexp.MustCompile(`\n\[exit code: (-?\d+|null)\]$`)
	signalMarker   = regexp.MustCompile(`\n\[killed by signal: ([^\]\n]+)\]$`)
)

func splitTerminalResult(text string) (output string, exitCode *int, signal string) {
	if match := signalMarker.FindStringSubmatch(text); match != nil {
		return text[:len(text)-len(match[0])], nil, match[1]
	}
	if match := exitCodeMarker.FindStringSubmatch(text); match != nil {
		output = text[:len(text)-len(match[0])]
		if match[1] != "null" {
			if code, err := strconv.Atoi(match[1]); err == nil {
				exitCode = &code
			}
		}
		return output, exitCode, ""
	}
	return text, nil, ""
}

func (a *app) terminalToolBody(c *ui.Context, m *message) bool {
	t := m.Tool
	args := parseToolArgs(t.ArgsRaw)
	command := stringArg(args, "command")
	if command == "" {
		return false
	}
	cwd := stringArg(args, "workdir", "cwd")
	if cwd == "" {
		cwd = a.sessionCwd()
	}
	output, exitCode, signal := splitTerminalResult(m.Text)
	ui.Column(c).FillWidth().MinWidth(0).Clip().Radius(16).Background(a.colors.CodeBlock).Children(func() {
		ui.Row(c).FillWidth().Background(a.colors.CodeBanner).Padding(9, 14).Gap(8).AlignItems(ui.Center).Children(func() {
			ui.Text(c, "运行命令").FontSize(11).TextColor(a.theme.Text)
			if cwd != "" {
				ui.Text(c, cwd).FontSize(11).TextColor(a.colors.Tertiary).SingleLine().Ellipsis("…").Shrink(1)
			}
			ui.Spacer(c)
			if signal != "" {
				ui.Text(c, "signal "+signal).FontSize(11).TextColor(a.theme.Danger)
			} else if exitCode != nil && *exitCode != 0 {
				ui.Text(c, fmt.Sprintf("exit %d", *exitCode)).FontSize(11).TextColor(a.theme.Danger)
			}
			copyCommand := ui.ButtonBase(c).Size(24, 24).Padding(0).Radius(4).Label("复制命令").Tooltip("复制命令")
			copyCommand.Children(func() {
				icon(c, "copy-outline", 14).TextColor(a.colors.Secondary)
			})
			if copyCommand.Clicked() {
				c.WriteClipboard(command)
			}
		})
		ui.Scroll(c).MaxHeight(224).Direction(ui.LeftToRight).Children(func() {
			ui.Column(c).FillWidth().MinWidth(0).Padding(12, 14).Gap(4).Children(func() {
				ui.Text(c, "$ "+command).Font(monoFont(a)).FontSize(11).FixedLineHeight(18).TextColor(a.theme.Text).Wrap().Selectable()
				if output == "" {
					ui.Text(c, "无输出").Font(monoFont(a)).FontSize(11).FixedLineHeight(18).TextColor(a.colors.Tertiary)
				} else {
					ui.Text(c, output).Font(monoFont(a)).FontSize(11).FixedLineHeight(18).TextColor(a.colors.Secondary).Wrap().Selectable()
				}
			})
		})
	})
	a.toolSubCalls(c, t, m.ID)
	return true
}

func (a *app) toolSubCalls(c *ui.Context, t *toolNode, key string) {
	if len(t.SubCalls) == 0 || string(t.SubCalls) == "null" {
		return
	}
	var entries []struct {
		CallID     string          `json:"callId"`
		ID         string          `json:"id"`
		Name       string          `json:"name"`
		ArgsRaw    string          `json:"argsRaw"`
		Arguments  string          `json:"arguments"`
		Phase      string          `json:"phase"`
		IsError    bool            `json:"isError"`
		Content    json.RawMessage `json:"content"`
		Error      json.RawMessage `json:"error"`
		Meta       json.RawMessage `json:"meta"`
		ParentCall string          `json:"parentCallId"`
	}
	if json.Unmarshal(t.SubCalls, &entries) != nil {
		return
	}
	ui.Column(c).FillWidth().MinWidth(0).PaddingStart(18).Gap(4).Children(func() {
		for i := range entries {
			e := &entries[i]
			id := e.CallID
			if id == "" {
				id = e.ID
			}
			if id == "" {
				id = fmt.Sprintf("%s/sub:%d", key, i)
			}
			args := e.ArgsRaw
			if args == "" {
				args = e.Arguments
			}
			phase := e.Phase
			if phase == "" {
				phase = "settled"
			}
			sub := message{ID: key + "/sub:" + id, Role: "tool", Kind: "tool", Tool: &toolNode{
				CallID: id, Name: e.Name, ArgsRaw: args, Phase: phase, IsError: e.IsError,
				Content: e.Content, Error: e.Error, Meta: e.Meta,
			}}
			var text string
			if content := e.Content; len(content) > 0 {
				text = toolContentText(content)
			}
			sub.Text = text
			a.toolView(c, &sub, sub.ID)
		}
	})
}

func toolContentText(raw json.RawMessage) string {
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &blocks) != nil {
		return ""
	}
	var parts []string
	for _, b := range blocks {
		if b.Type == "text" && b.Text != "" {
			parts = append(parts, b.Text)
		}
	}
	return strings.Join(parts, "\n")
}
