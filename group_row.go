package main

import (
	"encoding/json"
	"strings"

	"github.com/egoist/mygo/ui"
)

type activityLabel struct{ title, icon string }

func toolActivity(name string) activityLabel {
	switch name {
	case "bash", "pwsh":
		return activityLabel{"执行了命令", "api-outline"}
	case "read", "read_image":
		return activityLabel{"已读取文件", "browse-outline"}
	case "write", "edit", "apply_patch":
		return activityLabel{"修改了文件", "edit-outline"}
	case "grep", "glob":
		return activityLabel{"已搜索代码", "search-outline"}
	case "web_search", "web_fetch":
		return activityLabel{"已搜索网页", "globe-outline"}
	case "subagent", "subagent_fork", "send_message", "list_agents":
		return activityLabel{"已协调子智能体", "agent-preset-outline"}
	case "todo_write":
		return activityLabel{"更新了计划", "plan-outline"}
	case "ask_user_question":
		return activityLabel{"向用户提出了问题", "question-outline"}
	}
	return activityLabel{"已调用工具", "sparkle"}
}

func (a *app) groupDescriptor(parts []chatPartRef) (title, iconName string) {
	var labels []string
	iconName = "sparkle"
	seen := map[string]bool{}
	thinking := false
	context := false
	add := func(label activityLabel) {
		if seen[label.title] {
			return
		}
		seen[label.title] = true
		labels = append(labels, label.title)
		if iconName == "sparkle" {
			iconName = label.icon
		}
	}
	for _, part := range parts {
		m := a.chatPartMessage(part)
		if m == nil {
			continue
		}
		switch {
		case part.Part == "reasoning" || m.Kind == "reasoning":
			thinking = true
		case m.Tool != nil:
			add(toolActivity(m.Tool.Name))
		case m.Kind == "command" || m.Role == "command":
			add(activityLabel{"执行了命令", "api-outline"})
		case m.Context != nil || m.Kind == "context" || m.Kind == "compaction":
			context = true
		default:
			add(activityLabel{"已调用工具", "sparkle"})
		}
	}
	// The reference names the work, not the private reasoning step, when a
	// Turn also ran commands or tools; a reasoning-only process still says so.
	if len(labels) == 0 && thinking {
		return "已完成分析", "think-outline"
	}
	if len(labels) == 0 && context {
		return "已注入上下文", "context-injection-outline"
	}
	if len(labels) == 0 {
		return "执行过程", iconName
	}
	// The original joins finished-step labels with the Chinese comma and does
	// not truncate a short category list with an ellipsis.
	return strings.Join(labels, "，"), iconName
}

type questionAnswerPair struct {
	Header, Question, Answer string
}

func questionAnswerPairs(t *toolNode, result string) []questionAnswerPair {
	if t == nil {
		return nil
	}
	var args struct {
		Questions []struct {
			ID       string `json:"id"`
			Header   string `json:"header"`
			Question string `json:"question"`
		} `json:"questions"`
	}
	if json.Unmarshal([]byte(t.ArgsRaw), &args) != nil {
		return nil
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
	var pairs []questionAnswerPair
	for _, question := range args.Questions {
		answer := answers[question.ID]
		if answer == "" {
			continue
		}
		pairs = append(pairs, questionAnswerPair{question.Header, question.Question, answer})
	}
	return pairs
}

// groupQuestionRecords keeps an answered question visible even while the
// process group is collapsed. The reference draws it as the right-aligned
// user bubble, not as a full-width tool card.
func (a *app) groupQuestionRecords(c *ui.Context, parts []chatPartRef) {
	for _, part := range parts {
		m := a.chatPartMessage(part)
		if m == nil || m.Tool == nil || m.Tool.Name != "ask_user_question" || m.Tool.IsError {
			continue
		}
		for _, pair := range questionAnswerPairs(m.Tool, m.Text) {
			ui.Row(c).Margin(4, 0, 0, 0).Children(func() {
				ui.Spacer(c)
				ui.Column(c).MaxWidth(a.chatContentWidth(c)*.702).Gap(4).Padding(13, 16).Radius(20).Background(a.colors.Bubble).Children(func() {
					if pair.Header != "" {
						ui.Text(c, pair.Header).FontSize(11).TextColor(a.colors.Tertiary)
					}
					ui.Text(c, pair.Question).FontSize(a.uiPrefs.FontSize).FixedLineHeight(22).TextColor(a.colors.Secondary).Wrap()
					ui.Text(c, pair.Answer).FontSize(a.uiPrefs.FontSize).FixedLineHeight(22).TextColor(a.theme.Text).Wrap()
				})
			})
			if m.Time > 0 {
				ui.Text(c, formatMessageClock(m.Time)).FontSize(12).TextColor(a.colors.Tertiary).TextAlign(ui.End).FillWidth()
			}
			ui.Spacer(c).Height(2)
		}
	}
}

func (a *app) groupView(c *ui.Context, row chatRow) {
	if len(row.GroupParts) == 0 {
		return
	}
	title, iconName := a.groupDescriptor(row.GroupParts)
	open := a.foldState("group:"+row.ID, false)
	if !*open {
		a.groupQuestionRecords(c, row.GroupParts)
	}
	a.disclosureRow(c, row.ID, iconName, title, "", open, false, false, 0, func() {
		ui.Column(c).FillWidth().MinWidth(0).Gap(4).Children(func() {
			for _, part := range row.GroupParts {
				a.chatPartView(c, part)
			}
		})
	})
}
