package main

import (
	"strings"

	"github.com/egoist/mygo/ui"
)

type activityLabel struct{ title, icon string }

func toolActivity(name string) activityLabel {
	switch name {
	case "bash", "pwsh":
		return activityLabel{"运行命令", "api-outline"}
	case "read", "read_image":
		return activityLabel{"读取文件", "browse-outline"}
	case "write", "edit", "apply_patch":
		return activityLabel{"编辑文件", "edit-outline"}
	case "grep", "glob":
		return activityLabel{"搜索代码", "search-outline"}
	case "web_search", "web_fetch":
		return activityLabel{"网页搜索", "globe-outline"}
	case "subagent", "subagent_fork", "send_message", "list_agents":
		return activityLabel{"协调子智能体", "agent-preset-outline"}
	case "todo_write":
		return activityLabel{"更新计划", "plan-outline"}
	case "ask_user_question":
		return activityLabel{"等待你的操作", "question-outline"}
	}
	return activityLabel{"调用工具", "sparkle"}
}

func (a *app) groupDescriptor(parts []chatPartRef) (title, iconName string) {
	var labels []string
	iconName = "sparkle"
	seen := map[string]bool{}
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
			add(activityLabel{"思考", "think-outline"})
		case m.Tool != nil:
			add(toolActivity(m.Tool.Name))
		case m.Kind == "command" || m.Role == "command":
			add(activityLabel{"指令", "api-outline"})
		case m.Context != nil || m.Kind == "context" || m.Kind == "compaction":
			add(activityLabel{"上下文", "context-injection-outline"})
		default:
			add(activityLabel{"调用工具", "sparkle"})
		}
	}
	if len(labels) == 0 {
		return "执行过程", iconName
	}
	if len(labels) > 3 {
		labels = append(labels[:3], "…")
	}
	return strings.Join(labels, "、"), iconName
}

func (a *app) groupView(c *ui.Context, row chatRow) {
	if len(row.GroupParts) == 0 {
		return
	}
	title, iconName := a.groupDescriptor(row.GroupParts)
	open := a.foldState("group:"+row.ID, false)
	a.disclosureRow(c, row.ID, iconName, title, "", open, false, false, 0, func() {
		ui.Column(c).FillWidth().MinWidth(0).Gap(4).Children(func() {
			for _, part := range row.GroupParts {
				a.chatPartView(c, part)
			}
		})
	})
}
