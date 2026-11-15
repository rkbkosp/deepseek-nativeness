package main

import (
	"encoding/json"
	"fmt"

	"github.com/egoist/mygo/ui"
)

// sessionReading is the composer footer's reading. Counts, wall times and
// tokens prefer the Host's whole-log projections; every field falls back to
// the loaded window only when the projection is absent.
type sessionReading struct {
	turns, steps      int
	tokens, cacheRead int64
	promptTokens      int64
	outputTokens      int64
	durationMs        float64
	decodeMs          float64
	decodeTokens      int64
}

func (a *app) sessionReading() sessionReading {
	reading := a.windowReading()
	if a.composer == nil {
		return reading
	}
	values := &a.composer.values
	if stats := values.SessionStats; stats != nil {
		reading.turns, reading.steps = stats.Turns, stats.Steps
		reading.decodeMs, reading.decodeTokens = stats.DecodeMs, stats.DecodeTokens
	} else if reading.durationMs > 0 && reading.outputTokens > 0 {
		// Window fallback: a Turn's wall time also covers tool waiting and the
		// first token, so this reading is a lower bound. It only runs when the
		// Host serves no sessionStats projection, never alongside one.
		reading.decodeMs = reading.durationMs
		reading.decodeTokens = reading.outputTokens
	}
	if usage := values.TokenUsage; usage != nil {
		reading.tokens = usage.total()
		reading.promptTokens = usage.billedInput()
		reading.cacheRead = usage.CacheReadTokens
		reading.outputTokens = usage.OutputTokens
	}
	return reading
}

// windowReading folds only the loaded history. It is the fallback for Hosts
// without sessionStats/tokenUsage projections and the source of the Turn
// boundaries a bare replay still carries.
func (a *app) windowReading() sessionReading {
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
			reading.outputTokens += usage.OutputTokens
			reading.cacheRead += usage.CacheReadTokens
			reading.promptTokens += usage.InputTokens + usage.CacheReadTokens + usage.CacheWriteTokens
		}
	}
	reading.turns = len(turns)
	reading.steps = len(steps)
	for _, raw := range a.current.Turns {
		var turn struct {
			StartTime *float64 `json:"startTime"`
			EndTime   *float64 `json:"endTime"`
		}
		if json.Unmarshal(raw, &turn) == nil && turn.StartTime != nil && turn.EndTime != nil && *turn.EndTime > *turn.StartTime {
			reading.durationMs += *turn.EndTime - *turn.StartTime
		}
	}
	return reading
}

// tokensPerSecond is the original decode speed: provider output tokens over
// the time spent decoding them (first token to assembled message), not the
// whole request's wall time.
func (r sessionReading) tokensPerSecond() (float64, bool) {
	if r.decodeMs <= 0 {
		return 0, false
	}
	return float64(r.decodeTokens) / (r.decodeMs / 1_000), true
}

func (a *app) composerStatsView(c *ui.Context, hasError bool) {
	if hasError {
		return
	}
	reading := a.sessionReading()
	if reading.turns == 0 && reading.steps == 0 {
		return
	}
	ui.Row(c).Height(22).Shrink(0).AlignSelf(ui.Center).Gap(16).AlignItems(ui.Center).Children(func() {
		summary := fmt.Sprintf("%d轮 %d步", reading.turns, reading.steps)
		if tps, ok := reading.tokensPerSecond(); ok {
			summary += " · " + formatTokensPerSecond(tps) + " tok/s"
		}
		a.statPill(c, "gauge-outline", summary)
		if pressure := a.composerContextPercent(); pressure >= 0 {
			a.statPill(c, "gauge-outline", fmt.Sprintf("上下文 %d%%", pressure))
		}
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

func (a *app) composerContextPercent() int {
	if a.composer == nil || a.composer.values.ContextPressure == nil {
		return -1
	}
	pressure := a.composer.values.ContextPressure
	window := pressure.ContextWindow
	tokens := pressure.ProjectedTokens
	if tokens == nil {
		tokens = pressure.PressureTokens
	}
	if window == nil || *window <= 0 || tokens == nil || *tokens < 0 {
		return -1
	}
	percent := int(float64(*tokens) / float64(*window) * 100)
	if percent > 100 {
		percent = 100
	}
	return percent
}

func (a *app) statPill(c *ui.Context, iconName, text string) {
	ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
		icon(c, iconName, 14).TextColor(a.colors.Tertiary)
		ui.Text(c, text).FontSize(12).FixedLineHeight(20).TextColor(a.colors.Tertiary)
	})
}
