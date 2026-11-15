package main

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/egoist/mygo/ui"
)

type retryInfo struct {
	Retry   int     `json:"retry"`
	DelayMs float64 `json:"delayMs"`
	Mode    string  `json:"mode"`
	Failure *struct {
		Message string `json:"message"`
		Code    string `json:"code"`
	} `json:"failure"`
}

func (a *app) retryView(c *ui.Context, m *message, key string) {
	var info retryInfo
	_ = json.Unmarshal(m.Retry, &info)
	title := "模型重试"
	parts := []string{}
	if info.Retry > 0 {
		parts = append(parts, fmt.Sprintf("第 %d 次", info.Retry))
	}
	if info.DelayMs > 0 {
		parts = append(parts, fmt.Sprintf("等待 %.0f 秒", info.DelayMs/1000))
	}
	if info.Failure != nil && strings.TrimSpace(info.Failure.Message) != "" {
		parts = append(parts, info.Failure.Message)
	}
	summary := strings.Join(parts, " · ")
	open := a.foldState("retry:"+key, false)
	var body func()
	if info.Failure != nil || info.DelayMs > 0 {
		body = func() {
			ui.Column(c).Gap(4).Children(func() {
				if info.DelayMs > 0 {
					ui.Text(c, fmt.Sprintf("延迟：%.0f 毫秒", info.DelayMs)).FontSize(12).FixedLineHeight(18).TextColor(a.colors.Secondary)
				}
				if info.Failure != nil {
					text := info.Failure.Message
					if info.Failure.Code != "" {
						text = info.Failure.Code + " · " + text
					}
					ui.Text(c, "失败："+text).FontSize(12).FixedLineHeight(18).TextColor(a.colors.Secondary).Wrap()
				}
			})
		}
	}
	a.disclosureRow(c, key, "refresh-outline", title, summary, open, false, false, 4, body)
}
