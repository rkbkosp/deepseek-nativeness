package main

import (
	"encoding/json"

	"github.com/egoist/mygo/ui"
)

var triggerLabels = map[string]struct{ title, icon string }{
	"github":   {"收到 GitHub 事件", "branch-outline"},
	"webhook":  {"收到外部事件", "globe-outline"},
	"schedule": {"自动化任务", "clock-outline"},
	"job":      {"后台任务状态更新", "queue-outline"},
	"plugin":   {"插件状态更新", "plugin-pinwheel-outline"},
	"retry":    {"模型重试", "refresh-outline"},
	"goal":     {"目标触发", "goal-outline"},
	"agent":    {"智能体事件", "paper-plane-outline"},
	"team":     {"智能体团队事件", "users-outline"},
	"subagent": {"子智能体事件", "agent-preset-outline"},
	"request":  {"继续请求", "play-outline"},
}

func (a *app) turnTriggerView(c *ui.Context, m *message, key string) {
	spec, ok := triggerLabels[m.Trigger]
	if !ok {
		a.contextView(c, *m, key)
		return
	}
	open := a.foldState("trigger:"+key, false)
	ui.Column(c).FillWidth().MinWidth(0).Border(.5, a.theme.Border).Radius(20).Background(a.colors.CodeBlock).Children(func() {
		header := ui.ButtonBase(c).FillWidth().Padding(12, 16).Gap(10).AlignItems(ui.Center).Label(spec.title)
		header.Children(func() {
			icon(c, spec.icon, 14).TextColor(a.colors.Tertiary)
			ui.Text(c, spec.title).FontSize(14).FixedLineHeight(24).TextColor(a.colors.Tertiary).Grow(1)
			if m.Time > 0 {
				ui.Text(c, formatMessageClock(m.Time)).FontSize(12).TextColor(a.colors.Caption)
			}
			glyph := "chevron-down-outline"
			if *open {
				glyph = "chevron-up-outline"
			}
			icon(c, glyph, 12).TextColor(a.colors.Tertiary)
		})
		if header.Clicked() {
			*open = !*open
			c.Invalidate()
		}
		if *open {
			ui.Column(c).FillWidth().Padding(0, 16, 12, 40).Gap(6).Children(func() {
				ui.Text(c, "这条通知触发了本轮回复。").FontSize(12).FixedLineHeight(20).TextColor(a.colors.Secondary)
				ui.Scroll(c).MaxHeight(240).Children(func() {
					ui.Text(c, m.Text).FontSize(12).FixedLineHeight(20).TextColor(a.colors.Secondary).Wrap().Selectable()
				})
			})
		}
	})
}

func (a *app) turnErrorDetail(turn int) string {
	for _, raw := range a.current.Turns {
		var value struct {
			Turn   int `json:"turn"`
			Reason struct {
				Kind    string `json:"kind"`
				Message string `json:"message"`
				Code    string `json:"code"`
				Error   *struct {
					Message string `json:"message"`
					Code    string `json:"code"`
				} `json:"error"`
			} `json:"reason"`
		}
		if json.Unmarshal(raw, &value) != nil || value.Turn != turn {
			continue
		}
		if value.Reason.Error != nil && value.Reason.Error.Message != "" {
			return value.Reason.Error.Message
		}
		return value.Reason.Message
	}
	return ""
}

func (a *app) turnNoticeView(c *ui.Context, row chatRow) {
	maxTokens := row.NoticeKind == "max-tokens" || row.NoticeKind == "max_tokens"
	dot := a.theme.Danger
	title := "处理失败"
	body := row.NoticeText
	if maxTokens {
		dot = a.theme.Warning
		title = "达到 token 上限"
		body = "回复在输出上限处结束，可能不完整。"
	} else if body == "" {
		body = "本轮执行失败。"
	}
	ui.Row(c).FillWidth().MinWidth(0).Gap(8).AlignItems(ui.Start).Children(func() {
		ui.Box(c).Size(6, 6).Radius(3).Shrink(0).Margin(7, 0, 0, 0).Background(dot)
		ui.Column(c).MinWidth(0).Shrink(1).Gap(2).Children(func() {
			ui.Text(c, title).FontSize(13).FixedLineHeight(20).FontWeight(600).TextColor(dot)
			ui.Text(c, body).FontSize(13).FixedLineHeight(20).TextColor(a.colors.Secondary).Wrap()
		})
	})
}
