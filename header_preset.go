package main

import "github.com/egoist/mygo/ui"

const presetHeaderHint = "本任务的 Agent 预设，在任务开始时确定"

// Mirrors AgentPresetLabel, not the new-session hero's AgentPresetSeat:
// a recorded composition is passive chrome and is never a switch control.
func (a *app) headerPresetText() (name, description string, present bool) {
	s := a.composer
	if !a.composerCurrent(s) || s.values.AgentPreset == nil {
		return "", "", false
	}
	id := *s.values.AgentPreset
	name, description = id, presetHeaderHint
	for _, option := range s.presets {
		if option.ID != id {
			continue
		}
		builtin, shipped := presetHeaderBuiltins[id]
		if option.Name != nil {
			name = *option.Name
		} else if shipped {
			name, description = builtin[0], builtin[1]
		}
		if option.Description != nil && (option.Name != nil || !shipped) {
			description = *option.Description
		}
		break
	}
	return name, description, true
}

var presetHeaderBuiltins = map[string][2]string{
	"standard": {"标准模式", "处理代码、文件和资料，适合大多数任务。Agent 会按需使用检索、编辑和终端等工具。"},
	"ptc":      {"PTC 模式", "包含标准模式的所有能力，更适合批量调用工具，并对结果进行筛选、整理、去重、统计或汇总的任务。"},
	"minimal":  {"极简模式", "Agent 使用终端和图片读取工具，并支持上下文压缩，适合测试和对比其基础表现。"},
	"cordis":   {"创造模式", "用对话定制 DSH：让 Agent 编写插件，添加新功能或界面；也能组合工具和提示词，创建自己的模式。"},
}

func (a *app) headerPresetView(c *ui.Context) {
	if a.conversationColumnWidth(c) <= 540 {
		return
	}
	name, description, present := a.headerPresetText()
	if !present {
		return
	}
	ui.Row(c).MaxWidth(180).MinWidth(0).Height(22).Shrink(0).Padding(0, 2, 0, 0).Gap(4).AlignItems(ui.Center).Radius(3).TextColor(a.theme.TextMuted).Tooltip(description).Label("任务模式").Children(func() {
		icon(c, "agent-preset-outline", 14).Shrink(0)
		ui.Text(c, name).FontSize(12).SingleLine().Ellipsis("…").MinWidth(0).Shrink(1)
	})
}
