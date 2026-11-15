package main

import (
	"fmt"

	"github.com/egoist/mygo/ui"
)

type sessionReading struct {
	turns, steps      int
	tokens, cacheRead int64
	promptTokens      int64
}

func (a *app) sessionReading() sessionReading {
	var reading sessionReading
	turns := map[int]bool{}
	steps := map[[2]int]bool{}
	for i := range a.current.Messages {
		m := &a.current.Messages[i]
		if m.Role != "assistant" || m.Kind != "assistant" {
			continue
		}
		if m.Turn > 0 {
			turns[m.Turn] = true
		}
		steps[[2]int{m.Turn, m.Step}] = true
		if usage, ok := parseMessageUsage(m.Usage); ok {
			reading.tokens += usage.total()
			reading.cacheRead += usage.CacheReadTokens
			reading.promptTokens += usage.InputTokens + usage.CacheReadTokens + usage.CacheWriteTokens
		}
	}
	reading.turns = len(turns)
	reading.steps = len(steps)
	return reading
}

func (a *app) composerStatsView(c *ui.Context, hasError bool) {
	if hasError {
		return
	}
	reading := a.sessionReading()
	if reading.turns == 0 {
		return
	}
	ui.Row(c).Height(22).Shrink(0).AlignSelf(ui.Center).Gap(16).AlignItems(ui.Center).Children(func() {
		a.statPill(c, "gauge-outline", fmt.Sprintf("%d轮 %d步", reading.turns, reading.steps))
		if reading.tokens > 0 {
			label := formatTokenCount(reading.tokens) + " tok"
			if reading.promptTokens > 0 {
				percent := int(float64(reading.cacheRead) / float64(reading.promptTokens) * 100)
				label += fmt.Sprintf(" · 缓存命中 %d%%", percent)
			}
			a.statPill(c, "database-outline", label)
		}
	})
}

func (a *app) statPill(c *ui.Context, iconName, text string) {
	ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
		icon(c, iconName, 14).TextColor(a.colors.Tertiary)
		ui.Text(c, text).FontSize(12).FixedLineHeight(20).TextColor(a.colors.Tertiary)
	})
}
