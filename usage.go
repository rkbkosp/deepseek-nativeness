package main

import (
	"encoding/json"
	"fmt"
	"math"
)

type messageUsage struct {
	InputTokens      int64 `json:"inputTokens"`
	OutputTokens     int64 `json:"outputTokens"`
	TotalTokens      int64 `json:"totalTokens"`
	CacheReadTokens  int64 `json:"cacheReadTokens"`
	CacheWriteTokens int64 `json:"cacheWriteTokens"`
	ReasoningTokens  int64 `json:"reasoningTokens"`
}

func parseMessageUsage(raw json.RawMessage) (messageUsage, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return messageUsage{}, false
	}
	var u messageUsage
	if err := json.Unmarshal(raw, &u); err != nil {
		return messageUsage{}, false
	}
	if u.InputTokens < 0 || u.OutputTokens < 0 || u.TotalTokens < 0 || u.CacheReadTokens < 0 || u.CacheWriteTokens < 0 {
		return messageUsage{}, false
	}
	if u.total() == 0 {
		return messageUsage{}, false
	}
	return u, true
}

func (u messageUsage) total() int64 {
	if u.TotalTokens > 0 {
		return u.TotalTokens
	}
	return u.InputTokens + u.OutputTokens + u.CacheReadTokens + u.CacheWriteTokens
}

// formatTokensPerSecond matches the original speed ladder: 34.4 → 34,
// 3.14 → 3.1, and a negative reading clamps to 0.
func formatTokensPerSecond(tps float64) string {
	clamped := math.Max(0, tps)
	if clamped >= 10 {
		return fmt.Sprint(math.Round(clamped))
	}
	return fmt.Sprint(math.Round(clamped*10) / 10)
}

// formatTokenCount matches the original compact ladder: 517 / 12.2K / 517K / 1.2M.
func formatTokenCount(value int64) string {
	if value < 1_000 {
		return fmt.Sprint(value)
	}
	scaled := func(v float64) string {
		if v >= 100 {
			return fmt.Sprint(math.Round(v))
		}
		return fmt.Sprint(math.Round(v*10) / 10)
	}
	if value < 1_000_000 {
		return scaled(float64(value)/1_000) + "K"
	}
	return scaled(float64(value)/1_000_000) + "M"
}
