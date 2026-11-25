package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
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
	"workflow": "工作流", "exit_plan_mode": "提交计划", "subagent": "子智能体", "subagent_fork": "分叉子智能体",
	"list_agents": "列出智能体", "send_message": "发送消息",
	"interrupt_agent": "中断智能体",
}

var toolIcons = map[string]string{
	"bash": "api-outline", "pwsh": "api-outline",
	"read": "browse-outline", "read_image": "browse-outline",
	"write": "edit-outline", "edit": "edit-outline", "apply_patch": "edit-outline",
	"grep": "search-outline", "glob": "search-outline",
	"web_search": "search-outline", "web_fetch": "globe-outline", "workflow": "branch-outline", "exit_plan_mode": "plan-outline",
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
	if t.Name == "read" && os.Getenv("DSH_QA_READ_OPEN") != "" {
		*open = true
	}
	running := t.Phase == "preparing" || t.Phase == "start"
	summary := maskSecrets(toolSummary(t))
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

// toolHasBody mirrors the original tool row's `expandable`
// (`state !== 'preparing' && (inputRaw !== null || outputText !== null || card !== null)`):
// a preparing call has nothing to show yet, while any later call with
// arguments, output, an error or sub-calls opens its details. Arguments count
// for every tool, including ones the client has no friendly formatter for
// (MCP and plugin tools), so no row is a dead end.
func toolHasBody(m *message) bool {
	t := m.Tool
	if t == nil {
		return false
	}
	if t.Phase == "preparing" {
		return false
	}
	if t.IsError || m.Text != "" {
		return true
	}
	// Cheap on every frame: the pretty-printed form is built only once the
	// row is open. `null` is the wire's "no arguments" envelope.
	if raw := strings.TrimSpace(t.ArgsRaw); raw != "" && raw != "null" {
		return true
	}
	if len(t.SubCalls) > 0 && string(t.SubCalls) != "null" && string(t.SubCalls) != "[]" {
		return true
	}
	return false
}

// toolArgsText is the original `formatToolBody`: the call's arguments as
// pretty-printed JSON, or the raw text when it does not parse. Indentation
// keeps the argument order the Host recorded, as JSON.stringify does, instead
// of sorting keys through a map. A null envelope yields nothing, so a bare
// call stays a summary row.
func toolArgsText(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "null" {
		return ""
	}
	var formatted bytes.Buffer
	if err := json.Indent(&formatted, []byte(trimmed), "", "  "); err != nil {
		return trimmed
	}
	return formatted.String()
}

func (a *app) toolBody(c *ui.Context, m *message, key string) {
	t := m.Tool
	if t.Name == "bash" || t.Name == "pwsh" {
		if a.terminalToolBody(c, m) {
			return
		}
	}
	args := parseToolArgs(t.ArgsRaw)
	// An activation has its own receipt card, so its raw argument JSON never
	// stands in for the readable form the original shows.
	if t.Name == "subagent" || t.Name == "subagent_fork" {
		if a.subagentToolBody(c, m, key) {
			a.toolSubCalls(c, t, key)
			return
		}
	}
	if t.Name == "workflow" {
		if a.toolWorkflowBody(c, t, m.Text) {
			a.toolSubCalls(c, t, key)
			return
		}
	}
	if t.Name == "exit_plan_mode" {
		if a.toolPlanBody(c, t) {
			a.toolSubCalls(c, t, key)
			return
		}
	}
	if t.Name == "ask_user_question" {
		if a.toolQuestionBody(c, t, m.Text) {
			a.toolSubCalls(c, t, key)
			return
		}
	}
	if t.Name == "todo_write" {
		if a.toolTodoBody(c, t) {
			a.toolSubCalls(c, t, key)
			return
		}
	}
	if t.Name == "read_image" {
		if a.toolReadImageBody(c, m) {
			a.toolSubCalls(c, t, key)
			return
		}
	}
	if t.Name == "web_search" || t.Name == "web_fetch" {
		if a.toolWebBody(c, t) {
			a.toolSubCalls(c, t, key)
			return
		}
	}
	if t.Name == "grep" || t.Name == "glob" {
		if a.toolSearchBody(c, t, m.Text) {
			a.toolSubCalls(c, t, key)
			return
		}
	}
	if t.Name == "read" {
		if a.toolReadBody(c, t, m.Text) {
			a.toolSubCalls(c, t, key)
			return
		}
	}
	if t.Name == "write" || t.Name == "edit" || t.Name == "apply_patch" {
		if a.toolDiffBody(c, t.Name, args, m.Text) {
			a.toolSubCalls(c, t, key)
			return
		}
	}
	// The original shows the whole argument JSON when no dedicated card owns
	// the input, so tools without a friendly argument formatter (MCP and
	// plugin tools) still have a readable input section.
	if !t.IsError {
		if formatted := toolInputText(t.Name, args); formatted != "" {
			a.toolIOCard(c, "输入", formatted, false)
		} else if formatted := toolArgsText(t.ArgsRaw); formatted != "" {
			a.toolIOCard(c, "输入", formatted, false)
		}
	}
	if m.Text != "" {
		a.toolIOCard(c, "输出", m.Text, t.IsError)
	}
	a.messageImageGallery(c, *m)
	a.toolSubCalls(c, t, key)
}

// toolReadImageBody gives a read_image result its own card chrome: the path
// and the decoded image, rather than the generic input/output pair.
func (a *app) toolReadImageBody(c *ui.Context, m *message) bool {
	if m == nil || len(messageImageReferences(*m)) == 0 {
		return false
	}
	args := parseToolArgs(m.Tool.ArgsRaw)
	path := stringArg(args, "path", "file_path", "filePath")
	ui.Column(c).FillWidth().MinWidth(0).Radius(16).Background(a.colors.CodeBlock).Padding(10, 14).Gap(8).Children(func() {
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			icon(c, "browse-outline", 14).TextColor(a.colors.Caption)
			if path == "" {
				path = "图片"
			}
			ui.Text(c, path).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Caption).SingleLine().Ellipsis("…").Grow(1)
		})
		a.messageImageGallery(c, *m)
	})
	return true
}

// toolTodoBody draws the checklist a todo_write call wrote, instead of the
// generic argument JSON.
func (a *app) toolTodoBody(c *ui.Context, t *toolNode) bool {
	args := parseToolArgs(t.ArgsRaw)
	raw, ok := args["todos"].([]any)
	if !ok || len(raw) == 0 {
		return false
	}
	type todo struct{ content, status string }
	var todos []todo
	for _, item := range raw {
		obj, ok := item.(map[string]any)
		if !ok {
			continue
		}
		content, _ := obj["content"].(string)
		status, _ := obj["status"].(string)
		todos = append(todos, todo{content, status})
	}
	if len(todos) == 0 {
		return false
	}
	ui.Column(c).FillWidth().MinWidth(0).Radius(16).Background(a.colors.CodeBlock).Padding(10, 14).Gap(6).Children(func() {
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			icon(c, "checklist-outline", 14).TextColor(a.colors.Caption)
			ui.Text(c, "任务清单").FontSize(12).TextColor(a.colors.Caption).Grow(1)
			ui.Text(c, fmt.Sprintf("%d 项", len(todos))).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Caption)
		})
		for _, item := range todos {
			ui.Row(c).Gap(8).AlignItems(ui.Start).Children(func() {
				name, color := "check-circle-outline", a.colors.Caption
				switch item.status {
				case "completed":
					name, color = "check-circle-fill", a.colors.Tertiary
				case "in_progress":
					name, color = "loading-outline", a.theme.Accent
				}
				icon(c, name, 14).TextColor(color)
				ui.Text(c, item.content).FontSize(12).TextColor(a.colors.Secondary).Wrap().Grow(1)
			})
		}
	})
	return true
}

// toolPlanBody draws the plan a call submitted, in the same markdown the
// right-pane plan tab uses.
func (a *app) toolPlanBody(c *ui.Context, t *toolNode) bool {
	plan := stringArg(parseToolArgs(t.ArgsRaw), "plan")
	if strings.TrimSpace(plan) == "" {
		return false
	}
	ui.Column(c).FillWidth().MinWidth(0).Radius(16).Background(a.colors.CodeBlock).Padding(10, 14).Gap(6).Children(func() {
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			icon(c, "plan-outline", 14).TextColor(a.colors.Caption)
			ui.Text(c, "计划").FontSize(12).TextColor(a.colors.Caption)
		})
		markdown.View(c, plan, &a.md)
	})
	return true
}

// toolWorkflowBody reads the workflow's completion line and return value from
// its recorded text, and the script from its arguments.
func (a *app) toolWorkflowBody(c *ui.Context, t *toolNode, result string) bool {
	text := strings.TrimSpace(result)
	args := parseToolArgs(t.ArgsRaw)
	script := stringArg(args, "code", "script")
	if text == "" && script == "" {
		return false
	}
	name, agents, returned := "", "", ""
	if match := workflowResultText.FindStringSubmatch(text); match != nil {
		name, agents, returned = match[1], match[2], strings.TrimSpace(match[3])
	}
	ui.Column(c).FillWidth().MinWidth(0).Radius(16).Background(a.colors.CodeBlock).Padding(10, 14).Gap(8).Children(func() {
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			icon(c, "branch-outline", 14).TextColor(a.colors.Caption)
			label := "工作流"
			if name != "" {
				label += " " + name
			}
			ui.Text(c, label).FontSize(12).TextColor(a.colors.Secondary).Grow(1)
			if agents != "" {
				ui.Text(c, agents+" 个智能体").FontSize(11).TextColor(a.colors.Caption)
			}
		})
		if script != "" {
			if phases := workflowPhaseNames(script); len(phases) > 0 {
				ui.Row(c).Gap(4).Wrap().AlignItems(ui.Center).Children(func() {
					for i, phase := range phases {
						phase := phase
						index := i
						ui.Row(c).Height(24).Padding(0, 8).Radius(6).Gap(5).AlignItems(ui.Center).Background(a.colors.Subtle).Border(.5, a.theme.Border).Children(func() {
							ui.Text(c, fmt.Sprint(index+1)).FontSize(10).TextColor(a.colors.Caption)
							ui.Text(c, phase).FontSize(11).TextColor(a.colors.Secondary)
						})
						if index < len(phases)-1 {
							icon(c, "chevron-right-outline", 11).TextColor(a.colors.Caption)
						}
					}
				})
			}
			ui.Text(c, "脚本").FontSize(11).TextColor(a.colors.Caption)
			ui.Text(c, script).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Secondary).Selectable().Wrap()
		}
		if returned != "" {
			ui.Text(c, "返回值").FontSize(11).TextColor(a.colors.Caption)
			ui.Text(c, returned).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Secondary).Selectable().Wrap()
		} else if text != "" && name == "" {
			ui.Text(c, text).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Secondary).Selectable().Wrap()
		}
	})
	return true
}

var workflowPhaseCall = regexp.MustCompile(`phase\(\s*["']([^"']+)["']`)

// workflowPhaseNames lists the phase labels a workflow script declares, in
// source order, so the row can show its node sequence without executing it.
func workflowPhaseNames(script string) []string {
	var names []string
	seen := map[string]bool{}
	for _, match := range workflowPhaseCall.FindAllStringSubmatch(script, -1) {
		name := strings.TrimSpace(match[1])
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		names = append(names, name)
	}
	return names
}

var workflowResultText = regexp.MustCompile(`(?s)^workflow "([^"]*)" completed \((\d+) agents?\).\nReturn value:\n(.*)$`)

// toolQuestionBody pairs the question a call asked with the answer the Host
// recorded, so a settled ask_user_question row reads as a Q/A card.
func (a *app) toolQuestionBody(c *ui.Context, t *toolNode, result string) bool {
	var args struct {
		Questions []struct {
			ID       string `json:"id"`
			Header   string `json:"header"`
			Question string `json:"question"`
			Options  []struct {
				Label string `json:"label"`
			} `json:"options"`
		} `json:"questions"`
	}
	if json.Unmarshal([]byte(t.ArgsRaw), &args) != nil || len(args.Questions) == 0 {
		return false
	}
	answers := map[string]string{}
	var resultObj struct {
		Answers []struct {
			ID       string   `json:"id"`
			Selected []string `json:"selected"`
			Custom   string   `json:"custom"`
		} `json:"answers"`
	}
	if json.Unmarshal([]byte(result), &resultObj) == nil {
		for _, answer := range resultObj.Answers {
			value := strings.Join(answer.Selected, "、")
			if answer.Custom != "" {
				if value != "" {
					value += " · "
				}
				value += answer.Custom
			}
			answers[answer.ID] = value
		}
	}
	ui.Column(c).FillWidth().MinWidth(0).Radius(16).Background(a.colors.CodeBlock).Padding(10, 14).Gap(8).Children(func() {
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			icon(c, "question-outline", 14).TextColor(a.colors.Caption)
			ui.Text(c, "提问").FontSize(12).TextColor(a.colors.Caption)
		})
		for _, question := range args.Questions {
			if question.Header != "" {
				ui.Text(c, question.Header).FontSize(11).TextColor(a.colors.Caption)
			}
			ui.Text(c, question.Question).FontSize(12).TextColor(a.colors.Secondary).Wrap()
			if answer := answers[question.ID]; answer != "" {
				ui.Text(c, "回答："+answer).FontSize(12).TextColor(a.theme.Text).Wrap()
			} else if len(question.Options) > 0 {
				var labels []string
				for _, option := range question.Options {
					labels = append(labels, option.Label)
				}
				ui.Text(c, "选项："+strings.Join(labels, " / ")).FontSize(11).TextColor(a.colors.Caption).Wrap()
			}
		}
	})
	return true
}

type webCardSource struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Snippet     string `json:"snippet"`
	PublishedAt string `json:"publishedAt"`
}

type webCardMeta struct {
	URL        string          `json:"url"`
	StatusCode int             `json:"statusCode"`
	Truncated  bool            `json:"truncated"`
	Answer     string          `json:"answer"`
	Sources    []webCardSource `json:"sources"`
}

// toolWebBody draws the retrieval summary the reference uses for web search
// and fetch: the final URL and status for a fetch, or the answer and cited
// sources for a search.
func (a *app) toolWebBody(c *ui.Context, t *toolNode) bool {
	if t == nil || t.IsError {
		return false
	}
	var meta webCardMeta
	if json.Unmarshal(t.Meta, &meta) != nil {
		return false
	}
	if t.Name == "web_fetch" {
		if meta.URL == "" || meta.StatusCode == 0 {
			return false
		}
	} else if len(meta.Sources) == 0 && meta.Answer == "" {
		return false
	}
	ui.Column(c).FillWidth().MinWidth(0).Radius(16).Background(a.colors.CodeBlock).Padding(10, 14).Gap(6).Children(func() {
		if t.Name == "web_fetch" {
			ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
				icon(c, "globe-outline", 14).TextColor(a.colors.Caption)
				ui.Text(c, meta.URL).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Secondary).SingleLine().Ellipsis("…").Grow(1)
				color := a.colors.Caption
				if meta.StatusCode >= 400 {
					color = a.theme.Danger
				}
				ui.Text(c, fmt.Sprintf("%d", meta.StatusCode)).Font(monoFont(a)).FontSize(11).TextColor(color)
			})
			if meta.Truncated {
				ui.Text(c, "内容已截断").Font(monoFont(a)).FontSize(11).TextColor(a.colors.Caption)
			}
			return
		}
		if meta.Answer != "" {
			ui.Text(c, maskSecrets(meta.Answer)).FontSize(12).TextColor(a.colors.Secondary).Wrap()
		}
		if len(meta.Sources) > 0 {
			ui.Scroll(c).MaxHeight(220).Children(func() {
				ui.Column(c).Gap(6).Children(func() {
					for _, source := range meta.Sources {
						label := source.Title
						if label == "" {
							label = source.URL
						}
						ui.Row(c).Gap(4).AlignItems(ui.Center).Children(func() {
							icon(c, "globe-outline", 12).TextColor(a.colors.Caption)
							if strings.HasPrefix(source.URL, "https://") || strings.HasPrefix(source.URL, "http://") {
								ui.Link(c, label, source.URL).FontSize(12).SingleLine().Ellipsis("…").Grow(1)
							} else {
								ui.Text(c, label).FontSize(12).TextColor(a.colors.Link).SingleLine().Ellipsis("…").Grow(1)
							}
							if source.PublishedAt != "" {
								ui.Text(c, source.PublishedAt).FontSize(10).TextColor(a.colors.Caption)
							}
						})
						if source.Snippet != "" {
							ui.Text(c, source.Snippet).FontSize(11).TextColor(a.colors.Caption).Wrap()
						}
					}
				})
			})
		}
		if meta.Truncated {
			ui.Text(c, "来源已截断").Font(monoFont(a)).FontSize(11).TextColor(a.colors.Caption)
		}
	})
	return true
}

type searchCardMatch struct {
	LineNumber int    `json:"lineNumber"`
	Line       string `json:"line"`
}

type searchCardFile struct {
	Path    string            `json:"path"`
	Matches []searchCardMatch `json:"matches"`
}

type searchCardMeta struct {
	Truncated bool             `json:"truncated"`
	Total     int              `json:"total"`
	Shape     string           `json:"shape"`
	Files     []searchCardFile `json:"files"`
	Paths     []string         `json:"paths"`
}

// toolSearchBody draws the grep/glob result groups the reference uses: files
// with numbered match lines, or a path list, capped in the chat row.
func (a *app) toolSearchBody(c *ui.Context, t *toolNode, result string) bool {
	if t == nil || t.IsError {
		return false
	}
	var meta searchCardMeta
	if json.Unmarshal(t.Meta, &meta) != nil || meta.Total < 0 {
		return false
	}
	if meta.Shape != "matches" && meta.Shape != "paths" {
		return false
	}
	args := parseToolArgs(t.ArgsRaw)
	pattern := stringArg(args, "pattern", "query", "glob")
	open := a.foldState("search:"+t.CallID, false)
	ui.Column(c).FillWidth().MinWidth(0).Radius(16).Background(a.colors.CodeBlock).Padding(10, 14).Gap(6).Children(func() {
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			icon(c, "search-outline", 14).TextColor(a.colors.Caption)
			ui.Text(c, pattern).Font(monoFont(a)).FontSize(11).TextColor(a.theme.Text).SingleLine().Ellipsis("…").Grow(1)
			label := fmt.Sprintf("%d 个文件", meta.Total)
			if meta.Shape == "matches" {
				label = fmt.Sprintf("%d 处匹配", meta.Total)
			}
			ui.Text(c, label).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Caption)
		})
		switch meta.Shape {
		case "matches":
			shown := 0
			for _, file := range meta.Files {
				if shown >= 8 {
					break
				}
				ui.Text(c, file.Path).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Caption).SingleLine().Ellipsis("…")
				for _, match := range file.Matches {
					if shown >= 8 {
						break
					}
					shown++
					ui.Row(c).Gap(8).AlignItems(ui.Start).Children(func() {
						ui.Text(c, fmt.Sprintf("%d", match.LineNumber)).Font(monoFont(a)).FontSize(11).Width(32).TextColor(a.colors.Caption).TextAlign(ui.End)
						spans := highlightSpans(strings.TrimSpace(match.Line), codeLanguage(file.Path), a.colors.Secondary, ui.Hex("#c678dd"), ui.Hex("#98c379"), ui.Hex("#7f848e"), ui.Hex("#d19a66"))
						ui.RichText(c, spans...).Font(monoFont(a)).FontSize(11).SingleLine().Ellipsis("…").Grow(1)
					})
				}
			}
			if meta.Total > shown {
				ui.Text(c, fmt.Sprintf("… 还有 %d 处匹配", meta.Total-shown)).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Caption).Padding(0, 40)
			}
		case "paths":
			limit := len(meta.Paths)
			if limit > 10 {
				limit = 10
			}
			for _, path := range meta.Paths[:limit] {
				ui.Text(c, path).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Secondary).SingleLine().Ellipsis("…")
			}
			if len(meta.Paths) > limit {
				ui.Text(c, fmt.Sprintf("… 还有 %d 个文件", len(meta.Paths)-limit)).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Caption).Padding(0, 12)
			}
		}
		if meta.Truncated && strings.TrimSpace(result) != "" {
			if *open {
				ui.Text(c, strings.TrimSpace(result)).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Secondary).Selectable().Wrap()
			}
			label := "显示完整结果"
			if *open {
				label = "收起完整结果"
			}
			if ui.ButtonBase(c).Padding(0).Label(label).Children(func() {
				ui.Text(c, label).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Caption)
			}).Clicked() {
				*open = !*open
			}
		}
	})
	return true
}

type readCardLine struct {
	Number int    `json:"number"`
	Text   string `json:"text"`
}

type readCardMeta struct {
	Path       string         `json:"path"`
	Lines      []readCardLine `json:"lines"`
	TotalLines int            `json:"totalLines"`
	Lang       string         `json:"lang"`
}

// toolReadBody draws the line-numbered file window the reference uses for a
// completed read call. It falls back to the raw result when the Host did not
// attach line metadata, so a provider that returns plain text still gets a card.
func (a *app) toolReadBody(c *ui.Context, t *toolNode, result string) bool {
	if t == nil || t.IsError {
		return false
	}
	var meta readCardMeta
	_ = json.Unmarshal(t.Meta, &meta)
	path := meta.Path
	if path == "" {
		path = toolSummary(t)
	}
	lines := meta.Lines
	if len(lines) == 0 {
		for i, line := range strings.Split(strings.TrimRight(result, "\n"), "\n") {
			if i >= 40 {
				break
			}
			lines = append(lines, readCardLine{Number: i + 1, Text: line})
		}
	}
	if path == "" && len(lines) == 0 {
		return false
	}
	total := meta.TotalLines
	if total == 0 {
		total = len(lines)
	}
	open := a.foldState("read:"+t.CallID+path, false)
	wrap := a.foldState("readwrap:"+t.CallID+path, true)
	hidden := max(0, len(lines)-10)
	shown := lines
	if hidden > 0 && !*open {
		shown = append(append([]readCardLine(nil), lines[:5]...), lines[len(lines)-5:]...)
	}
	raw := strings.Join(func() []string {
		out := make([]string, len(lines))
		for i, line := range lines {
			out[i] = line.Text
		}
		return out
	}(), "\n")
	ui.Column(c).FillWidth().MinWidth(0).Radius(16).Background(a.colors.CodeBlock).Padding(10, 14).Gap(6).Children(func() {
		ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
			icon(c, "browse-outline", 14).TextColor(a.colors.Caption)
			ui.Text(c, path).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Caption).SingleLine().Ellipsis("…").Grow(1)
			if meta.Lang != "" {
				ui.Text(c, meta.Lang).Font(monoFont(a)).FontSize(10).TextColor(a.colors.Caption)
			}
			if total > 0 {
				ui.Text(c, fmt.Sprintf("%d 行", total)).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Caption)
			}
			if ui.ButtonBase(c).Padding(3).Label("切换自动换行").Tooltip("自动换行").Children(func() {
				icon(c, "wrap-lines-outline", 13).TextColor(a.colors.Caption)
			}).Clicked() {
				*wrap = !*wrap
			}
			if ui.ButtonBase(c).Padding(3).Label("复制文件内容").Tooltip("复制").Children(func() { icon(c, "copy-outline", 13).TextColor(a.colors.Caption) }).Clicked() {
				c.WriteClipboard(raw)
			}
		})
		for _, line := range shown {
			ui.Row(c).Gap(10).AlignItems(ui.Start).Children(func() {
				ui.Text(c, fmt.Sprintf("%d", line.Number)).Font(monoFont(a)).FontSize(11).Width(32).TextColor(a.colors.Caption).TextAlign(ui.End)
				spans := highlightSpans(line.Text, meta.Lang, a.colors.Secondary, ui.Hex("#c678dd"), ui.Hex("#98c379"), ui.Hex("#7f848e"), ui.Hex("#d19a66"))
				text := ui.RichText(c, spans...).Font(monoFont(a)).FontSize(11).Selectable().Grow(1)
				if *wrap {
					text.Wrap()
				} else {
					text.SingleLine().Ellipsis("…")
				}
			})
		}
		if hidden > 0 {
			if ui.ButtonBase(c).Label("read-more").Padding(0).Children(func() {
				label := fmt.Sprintf("展开中间 %d 行", hidden)
				if *open {
					label = "收起"
				}
				ui.Text(c, label).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Caption)
			}).Clicked() {
				*open = !*open
			}
		}
	})
	return true
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
				ui.Text(c, maskSecrets(text)).Font(monoFont(a)).FontSize(11).FixedLineHeight(16).TextColor(color).Wrap().Selectable()
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
	ui.Column(c).FillWidth().MinWidth(0).Radius(16).Background(a.colors.CodeBlock).Padding(12, 16).Gap(8).Children(func() {
		if path := stringArg(args, "path", "file_path", "filePath"); path != "" {
			ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
				ui.Text(c, path).Font(monoFont(a)).FontSize(11).TextColor(a.colors.Caption).SingleLine().Ellipsis("…").Grow(1)
				if filepath.IsAbs(path) {
					if _, err := os.Stat(path); err == nil {
						if ui.ButtonBase(c).Padding(2).Label("在 Finder 中显示 " + path).Children(func() {
							icon(c, "folder-open-outline", 13).TextColor(a.colors.Caption)
						}).Clicked() {
							mygo.Shell.ShowItemInFolder(path)
						}
					}
				}
			})
		}
		ui.Scroll(c).MaxHeight(224).Children(func() {
			ui.Column(c).Gap(0).Children(func() {
				for _, line := range lines {
					ui.Text(c, maskSecrets(line.text)).Font(monoFont(a)).FontSize(11).FixedLineHeight(16).TextColor(line.color).NoWrap().Selectable()
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
				ui.Text(c, "$ "+maskSecrets(command)).Font(monoFont(a)).FontSize(11).FixedLineHeight(18).TextColor(a.theme.Text).Wrap().Selectable()
				if output == "" {
					ui.Text(c, "无输出").Font(monoFont(a)).FontSize(11).FixedLineHeight(18).TextColor(a.colors.Tertiary)
				} else {
					ui.Text(c, maskSecrets(output)).Font(monoFont(a)).FontSize(11).FixedLineHeight(18).TextColor(a.colors.Secondary).Wrap().Selectable()
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
